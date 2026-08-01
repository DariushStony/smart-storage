import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageType } from '../../src/storage/storage-type.js';
import { StorageVault } from '../../src/vault/storage-vault.js';

/**
 * Builds an isolated vault. Defaults to in-memory with debouncing off so
 * assertions observe writes synchronously; tests that care about debouncing
 * or real Web Storage opt in explicitly.
 */
let counter = 0;
function makeVault(
  options: Parameters<typeof StorageVault.getInstance>[0] = {}
): StorageVault {
  counter += 1;
  return StorageVault.getInstance({
    storageKey: `TEST_${String(counter)}`,
    storageType: StorageType.InMemory,
    debounceMs: 0,
    ...options,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  StorageVault.clearAllInstances();
  vi.useRealTimers();
});

describe('setItem / getItem', () => {
  it('stores and retrieves a primitive', () => {
    const vault = makeVault();
    expect(vault.setItem('theme', 'dark')).toBe(true);
    expect(vault.getItem('theme')).toBe('dark');
  });

  it.each([
    ['string', 'hello'],
    ['number', 42],
    ['zero', 0],
    ['boolean true', true],
    ['boolean false', false],
    ['null', null],
    ['object', { a: 1, nested: { b: [1, 2, 3] } }],
    ['array', [1, 'two', { three: 3 }]],
    ['empty object', {}],
    ['empty array', []],
  ])('round-trips a %s value', (_label, value) => {
    const vault = makeVault();
    vault.setItem('k', value);
    expect(vault.getItem('k')).toEqual(value);
  });

  it('returns null for a key that was never set', () => {
    expect(makeVault().getItem('absent')).toBeNull();
  });

  it('overwrites an existing value', () => {
    const vault = makeVault();
    vault.setItem('k', 'first');
    vault.setItem('k', 'second');
    expect(vault.getItem('k')).toBe('second');
  });

  it('keeps distinct keys independent', () => {
    const vault = makeVault();
    vault.setItem('a', 1);
    vault.setItem('b', 2);
    expect(vault.getItem('a')).toBe(1);
    expect(vault.getItem('b')).toBe(2);
  });

  it('rejects a dangerous key', () => {
    const vault = makeVault();
    expect(() => vault.setItem('__proto__', 'evil')).toThrow(
      /prototype pollution/i
    );
  });

  it('rejects a blank key', () => {
    const vault = makeVault();
    expect(() => vault.setItem('  ', 'x')).toThrow(/empty or whitespace/i);
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s TTL', (_label, ttl) => {
    const vault = makeVault();
    expect(() => vault.setItem('k', 'v', ttl)).toThrow(
      /non-negative finite number/i
    );
  });

  it('treats a TTL of 0 as an immediate removal', () => {
    const vault = makeVault();
    vault.setItem('k', 'v');
    vault.setItem('k', 'v', 0);
    expect(vault.getItem('k')).toBeNull();
  });
});

describe('TTL expiry', () => {
  it('returns a value while it is still live', () => {
    const vault = makeVault();
    vault.setItem('k', 'v', 60_000);
    expect(vault.getItem('k')).toBe('v');
  });

  it('returns null once the TTL has elapsed', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 1000);

    vi.advanceTimersByTime(1001);

    expect(vault.getItem('k')).toBeNull();
  });

  it('drops the expired entry from storage on read', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 1000);
    vi.advanceTimersByTime(1001);

    vault.getItem('k');

    // Expiry is lazy: reading is what evicts it.
    expect(vault.getAllKeys()).not.toContain('k');
  });

  it('never expires an item stored without a TTL', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v');

    vi.advanceTimersByTime(10 ** 9);

    expect(vault.getItem('k')).toBe('v');
  });

  it('reports remaining TTL for a live item', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 10_000);

    vi.advanceTimersByTime(4000);

    expect(vault.getRemainingTTL('k')).toBe(6000);
  });

  it('reports null remaining TTL for an item with no expiry', () => {
    const vault = makeVault();
    vault.setItem('k', 'v');
    expect(vault.getRemainingTTL('k')).toBeNull();
  });

  it('reports null remaining TTL for an absent key', () => {
    expect(makeVault().getRemainingTTL('absent')).toBeNull();
  });

  it('reports null remaining TTL once expired', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 1000);
    vi.advanceTimersByTime(1001);

    expect(vault.getRemainingTTL('k')).toBeNull();
  });
});

