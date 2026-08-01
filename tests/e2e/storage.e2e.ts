import { expect, test } from '@playwright/test';

/**
 * End-to-end specs against a real Chromium and the built bundle.
 *
 * Scope is deliberately narrow: only behavior that a simulated DOM cannot
 * honestly prove. Logic, TTL arithmetic, transforms and singleton semantics
 * are covered far faster by the Vitest suite in tests/unit.
 */

const HARNESS = '/tests/e2e/harness.html';

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await page.waitForFunction(() => window.__smartStorageReady === true);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test.describe('the shipped bundle loads in a real browser', () => {
  test('exposes the documented exports', async ({ page }) => {
    const exports = await page.evaluate(() =>
      Object.keys(window.smartStorage).sort()
    );

    expect(exports).toEqual(
      [
        'InlineTransformHandler',
        'LoggingHandler',
        'StorageStatistics',
        'StorageType',
        'StorageVault',
        'TransformChain',
        'TransformHandler',
        'disposeStorageSlice',
        'getStorageSlice',
      ].sort()
    );
  });
});

test.describe('real localStorage persistence', () => {
  test('data survives a full page reload', async ({ page }) => {
    await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      const storage = getStorageSlice('E2E_PERSIST', { debounceMs: 0 });
      storage.setItem('theme', 'dark');
    });

    await page.reload();
    await page.waitForFunction(() => window.__smartStorageReady === true);

    const theme = await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      // A brand new JS realm: this can only pass if the bytes really persisted.
      return getStorageSlice('E2E_PERSIST').getItem('theme');
    });

    expect(theme).toBe('dark');
  });

  test('writes land under the slice key as a single JSON blob', async ({
    page,
  }) => {
    const raw = await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      const storage = getStorageSlice('E2E_BLOB', { debounceMs: 0 });
      storage.setItem('a', 1);
      storage.setItem('b', { nested: true });
      return localStorage.getItem('E2E_BLOB');
    });

    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(Object.keys(parsed).sort()).toEqual(['a', 'b']);
    expect(parsed.a).toEqual({ value: 1, expiry: null });
  });

  test('separate slices occupy separate storage keys', async ({ page }) => {
    const keys = await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      getStorageSlice('E2E_ONE', { debounceMs: 0 }).setItem('k', 'one');
      getStorageSlice('E2E_TWO', { debounceMs: 0 }).setItem('k', 'two');
      return Object.keys(localStorage).sort();
    });

    expect(keys).toEqual(['E2E_ONE', 'E2E_TWO']);
  });

  test('an expired item is gone after a reload', async ({ page }) => {
    await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      const storage = getStorageSlice('E2E_TTL', { debounceMs: 0 });
      storage.setItem('vanishing', 'v', 300);
      storage.setItem('surviving', 'v');
    });

    // Real elapsed time, not a mocked clock.
    await new Promise((r) => setTimeout(r, 400));
    await page.reload();
    await page.waitForFunction(() => window.__smartStorageReady === true);

    const result = await page.evaluate(() => {
      const storage = window.smartStorage.getStorageSlice('E2E_TTL', {
        debounceMs: 0,
      });
      return {
        vanishing: storage.getItem('vanishing'),
        surviving: storage.getItem('surviving'),
      };
    });

    expect(result.vanishing).toBeNull();
    expect(result.surviving).toBe('v');
  });
});

test.describe('sessionStorage semantics', () => {
  test('session data is written to sessionStorage, not localStorage', async ({
    page,
  }) => {
    const stores = await page.evaluate(() => {
      const { getStorageSlice, StorageType } = window.smartStorage;
      const session = getStorageSlice('E2E_SESSION', {
        storageType: StorageType.Session,
        debounceMs: 0,
      });
      session.setItem('step', 2);

      return {
        session: sessionStorage.getItem('E2E_SESSION'),
        local: localStorage.getItem('E2E_SESSION'),
      };
    });

    expect(stores.session).not.toBeNull();
    expect(stores.local).toBeNull();
  });

  test('session data survives a reload but not a new context', async ({
    page,
    browser,
  }) => {
    await page.evaluate(() => {
      const { getStorageSlice, StorageType } = window.smartStorage;
      getStorageSlice('E2E_SESSION_LIFE', {
        storageType: StorageType.Session,
        debounceMs: 0,
      }).setItem('k', 'v');
    });

    await page.reload();
    await page.waitForFunction(() => window.__smartStorageReady === true);

    const afterReload = await page.evaluate(() => {
      const { getStorageSlice, StorageType } = window.smartStorage;
      return getStorageSlice('E2E_SESSION_LIFE', {
        storageType: StorageType.Session,
      }).getItem('k');
    });
    expect(afterReload).toBe('v');

    // A fresh context is a fresh browsing session, so sessionStorage is empty.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto(HARNESS);
    await freshPage.waitForFunction(() => window.__smartStorageReady === true);

    const inFreshSession = await freshPage.evaluate(() => {
      const { getStorageSlice, StorageType } = window.smartStorage;
      return getStorageSlice('E2E_SESSION_LIFE', {
        storageType: StorageType.Session,
      }).getItem('k');
    });
    expect(inFreshSession).toBeNull();

    await freshContext.close();
  });
});

