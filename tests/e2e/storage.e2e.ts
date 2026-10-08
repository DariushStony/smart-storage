import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * End-to-end specs against a real Chromium and the built bundle.
 *
 * Scope is deliberately narrow: only behaviour a simulated DOM cannot prove
 * honestly. Logic, TTL arithmetic, codecs and the registry are covered far
 * faster by the Vitest suite in tests/unit.
 */

const HARNESS = '/tests/e2e/harness.html';

async function open(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => window.__smartStorageReady === true);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__smartStorageReady === true);
}

test.beforeEach(async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test.describe('the shipped bundle', () => {
  test('exposes exactly the documented runtime exports', async ({ page }) => {
    const exports = await page.evaluate(() =>
      Object.keys(window.smartStorage).sort()
    );

    expect(exports).toEqual(
      [
        'BaseStorageDriver',
        'MemoryDriver',
        'StorageAccessError',
        'StorageArgumentError',
        'StorageConflictError',
        'StorageCorruptionError',
        'StorageDisposedError',
        'StorageError',
        'StorageQuotaError',
        'StorageSerializationError',
        'StorageUnavailableError',
        'WebStorageDriver',
        'createVault',
        'registerDriver',
        'unregisterDriver',
      ].sort()
    );
  });
});

test.describe('real localStorage persistence', () => {
  test('data survives a full page reload', async ({ page }) => {
    await page.evaluate(() => {
      window.smartStorage
        .createVault({ key: 'E2E_PERSIST' })
        .set('theme', 'dark');
    });

    await reload(page);

    const theme = await page.evaluate(() =>
      // A brand new JS realm: this only passes if the bytes really persisted.
      window.smartStorage.createVault({ key: 'E2E_PERSIST' }).get('theme')
    );
    expect(theme).toBe('dark');
  });

  test('a vault writes one versioned blob under its key', async ({ page }) => {
    const raw = await page.evaluate(() => {
      const vault = window.smartStorage.createVault({ key: 'E2E_BLOB' });
      vault.set('a', 1);
      vault.set('b', { nested: true });
      return localStorage.getItem('E2E_BLOB');
    });

    expect(JSON.parse(raw ?? 'null')).toEqual({
      v: 2,
      items: [
        { key: 'a', value: 1 },
        { key: 'b', value: { nested: true } },
      ],
    });
  });

  test('an expired item is gone after a reload', async ({ page }) => {
    await page.evaluate(() => {
      const vault = window.smartStorage.createVault({ key: 'E2E_TTL' });
      vault.set('vanishing', 'v', { ttl: 300 });
      vault.set('surviving', 'v');
    });

    // Real elapsed time, not a mocked clock.
    await page.waitForTimeout(400);
    await reload(page);

    const result = await page.evaluate(() => {
      const vault = window.smartStorage.createVault({ key: 'E2E_TTL' });
      return {
        vanishing: vault.get('vanishing'),
        surviving: vault.get('surviving'),
      };
    });
    expect(result).toEqual({ vanishing: null, surviving: 'v' });
  });

  test('data written by 1.x is read and upgraded on the next write', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      localStorage.setItem(
        'E2E_LEGACY',
        JSON.stringify({
          theme: { value: 'dark', expiry: null },
          token: { value: 'abc', expiry: Date.now() + 60_000 },
        })
      );
      const vault = window.smartStorage.createVault({ key: 'E2E_LEGACY' });
      const before = { theme: vault.get('theme'), token: vault.get('token') };
      vault.set('lang', 'fa');
      const raw = JSON.parse(localStorage.getItem('E2E_LEGACY') ?? 'null') as {
        v: number;
        items: Array<{ key: string }>;
      };
      return {
        before,
        version: raw.v,
        keys: raw.items.map((item) => item.key),
      };
    });

    expect(result.before).toEqual({ theme: 'dark', token: 'abc' });
    expect(result.version).toBe(2);
    expect(result.keys).toEqual(['theme', 'token', 'lang']);
  });
});

test.describe('sessionStorage semantics', () => {
  test('session data goes to sessionStorage, not localStorage', async ({
    page,
  }) => {
    const stores = await page.evaluate(() => {
      window.smartStorage
        .createVault({ key: 'E2E_SESSION', driver: 'session' })
        .set('step', 2);
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
      window.smartStorage
        .createVault({ key: 'E2E_SESSION_LIFE', driver: 'session' })
        .set('k', 'v');
    });

    await reload(page);
    const afterReload = await page.evaluate(() =>
      window.smartStorage
        .createVault({ key: 'E2E_SESSION_LIFE', driver: 'session' })
        .get('k')
    );
    expect(afterReload).toBe('v');

    // A fresh context is a fresh browsing session, so sessionStorage is empty.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await open(freshPage);
    const inFreshSession = await freshPage.evaluate(() =>
      window.smartStorage
        .createVault({ key: 'E2E_SESSION_LIFE', driver: 'session' })
        .get('k')
    );
    expect(inFreshSession).toBeNull();
    await freshContext.close();
  });
});