describe('updateItem', () => {
  it('replaces the value and preserves the original expiry', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'first', 10_000);

    vi.advanceTimersByTime(3000);
    expect(vault.updateItem('k', 'second')).toBe(true);

    expect(vault.getItem('k')).toBe('second');
    // 10s TTL set at t=0, now t=3000, so 7000 remains -- unchanged by update.
    expect(vault.getRemainingTTL('k')).toBe(7000);
  });

  it('returns false for a key that does not exist', () => {
    expect(makeVault().updateItem('absent', 'v')).toBe(false);
  });

  it('returns false for an expired key', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 1000);
    vi.advanceTimersByTime(1001);

    expect(vault.updateItem('k', 'new')).toBe(false);
  });
});

describe('extendTTL', () => {
  it('adds to an existing expiry', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 5000);

    expect(vault.extendTTL('k', 3000)).toBe(true);

    expect(vault.getRemainingTTL('k')).toBe(8000);
  });

  it('adds an expiry to an item that had none, measured from now', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v');

    vault.extendTTL('k', 5000);

    expect(vault.getRemainingTTL('k')).toBe(5000);
  });

  it('returns false for an absent key', () => {
    expect(makeVault().extendTTL('absent', 1000)).toBe(false);
  });

  it('returns false for an expired key', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 1000);
    vi.advanceTimersByTime(1001);

    expect(vault.extendTTL('k', 5000)).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['negative', -1000],
    ['NaN', Number.NaN],
  ])('rejects a %s extension', (_label, amount) => {
    const vault = makeVault();
    vault.setItem('k', 'v');
    expect(() => vault.extendTTL('k', amount)).toThrow(
      /positive finite number/i
    );
  });
});

describe('removeItem / clear', () => {
  it('removes an existing item and reports true', () => {
    const vault = makeVault();
    vault.setItem('k', 'v');

    expect(vault.removeItem('k')).toBe(true);
    expect(vault.getItem('k')).toBeNull();
  });

  it('reports false when removing an absent key', () => {
    expect(makeVault().removeItem('absent')).toBe(false);
  });

  it('clear() empties the slice', () => {
    const vault = makeVault();
    vault.setItem('a', 1);
    vault.setItem('b', 2);

    expect(vault.clear()).toBe(true);

    expect(vault.getAllKeys()).toEqual([]);
    expect(vault.getItem('a')).toBeNull();
  });

  it('clear() leaves other slices untouched', () => {
    const a = makeVault({ storageKey: 'SLICE_A' });
    const b = makeVault({ storageKey: 'SLICE_B' });
    a.setItem('k', 'from-a');
    b.setItem('k', 'from-b');

    a.clear();

    expect(b.getItem('k')).toBe('from-b');
  });
});

describe('hasItem', () => {
  it('is true for a live item', () => {
    const vault = makeVault();
    vault.setItem('k', 'v');
    expect(vault.hasItem('k')).toBe(true);
  });

  it('is true for a stored falsy value', () => {
    const vault = makeVault();
    vault.setItem('k', false);
    // Distinguishing "absent" from "stored false" matters for feature flags.
    expect(vault.hasItem('k')).toBe(true);
  });

  it('is false for an absent key', () => {
    expect(makeVault().hasItem('absent')).toBe(false);
  });

  it('is false for an expired item', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('k', 'v', 1000);
    vi.advanceTimersByTime(1001);

    expect(vault.hasItem('k')).toBe(false);
  });
});