test.describe('debounced writes against a real event loop', () => {
  test('a pending write is readable before it is persisted', async ({
    page,
  }) => {
    const observed = await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      const storage = getStorageSlice('E2E_DEBOUNCE', { debounceMs: 1000 });
      storage.setItem('k', 'v');

      return {
        readBack: storage.getItem('k'),
        persisted: localStorage.getItem('E2E_DEBOUNCE'),
      };
    });

    expect(observed.readBack).toBe('v');
    expect(observed.persisted).toBeNull();
  });

  test('a pending write persists once the window elapses', async ({ page }) => {
    await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      getStorageSlice('E2E_DEBOUNCE_WAIT', { debounceMs: 150 }).setItem(
        'k',
        'v'
      );
    });

    await expect
      .poll(
        () => page.evaluate(() => localStorage.getItem('E2E_DEBOUNCE_WAIT')),
        { timeout: 3000 }
      )
      .not.toBeNull();
  });

  test('flush() persists synchronously', async ({ page }) => {
    const persisted = await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      const storage = getStorageSlice('E2E_FLUSH', { debounceMs: 10_000 });
      storage.setItem('k', 'v');
      storage.flush();
      return localStorage.getItem('E2E_FLUSH');
    });

    expect(persisted).toContain('"v"');
  });
});

test.describe('pagehide auto-flush', () => {
  test('a pending write is not lost when the page is navigated away', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      // Long debounce: without a pagehide flush this write would be lost.
      getStorageSlice('E2E_PAGEHIDE', { debounceMs: 60_000 }).setItem(
        'k',
        'survives'
      );
    });

    // A real navigation, which fires a real pagehide event.
    await page.goto(HARNESS);
    await page.waitForFunction(() => window.__smartStorageReady === true);

    const raw = await page.evaluate(() => localStorage.getItem('E2E_PAGEHIDE'));

    expect(raw).toContain('survives');
  });
});

test.describe('large payloads', () => {
  test.slow();

  // Deliberately NOT asserting that a quota breach happens. Headless Chromium
  // on CI accepted 100 MB without refusing, so the breach point is not
  // reproducible across environments. The cleanup-and-retry path for a real
  // QuotaExceededError is covered deterministically in the unit suite, which
  // stubs the adapter's write() to throw one.
  //
  // What is worth asserting here is the invariant that holds either way:
  // a large write is stored intact or it fails loudly -- never silently
  // truncated. Both branches below assert something real.
  test('a large payload is stored intact or fails loudly', async ({ page }) => {
    const CHUNKS = 20;
    const CHUNK_CHARS = 512 * 1024;

    const outcome = await page.evaluate(
      ({ chunks, chunkChars }) => {
        const { getStorageSlice } = window.smartStorage;
        const storage = getStorageSlice('E2E_LARGE', { debounceMs: 0 });
        const chunk = 'x'.repeat(chunkChars);

        for (let i = 0; i < chunks; i += 1) {
          try {
            storage.setItem(`chunk-${String(i)}`, chunk);
          } catch (error) {
            return {
              threw: true,
              written: i,
              message: error instanceof Error ? error.message : String(error),
              lastLength: -1,
              keyCount: -1,
            };
          }
        }

        // Read back through a value the vault must have persisted verbatim.
        const last = storage.getItem<string>(`chunk-${String(chunks - 1)}`);
        return {
          threw: false,
          written: chunks,
          message: '',
          lastLength: last === null ? -1 : last.length,
          keyCount: storage.getAllKeys().length,
        };
      },
      { chunks: CHUNKS, chunkChars: CHUNK_CHARS }
    );

    if (outcome.threw) {
      // Failing loudly is fine, but it must be the vault's own descriptive
      // error rather than a leaked raw DOMException.
      expect(outcome.message).toMatch(/quota|storage/i);
    } else {
      // Succeeding is also fine -- as long as nothing was silently dropped.
      expect(outcome.keyCount).toBe(CHUNKS);
      expect(outcome.lastLength).toBe(CHUNK_CHARS);
    }

    // Either way the page must still be alive and a fresh slice usable.
    const stillWorks = await page.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      const fresh = getStorageSlice('E2E_LARGE_AFTER', { debounceMs: 0 });
      fresh.clear();
      fresh.setItem('k', 'v');
      return fresh.getItem('k');
    });

    expect(stillWorks).toBe('v');
  });
});

test.describe('cross-tab visibility', () => {
  test('a second tab sees data written by the first', async ({ context }) => {
    const first = await context.newPage();
    await first.goto(HARNESS);
    await first.waitForFunction(() => window.__smartStorageReady === true);
    await first.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      getStorageSlice('E2E_CROSS_TAB', { debounceMs: 0 }).setItem(
        'shared',
        'from-tab-1'
      );
    });

    const second = await context.newPage();
    await second.goto(HARNESS);
    await second.waitForFunction(() => window.__smartStorageReady === true);

    const seen = await second.evaluate(() => {
      const { getStorageSlice } = window.smartStorage;
      // localStorage is shared per origin, so a separate tab reads it.
      return getStorageSlice('E2E_CROSS_TAB').getItem('shared');
    });

    expect(seen).toBe('from-tab-1');

    await first.close();
    await second.close();
  });
});

test.describe('corrupted storage recovery in a real browser', () => {
  test('a garbage payload is discarded rather than thrown', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      localStorage.setItem('E2E_CORRUPT', 'not json at all }{');

      const { getStorageSlice } = window.smartStorage;
      const storage = getStorageSlice('E2E_CORRUPT', { debounceMs: 0 });

      const all = storage.getAll();
      storage.setItem('k', 'recovered');

      return { all, afterWrite: storage.getItem('k') };
    });

    expect(result.all).toEqual({});
    expect(result.afterWrite).toBe('recovered');
  });
});