test.describe('debounced writes against a real event loop', () => {
  test('a pending write is readable before it is persisted', async ({
    page,
  }) => {
    const observed = await page.evaluate(() => {
      const vault = window.smartStorage.createVault({
        key: 'E2E_DEBOUNCE',
        debounceMs: 1000,
      });
      vault.set('k', 'v');
      return {
        readBack: vault.get('k'),
        persisted: localStorage.getItem('E2E_DEBOUNCE'),
      };
    });

    expect(observed).toEqual({ readBack: 'v', persisted: null });
  });

  test('a pending write persists once the delay elapses', async ({ page }) => {
    await page.evaluate(() => {
      window.smartStorage
        .createVault({ key: 'E2E_DEBOUNCE_WAIT', debounceMs: 150 })
        .set('k', 'v');
    });

    await expect
      .poll(
        () => page.evaluate(() => localStorage.getItem('E2E_DEBOUNCE_WAIT')),
        { timeout: 3000 }
      )
      .not.toBeNull();
  });

  test('a pending write is not lost when the page is navigated away', async ({
    page,
  }) => {
    await page.evaluate(() => {
      // Long delay: without the pagehide flush this write would be lost.
      window.smartStorage
        .createVault({ key: 'E2E_PAGEHIDE', debounceMs: 60_000 })
        .set('k', 'survives');
    });

    // A real navigation fires a real pagehide event.
    await open(page);

    const raw = await page.evaluate(() => localStorage.getItem('E2E_PAGEHIDE'));
    expect(raw).toContain('survives');
  });
});

test.describe('real quota', () => {
  test.slow();

  test('a write past the quota throws StorageQuotaError and keeps earlier data', async ({
    page,
  }) => {
    const outcome = await page.evaluate(
      ({ chunks, chunkChars }) => {
        const { createVault, StorageQuotaError } = window.smartStorage;
        const vault = createVault({
          key: 'E2E_QUOTA',
          maxBytes: Number.MAX_SAFE_INTEGER,
        });
        const chunk = 'x'.repeat(chunkChars);
        const accepted: string[] = [];

        for (let i = 0; i < chunks; i += 1) {
          const key = `chunk-${String(i)}`;
          try {
            vault.set(key, chunk);
            accepted.push(key);
          } catch (error) {
            const present = vault.keys();
            return {
              quotaError: error instanceof StorageQuotaError,
              accepted,
              present,
              intact: present.every(
                (k) => (vault.get<string>(k) ?? '').length === chunkChars
              ),
            };
          }
        }
        return {
          quotaError: false,
          accepted,
          present: vault.keys(),
          intact: true,
        };
      },
      { chunks: 40, chunkChars: 512 * 1024 }
    );

    expect(outcome.quotaError).toBe(true);
    expect(outcome.accepted.length).toBeGreaterThan(0);
    // Every write that returned normally is still there; nothing was dropped.
    expect(outcome.present).toEqual(outcome.accepted);
    expect(outcome.intact).toBe(true);
  });
});

test.describe('across tabs', () => {
  test('an open vault sees writes another tab makes later', async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await open(first);
    await open(second);

    await second.evaluate(() => {
      window.__vault = window.smartStorage.createVault({
        key: 'E2E_CROSS_TAB',
      });
      window.__vault.get('shared');
    });
    await first.evaluate(() => {
      window.smartStorage
        .createVault({ key: 'E2E_CROSS_TAB' })
        .set('shared', 'from-tab-1');
    });

    const seen = await second.evaluate(() => window.__vault?.get('shared'));
    expect(seen).toBe('from-tab-1');

    await first.close();
    await second.close();
  });
});

test.describe('corrupted storage in a real browser', () => {
  test('a garbage payload reads as empty, stays until a write, then is replaced', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      localStorage.setItem('E2E_CORRUPT', 'not json at all }{');
      const errors: string[] = [];
      const vault = window.smartStorage.createVault({
        key: 'E2E_CORRUPT',
        onError: (error) => errors.push(error.code),
      });

      const before = vault.toObject();
      const untouched = localStorage.getItem('E2E_CORRUPT');
      vault.set('k', 'recovered');

      return { before, untouched, errors, after: vault.get('k') };
    });

    expect(result.before).toEqual({});
    expect(result.untouched).toBe('not json at all }{');
    expect(result.errors).toEqual(['CORRUPTED']);
    expect(result.after).toBe('recovered');
  });
});

test.describe('extension API in a real browser', () => {
  test('real localStorage and sessionStorage honour the driver contract', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { WebStorageDriver } = window.smartStorage;
      const { verifyStorageDriver } = window.smartStorageTesting;
      const failures = (report: {
        checks: Array<{ rule: string; passed: boolean; error?: unknown }>;
      }): string[] =>
        report.checks
          .filter((check) => !check.passed)
          .map((check) => `${check.rule}: ${String(check.error)}`);

      const local = await verifyStorageDriver(
        () => new WebStorageDriver(localStorage, 'localStorage')
      );
      const session = await verifyStorageDriver(
        () => new WebStorageDriver(sessionStorage, 'sessionStorage')
      );
      return {
        local: failures(local),
        session: failures(session),
        leftover: localStorage.length + sessionStorage.length,
      };
    });

    expect(result).toEqual({ local: [], session: [], leftover: 0 });
  });

  test('a registered, namespaced driver works through the built bundle', async ({
    page,
  }) => {
    const raw = await page.evaluate(() => {
      const { WebStorageDriver, createVault, registerDriver } =
        window.smartStorage;
      registerDriver(
        'prefixed',
        () =>
          new WebStorageDriver(localStorage, 'prefixed', { namespace: 'app' })
      );
      createVault({ key: 'E2E_REGISTERED', driver: 'prefixed' }).set('a', 1);
      return localStorage.getItem('app:E2E_REGISTERED');
    });

    expect(JSON.parse(raw ?? 'null')).toEqual({
      v: 2,
      items: [{ key: 'a', value: 1 }],
    });
  });
});