describe('getAllKeys / getAll', () => {
  it('returns every live key', () => {
    const vault = makeVault();
    vault.setItem('a', 1);
    vault.setItem('b', 2);

    expect(vault.getAllKeys().sort()).toEqual(['a', 'b']);
  });

  it('omits expired keys', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('live', 1);
    vault.setItem('dead', 2, 1000);

    vi.advanceTimersByTime(1001);

    expect(vault.getAllKeys()).toEqual(['live']);
  });

  it('returns key/value pairs without expiry metadata', () => {
    const vault = makeVault();
    vault.setItem('a', 1);
    vault.setItem('b', { nested: true }, 60_000);

    expect(vault.getAll()).toEqual({ a: 1, b: { nested: true } });
  });

  it('returns empty collections for an empty slice', () => {
    const vault = makeVault();
    expect(vault.getAllKeys()).toEqual([]);
    expect(vault.getAll()).toEqual({});
  });
});

describe('cleanupExpiredItems', () => {
  it('removes expired items and returns the count', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('live', 1);
    vault.setItem('dead1', 2, 1000);
    vault.setItem('dead2', 3, 1000);

    vi.advanceTimersByTime(1001);

    expect(vault.cleanupExpiredItems()).toBe(2);
    expect(vault.getAllKeys()).toEqual(['live']);
  });

  it('returns 0 when nothing has expired', () => {
    const vault = makeVault();
    vault.setItem('k', 'v');
    expect(vault.cleanupExpiredItems()).toBe(0);
  });

  it('returns 0 on an empty slice', () => {
    expect(makeVault().cleanupExpiredItems()).toBe(0);
  });
});

describe('debounced writes', () => {
  it('defers the write to storage', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });

    vault.setItem('k', 'v');

    // Nothing has reached the backing store yet.
    expect(vault.getStorageAdapter().read(vault.getStorageKey())).toBeNull();
  });

  it('serves pending writes to readers (read-after-write consistency)', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });

    vault.setItem('k', 'v');

    // The value is readable immediately even though it is not yet persisted.
    expect(vault.getItem('k')).toBe('v');
  });

  it('persists once the debounce window elapses', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });
    vault.setItem('k', 'v');

    vi.advanceTimersByTime(100);

    const raw = vault.getStorageAdapter().read(vault.getStorageKey());
    expect(raw).toContain('"v"');
  });

  it('coalesces rapid writes into a single persist', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });
    const writeSpy = vi.spyOn(vault.getStorageAdapter(), 'write');

    vault.setItem('a', 1);
    vault.setItem('b', 2);
    vault.setItem('c', 3);
    vi.advanceTimersByTime(100);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(vault.getAll()).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('writes synchronously when debouncing is disabled', () => {
    const vault = makeVault({ debounceMs: 0 });
    vault.setItem('k', 'v');

    expect(vault.getStorageAdapter().read(vault.getStorageKey())).toContain(
      '"v"'
    );
  });

  it('flush() persists pending writes immediately', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 5000 });
    vault.setItem('k', 'v');

    vault.flush();

    expect(vault.getStorageAdapter().read(vault.getStorageKey())).toContain(
      '"v"'
    );
  });

  it('flush() is a no-op when nothing is pending', () => {
    const vault = makeVault({ debounceMs: 0 });
    vault.setItem('k', 'v');
    expect(() => vault.flush()).not.toThrow();
    expect(vault.getItem('k')).toBe('v');
  });

  it('discards pending writes on clear()', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });
    vault.setItem('k', 'v');

    vault.clear();
    vi.advanceTimersByTime(200);

    // The queued write must not resurrect cleared data.
    expect(vault.getItem('k')).toBeNull();
  });
});

describe('pagehide auto-flush', () => {
  it('persists pending writes when the page goes away', () => {
    vi.useFakeTimers();
    const vault = StorageVault.getInstance({
      storageKey: 'PAGEHIDE_TEST',
      storageType: StorageType.Local,
      debounceMs: 5000,
    });

    vault.setItem('k', 'v');
    expect(localStorage.getItem('PAGEHIDE_TEST')).toBeNull();

    window.dispatchEvent(new Event('pagehide'));

    // Without this, closing a tab mid-debounce would lose the write.
    expect(localStorage.getItem('PAGEHIDE_TEST')).toContain('"v"');
  });
});

describe('singleton behaviour', () => {
  it('returns the same instance for the same key and type', () => {
    const a = StorageVault.getInstance({ storageKey: 'SAME' });
    const b = StorageVault.getInstance({ storageKey: 'SAME' });
    expect(a).toBe(b);
  });

  it('returns different instances for different keys', () => {
    const a = StorageVault.getInstance({ storageKey: 'ONE' });
    const b = StorageVault.getInstance({ storageKey: 'TWO' });
    expect(a).not.toBe(b);
  });

  it('returns different instances for different storage types', () => {
    const local = StorageVault.getInstance({
      storageKey: 'DUAL',
      storageType: StorageType.Local,
    });
    const session = StorageVault.getInstance({
      storageKey: 'DUAL',
      storageType: StorageType.Session,
    });
    expect(local).not.toBe(session);
  });

  it('ignores non-identity options on a repeat call', () => {
    const first = StorageVault.getInstance({
      storageKey: 'CONFIG',
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });
    const second = StorageVault.getInstance({
      storageKey: 'CONFIG',
      storageType: StorageType.InMemory,
      debounceMs: 9999,
    });

    // Identity is storageType + storageKey only, so the second call gets the
    // first instance and its original debounce -- a documented sharp edge.
    expect(second).toBe(first);
    second.setItem('k', 'v');
    expect(second.getStorageAdapter().read('CONFIG')).toContain('"v"');
  });

  it('shares data between references to the same slice', () => {
    const a = StorageVault.getInstance({
      storageKey: 'SHARED',
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });
    a.setItem('k', 'written-via-a');

    const b = StorageVault.getInstance({
      storageKey: 'SHARED',
      storageType: StorageType.InMemory,
    });
    expect(b.getItem('k')).toBe('written-via-a');
  });

  it('disposeInstance drops the cached instance', () => {
    const first = StorageVault.getInstance({ storageKey: 'DISPOSE' });

    expect(StorageVault.disposeInstance({ storageKey: 'DISPOSE' })).toBe(true);

    expect(StorageVault.getInstance({ storageKey: 'DISPOSE' })).not.toBe(first);
  });

  it('disposeInstance reports false for an unknown slice', () => {
    expect(StorageVault.disposeInstance({ storageKey: 'NEVER_MADE' })).toBe(
      false
    );
  });

  it('disposeInstance flushes pending writes before dropping', () => {
    vi.useFakeTimers();
    const vault = StorageVault.getInstance({
      storageKey: 'DISPOSE_FLUSH',
      storageType: StorageType.Local,
      debounceMs: 5000,
    });
    vault.setItem('k', 'v');

    StorageVault.disposeInstance({
      storageKey: 'DISPOSE_FLUSH',
      storageType: StorageType.Local,
    });

    expect(localStorage.getItem('DISPOSE_FLUSH')).toContain('"v"');
  });

  it('clearAllInstances drops every instance', () => {
    const a = StorageVault.getInstance({ storageKey: 'ALL_A' });
    const b = StorageVault.getInstance({ storageKey: 'ALL_B' });

    StorageVault.clearAllInstances();

    expect(StorageVault.getInstance({ storageKey: 'ALL_A' })).not.toBe(a);
    expect(StorageVault.getInstance({ storageKey: 'ALL_B' })).not.toBe(b);
  });
});

describe('slice isolation', () => {
  it('keeps slices in separate storage entries', () => {
    const a = StorageVault.getInstance({
      storageKey: 'ISO_A',
      storageType: StorageType.Local,
      debounceMs: 0,
    });
    const b = StorageVault.getInstance({
      storageKey: 'ISO_B',
      storageType: StorageType.Local,
      debounceMs: 0,
    });

    a.setItem('k', 'a-value');
    b.setItem('k', 'b-value');

    expect(a.getItem('k')).toBe('a-value');
    expect(b.getItem('k')).toBe('b-value');
    expect(localStorage.getItem('ISO_A')).not.toBeNull();
    expect(localStorage.getItem('ISO_B')).not.toBeNull();
  });
});

describe('corrupted storage recovery', () => {
  it('recovers from unparseable JSON', () => {
    localStorage.setItem('CORRUPT', 'this is not json{{{');
    const vault = StorageVault.getInstance({
      storageKey: 'CORRUPT',
      storageType: StorageType.Local,
      debounceMs: 0,
    });

    // Reads must not throw; the vault discards the bad payload.
    expect(vault.getAll()).toEqual({});
    expect(localStorage.getItem('CORRUPT')).toBeNull();
  });

  it('recovers from valid JSON of the wrong shape', () => {
    localStorage.setItem('WRONG_SHAPE', JSON.stringify([1, 2, 3]));
    const vault = StorageVault.getInstance({
      storageKey: 'WRONG_SHAPE',
      storageType: StorageType.Local,
      debounceMs: 0,
    });

    expect(vault.getAll()).toEqual({});
  });

  it('stays usable after clearing corrupted data', () => {
    localStorage.setItem('CORRUPT_THEN_USE', '}{');
    const vault = StorageVault.getInstance({
      storageKey: 'CORRUPT_THEN_USE',
      storageType: StorageType.Local,
      debounceMs: 0,
    });

    vault.setItem('k', 'v');

    expect(vault.getItem('k')).toBe('v');
  });
});

describe('circular references', () => {
  it('throws a descriptive error rather than a raw TypeError', () => {
    const vault = makeVault();
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;

    expect(() => vault.setItem('k', cyclic)).toThrow(/circular references/i);
  });
});

describe('quota handling', () => {
  it('cleans up expired items and retries on QuotaExceededError', () => {
    vi.useFakeTimers();
    const vault = StorageVault.getInstance({
      storageKey: 'QUOTA',
      storageType: StorageType.Local,
      debounceMs: 0,
    });

    vault.setItem('stale', 'x', 1000);
    vi.advanceTimersByTime(1001);

    const adapter = vault.getStorageAdapter();
    const writeSpy = vi.spyOn(adapter, 'write');
    // Fail the first write only, as a real quota breach would.
    writeSpy.mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    expect(() => vault.setItem('fresh', 'y')).not.toThrow();

    // First call threw, then cleanup ran and the retry succeeded.
    expect(writeSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('wraps a non-quota write failure in a descriptive error', () => {
    const vault = makeVault();
    vi.spyOn(vault.getStorageAdapter(), 'write').mockImplementation(() => {
      throw new Error('disk on fire');
    });

    expect(() => vault.setItem('k', 'v')).toThrow(/failed to save to storage/i);
  });

  it('surfaces the error when the post-cleanup retry also fails', () => {
    const vault = makeVault();
    // Every write fails, so cleanup frees nothing and the retry fails too.
    vi.spyOn(vault.getStorageAdapter(), 'write').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    expect(() => vault.setItem('k', 'v')).toThrow(/quota exceeded/i);
  });

  // KNOWN DEFECT -- marked `fails` so it documents the behaviour we want
  // without pinning CI red. When the vault is fixed this test starts passing,
  // `it.fails` then reports it as failing, and whoever fixes it must delete
  // this marker. Do not "fix" it by weakening the assertions.
  //
  // Today, when a write exceeds the quota and there is nothing expired to
  // reclaim, handleSaveError retries by re-reading getAllData() from storage --
  // which is the last successfully persisted state, i.e. WITHOUT the new item.
  // That smaller payload fits, so the retry succeeds, the DOMException is
  // swallowed, and setItem returns true having silently discarded the caller's
  // data. Verified against real Chromium too: 20 x 512 KB writes all returned
  // true while only 9 keys survived.
  it.fails(
    'KNOWN DEFECT: setItem reports success while silently dropping data at quota',
    () => {
      const vault = makeVault();
      const adapter = vault.getStorageAdapter();
      const realWrite = adapter.write.bind(adapter);
      const CEILING = 5000;

      // Mimic a full origin: large payloads are refused, smaller ones fit.
      vi.spyOn(adapter, 'write').mockImplementation(
        (key: string, value: string) => {
          if (value.length > CEILING) {
            throw new DOMException('full', 'QuotaExceededError');
          }
          realWrite(key, value);
        }
      );

      const accepted: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        const key = `chunk-${String(i)}`;
        // A `true` return must mean the value is retrievable afterwards.
        if (vault.setItem(key, 'x'.repeat(1000))) accepted.push(key);
      }

      // Currently fails: 8 keys are "accepted" but only ~4 persist.
      expect(vault.getAllKeys().sort()).toEqual(accepted.sort());
    }
  );
});

describe('in-memory item cap', () => {
  it('evicts down to maxItemsInMemory, dropping soonest-expiring first', () => {
    const vault = StorageVault.getInstance({
      storageKey: 'CAPPED',
      storageType: StorageType.InMemory,
      debounceMs: 0,
      maxItemsInMemory: 2,
    });

    // Ascending expiry: 'first' is the soonest to die, so it goes first.
    vault.setItem('first', 1, 1000);
    vault.setItem('second', 2, 50_000);
    vault.setItem('third', 3, 90_000);

    const keys = vault.getAllKeys();
    expect(keys).toHaveLength(2);
    expect(keys).not.toContain('first');
    expect(keys.sort()).toEqual(['second', 'third']);
  });

  it('leaves storage alone while under the cap', () => {
    const vault = StorageVault.getInstance({
      storageKey: 'UNDER_CAP',
      storageType: StorageType.InMemory,
      debounceMs: 0,
      maxItemsInMemory: 10,
    });

    vault.setItem('a', 1);
    vault.setItem('b', 2);

    expect(vault.getAllKeys().sort()).toEqual(['a', 'b']);
  });
});

describe('transforms in the vault', () => {
  it('persists transformed bytes and reads them back', () => {
    const vault = StorageVault.getInstance({
      storageKey: 'TRANSFORMED',
      storageType: StorageType.Local,
      debounceMs: 0,
      transforms: [{ serialize: (d) => btoa(d), deserialize: (d) => atob(d) }],
    });

    vault.setItem('theme', 'dark');

    const raw = localStorage.getItem('TRANSFORMED');
    // Stored form is encoded, not plain JSON...
    expect(raw).not.toContain('dark');
    // ...yet reads transparently decode it.
    expect(vault.getItem('theme')).toBe('dark');
    expect(atob(raw ?? '')).toContain('dark');
  });
});

describe('introspection accessors', () => {
  it('exposes the configuration the vault was built with', () => {
    const vault = StorageVault.getInstance({
      storageKey: 'INTROSPECT',
      storageType: StorageType.InMemory,
      debounceMs: 0,
      maxSizeBytes: 1234,
    });

    expect(vault.getStorageKey()).toBe('INTROSPECT');
    expect(vault.getMaxSizeBytes()).toBe(1234);
    expect(vault.getStorageAdapter().getStorageType()).toBe('memory');
    expect(vault.getTransformChain().hasTransforms()).toBe(false);
  });

  it('getAllData exposes expiry metadata', () => {
    const vault = makeVault();
    vault.setItem('plain', 'v');
    vault.setItem('timed', 'v', 60_000);

    const data = vault.getAllData();

    expect(data.plain).toEqual({ value: 'v', expiry: null });
    expect(data.timed?.expiry).toBeTypeOf('number');
  });

  it('getAllData is isolated against top-level mutation', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });
    vault.setItem('k', 'v');

    const data = vault.getAllData();
    delete data.k;

    expect(vault.getItem('k')).toBe('v');
  });

  it('getAllData is a SHALLOW copy: nested mutation reaches pending writes', () => {
    vi.useFakeTimers();
    const vault = makeVault({ debounceMs: 100 });
    vault.setItem('k', 'original');

    const data = vault.getAllData();
    const record = data.k;
    if (!record) throw new Error('expected a record for k');
    record.value = 'tampered';

    // Documenting the real contract rather than the one we might assume:
    // getAllData() spreads the pending record map one level deep, so the
    // StoredData objects inside are shared with the vault. Callers must treat
    // the result as read-only; deep-cloning it is their responsibility.
    expect(vault.getItem('k')).toBe('tampered');
  });

  it('getCurrentSize grows as data is added', () => {
    const vault = makeVault();
    const empty = vault.getCurrentSize();

    vault.setItem('k', 'a'.repeat(500));

    expect(vault.getCurrentSize()).toBeGreaterThan(empty);
  });
});
