import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { utf8ByteLength } from '../../../src/core/byte-size.js';
import type { Codec } from '../../../src/codec/codec.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import { resetDriverRegistry } from '../../../src/drivers/driver-registry.js';
import {
  StorageAccessError,
  StorageArgumentError,
  StorageCorruptionError,
  StorageDisposedError,
  StorageQuotaError,
  StorageSerializationError,
  StorageUnavailableError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { createVault } from '../../../src/vault/create-vault.js';
import type {
  SetOptions,
  Vault,
  VaultOptions,
} from '../../../src/vault/vault.js';

interface Harness {
  vault: Vault;
  driver: MemoryDriver;
  onError: Mock<(error: StorageError) => void>;
  raw: () => string | null;
}

const created: Vault[] = [];
let counter = 0;

/** Every vault gets its own MemoryDriver and key, so tests never share state. */
function makeVault(
  options: Partial<VaultOptions> = {},
  driver = new MemoryDriver()
): Harness {
  counter += 1;
  const onError = vi.fn<(error: StorageError) => void>();
  const vault = createVault({
    key: `VAULT_${String(counter)}`,
    driver,
    onError,
    ...options,
  });
  created.push(vault);
  return { vault, driver, onError, raw: () => driver.read(vault.key) };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000 });
});

afterEach(() => {
  created.splice(0).forEach((vault) => vault.dispose());
  vi.useRealTimers();
});

describe('get / set', () => {
  it('stores and reads primitives and objects', () => {
    const { vault } = makeVault();

    vault.set('theme', 'dark');
    vault.set('user', { id: 1, tags: ['a'] });

    expect(vault.get('theme')).toBe('dark');
    expect(vault.get('user')).toEqual({ id: 1, tags: ['a'] });
  });

  it('returns null for a missing key', () => {
    expect(makeVault().vault.get('missing')).toBeNull();
  });

  it('returns a fresh copy every time', () => {
    const { vault } = makeVault();
    const input = { count: 1 };
    vault.set('obj', input);

    input.count = 2;
    const read = vault.get<{ count: number }>('obj');
    if (read) read.count = 3;

    expect(vault.get('obj')).toEqual({ count: 1 });
  });

  // Review focus: values round-trip through JSON.
  it('returns what JSON makes of a value, e.g. a Date becomes its ISO string', () => {
    const { vault } = makeVault();
    const date = new Date(0);

    vault.set('when', date);

    expect(vault.get('when')).toBe(date.toISOString());
  });

  // Review focus: a stored null reads like a missing key; has() tells them apart.
  it('stores null, and has() distinguishes it from a missing key', () => {
    const { vault } = makeVault();

    vault.set('nothing', null);

    expect(vault.get('nothing')).toBeNull();
    expect(vault.has('nothing')).toBe(true);
    expect(vault.has('missing')).toBe(false);
  });

  it('treats keys literally, including surrounding spaces', () => {
    const { vault } = makeVault();

    vault.set(' a ', 1);

    expect(vault.get(' a ')).toBe(1);
    expect(vault.get('a')).toBeNull();
  });

  it('writes the v2 envelope immediately by default', () => {
    const { vault, raw } = makeVault();

    vault.set('a', 1);

    expect(raw()).toBe('{"v":2,"items":[{"key":"a","value":1}]}');
  });

  it.each([
    ['an empty key', '', 1],
    ['a whitespace key', '  ', 1],
    ['undefined', 'k', undefined],
  ])('rejects %s with StorageArgumentError', (_label, key, value) => {
    expect(() => makeVault().vault.set(key, value)).toThrow(
      StorageArgumentError
    );
  });

  it.each([0, -5, NaN, Infinity])('rejects ttl %j', (ttl) => {
    expect(() => makeVault().vault.set('k', 1, { ttl })).toThrow(
      StorageArgumentError
    );
  });

  it('rejects values JSON cannot represent', () => {
    const { vault } = makeVault();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => vault.set('fn', () => 1)).toThrow(StorageSerializationError);
    expect(() => vault.set('loop', circular)).toThrow(
      StorageSerializationError
    );
  });

  it('accepts keys that look like prototype properties', () => {
    const { vault } = makeVault();

    vault.set('__proto__', { polluted: true });
    vault.set('constructor', 'c');

    expect(vault.get('__proto__')).toEqual({ polluted: true });
    expect(vault.get('constructor')).toBe('c');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('expiry', () => {
  it('hides an item once its ttl has passed', () => {
    const { vault } = makeVault();
    vault.set('token', 'x', { ttl: 500 });

    vi.advanceTimersByTime(500);
    expect(vault.get('token')).toBe('x');

    vi.advanceTimersByTime(1);
    expect(vault.get('token')).toBeNull();
    expect(vault.has('token')).toBe(false);
    expect(vault.ttl('token')).toBeNull();
  });

  it('ttl() counts down, and is Infinity for items that never expire', () => {
    const { vault } = makeVault();
    vault.set('temp', 1, { ttl: 1000 });
    vault.set('perm', 2);

    vi.advanceTimersByTime(400);

    expect(vault.ttl('temp')).toBe(600);
    expect(vault.ttl('perm')).toBe(Infinity);
    expect(vault.ttl('missing')).toBeNull();
  });

  it('update() replaces the value and keeps the expiry', () => {
    const { vault } = makeVault();
    vault.set('k', 1, { ttl: 1000 });
    vi.advanceTimersByTime(400);

    expect(vault.update('k', 2)).toBe(true);
    expect(vault.get('k')).toBe(2);
    expect(vault.ttl('k')).toBe(600);
  });

  it('update() returns false for missing or expired items', () => {
    const { vault } = makeVault();
    vault.set('gone', 1, { ttl: 10 });
    vi.advanceTimersByTime(11);

    expect(vault.update('missing', 1)).toBe(false);
    expect(vault.update('gone', 1)).toBe(false);
  });

  it('extend() adds time to an expiring item', () => {
    const { vault } = makeVault();
    vault.set('k', 1, { ttl: 1000 });

    expect(vault.extend('k', 500)).toBe(true);
    expect(vault.ttl('k')).toBe(1500);
  });

  it('extend() leaves a non-expiring item non-expiring, without writing', () => {
    const { vault, driver } = makeVault();
    vault.set('k', 1);
    const write = vi.spyOn(driver, 'write');

    expect(vault.extend('k', 500)).toBe(true);
    expect(vault.ttl('k')).toBe(Infinity);
    expect(write).not.toHaveBeenCalled();
  });

  it('extend() returns false for missing items and rejects bad durations', () => {
    const { vault } = makeVault();
    vault.set('k', 1);

    expect(vault.extend('missing', 10)).toBe(false);
    expect(() => vault.extend('k', 0)).toThrow(StorageArgumentError);
  });

  it('reads never write, even when they find expired items', () => {
    const { vault, driver } = makeVault();
    vault.set('k', 1, { ttl: 10 });
    vi.advanceTimersByTime(11);
    const write = vi.spyOn(driver, 'write');
    const remove = vi.spyOn(driver, 'remove');

    vault.get('k');
    vault.has('k');
    vault.ttl('k');
    vault.keys();
    vault.toObject();
    vault.stats();

    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('the next write drops expired items from storage', () => {
    const { vault, raw } = makeVault();
    vault.set('old', 1, { ttl: 10 });
    vi.advanceTimersByTime(11);

    vault.set('new', 2);

    expect(raw()).toBe('{"v":2,"items":[{"key":"new","value":2}]}');
  });

  it('purgeExpired() removes expired items and reports the count', () => {
    const { vault, raw } = makeVault();
    vault.set('a', 1, { ttl: 10 });
    vault.set('b', 2, { ttl: 10 });
    vault.set('c', 3);
    vi.advanceTimersByTime(11);

    expect(vault.purgeExpired()).toBe(2);
    expect(raw()).toBe('{"v":2,"items":[{"key":"c","value":3}]}');
    expect(vault.purgeExpired()).toBe(0);
  });
});

describe('remove / keys / toObject / clear', () => {
  it('remove() deletes a live item and reports whether it did', () => {
    const { vault } = makeVault();
    vault.set('a', 1);
    vault.set('gone', 1, { ttl: 10 });
    vi.advanceTimersByTime(11);

    expect(vault.remove('a')).toBe(true);
    expect(vault.get('a')).toBeNull();
    expect(vault.remove('a')).toBe(false);
    expect(vault.remove('gone')).toBe(false);
  });

  it('keys() lists live keys, least recently written first', () => {
    const { vault } = makeVault();
    vault.set('a', 1);
    vault.set('b', 2);
    vault.set('gone', 3, { ttl: 10 });
    vault.set('a', 4);
    vi.advanceTimersByTime(11);

    expect(vault.keys()).toEqual(['b', 'a']);
  });

  it('toObject() returns live items as own properties', () => {
    const { vault } = makeVault();
    vault.set('a', 1);
    vault.set('__proto__', 'p');

    const object = vault.toObject();

    expect(Object.keys(object)).toEqual(['a', '__proto__']);
    expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
  });

  it('clear() removes the storage key', () => {
    const { vault, raw } = makeVault();
    vault.set('a', 1);

    vault.clear();

    expect(raw()).toBeNull();
    expect(vault.keys()).toEqual([]);
  });
});

describe('limits', () => {
  it('maxItems evicts the least recently written items', () => {
    const { vault } = makeVault({ maxItems: 2 });
    vault.set('a', 1);
    vault.set('b', 2);
    vault.update('a', 10);
    vault.set('c', 3);

    expect(vault.keys()).toEqual(['a', 'c']);
  });

  it('maxItems never evicts the item being written', () => {
    const { vault } = makeVault({ maxItems: 1 });
    vault.set('a', 1);
    vault.set('b', 2, { ttl: 5 });

    expect(vault.keys()).toEqual(['b']);
  });

  // The 1.x defect, end to end: a write that does not fit must throw and
  // leave everything already stored intact.
  it('a write over maxBytes throws StorageQuotaError and changes nothing', () => {
    const { vault, raw } = makeVault({ maxBytes: 100 });
    vault.set('a', 1);
    const before = raw();

    expect(() => vault.set('big', 'x'.repeat(200))).toThrow(StorageQuotaError);
    expect(raw()).toBe(before);
    expect(vault.keys()).toEqual(['a']);
  });

  it('can still shrink stored data that is already over maxBytes', () => {
    const driver = new MemoryDriver();
    driver.write(
      'BIG',
      JSON.stringify({
        a: { value: 'x'.repeat(200), expiry: null },
        b: { value: 1, expiry: null },
      })
    );
    const { vault } = makeVault({ key: 'BIG', maxBytes: 100 }, driver);

    expect(vault.remove('b')).toBe(true);
    expect(() => vault.set('c', 'more')).toThrow(StorageQuotaError);
    expect(vault.remove('a')).toBe(true);
    vault.set('c', 'more');

    expect(vault.keys()).toEqual(['c']);
  });

  it('stats() describes the stored data', () => {
    const { vault, raw } = makeVault({ maxBytes: 1000 });
    vault.set('a', 'é');
    vault.set('gone', 1, { ttl: 10 });
    vi.advanceTimersByTime(11);
    vault.set('b', 2);

    const bytes = utf8ByteLength(raw() ?? '');
    expect(vault.stats()).toEqual({
      key: vault.key,
      driver: 'memory',
      itemCount: 2,
      bytes,
      maxBytes: 1000,
      usage: bytes / 1000,
    });
  });
});

describe('persistence and sharing', () => {
  it('a new vault on the same driver reads what a disposed one wrote', () => {
    const driver = new MemoryDriver();
    const first = createVault({ key: 'SHARED', driver });
    first.set('a', 1);
    first.dispose();

    const second = createVault({ key: 'SHARED', driver });
    created.push(second);

    expect(second.get('a')).toBe(1);
  });

  it('sees data another tab wrote under its key', () => {
    const { vault, driver } = makeVault();
    vault.set('a', 1);

    driver.write(vault.key, '{"v":2,"items":[{"key":"b","value":2}]}');

    expect(vault.keys()).toEqual(['b']);
  });

  it('reads 1.x data and rewrites it as v2 on the next write', () => {
    const driver = new MemoryDriver();
    driver.write(
      'LEGACY',
      JSON.stringify({ theme: { value: 'dark', expiry: null } })
    );
    const vault = createVault({ key: 'LEGACY', driver });
    created.push(vault);

    expect(vault.get('theme')).toBe('dark');
    vault.set('lang', 'fa');
    expect(driver.read('LEGACY')).toBe(
      '{"v":2,"items":[{"key":"theme","value":"dark"},{"key":"lang","value":"fa"}]}'
    );
  });

  it('reports unreadable data, reads it as empty, and recovers on write', () => {
    const driver = new MemoryDriver();
    driver.write('BROKEN', 'not json');
    const { vault, onError } = makeVault({ key: 'BROKEN' }, driver);

    expect(vault.get('a')).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.any(StorageCorruptionError));

    vault.set('a', 1);
    expect(vault.get('a')).toBe(1);
  });

  it('ignores an onError handler that throws', () => {
    const driver = new MemoryDriver();
    driver.write('NOISY', 'not json');
    const vault = createVault({
      key: 'NOISY',
      driver,
      onError: () => {
        throw new Error('logger down');
      },
    });
    created.push(vault);

    expect(vault.get('a')).toBeNull();
  });
});

describe('debounced vault', () => {
  it('holds writes, reads its own writes, and persists after the delay', () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    vault.set('a', 1);
    expect(vault.get('a')).toBe(1);
    expect(raw()).toBeNull();

    vi.advanceTimersByTime(100);
    expect(raw()).toBe('{"v":2,"items":[{"key":"a","value":1}]}');
  });

  it('flush() writes now', () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    vault.set('a', 1);
    vault.flush();

    expect(raw()).not.toBeNull();
  });

  it('reports a deferred quota failure instead of throwing, and flush() throws it', () => {
    const { vault, onError } = makeVault({ debounceMs: 100, maxBytes: 60 });

    expect(() => vault.set('big', 'x'.repeat(100))).not.toThrow();
    vi.advanceTimersByTime(100);

    expect(onError).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    expect(() => vault.flush()).toThrow(StorageQuotaError);
  });

  it('clear() drops a pending write', () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    vault.set('a', 1);
    vault.clear();
    vi.advanceTimersByTime(100);

    expect(raw()).toBeNull();
    expect(vault.get('a')).toBeNull();
  });

  it('dispose() flushes the pending write', () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    vault.set('a', 1);
    vault.dispose();

    expect(raw()).not.toBeNull();
  });

  it('dispose() reports a failed flush instead of throwing', () => {
    const { vault, onError } = makeVault({ debounceMs: 100, maxBytes: 60 });
    vault.set('big', 'x'.repeat(100));

    expect(() => vault.dispose()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(StorageQuotaError));
  });
});

describe('dispose', () => {
  it('makes every method throw StorageDisposedError', () => {
    const { vault } = makeVault();
    vault.dispose();

    const calls: Array<() => unknown> = [
      () => vault.get('a'),
      () => vault.set('a', 1),
      () => vault.has('a'),
      () => vault.update('a', 1),
      () => vault.extend('a', 1),
      () => vault.ttl('a'),
      () => vault.remove('a'),
      () => vault.keys(),
      () => vault.toObject(),
      () => vault.clear(),
      () => vault.purgeExpired(),
      () => vault.flush(),
      () => vault.stats(),
    ];
    for (const call of calls) {
      expect(call).toThrow(StorageDisposedError);
    }
  });

  it('is idempotent', () => {
    const { vault } = makeVault();
    vault.dispose();
    expect(() => vault.dispose()).not.toThrow();
  });
});

describe('default driver', () => {
  beforeEach(() => {
    resetDriverRegistry();
    localStorage.clear();
  });

  afterEach(() => {
    resetDriverRegistry();
  });

  it('uses window.localStorage when no driver is given', () => {
    const vault = createVault({ key: 'DEFAULT_DRIVER' });
    created.push(vault);

    vault.set('a', 1);

    expect(localStorage.getItem('DEFAULT_DRIVER')).not.toBeNull();
    expect(vault.stats().driver).toBe('localStorage');
  });

  it('falls back to memory and reports it when storage is blocked', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const onError = vi.fn<(error: StorageError) => void>();
    const vault = createVault({ key: 'BLOCKED', onError });
    created.push(vault);

    vault.set('a', 1);

    expect(vault.get('a')).toBe(1);
    expect(vault.stats().driver).toBe('memory');
    expect(onError).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });
});

describe('edge cases', () => {
  it('rejects a ttl whose expiry would pass the largest safe timestamp', () => {
    const { vault } = makeVault();

    expect(() => vault.set('k', 1, { ttl: Number.MAX_VALUE })).toThrow(
      StorageArgumentError
    );
    expect(vault.has('k')).toBe(false);
  });

  // Regression: an overflowing extend() stored "expiresAt":Infinity, which
  // made the whole key unreadable after a reload.
  it('rejects an extension whose expiry would overflow and keeps the item as it was', () => {
    const { vault } = makeVault();
    vault.set('k', 1, { ttl: 1000 });

    expect(() => vault.extend('k', Number.MAX_SAFE_INTEGER)).toThrow(
      StorageArgumentError
    );
    expect(vault.ttl('k')).toBe(1000);
  });

  it('update() rejects undefined even when the key is missing', () => {
    expect(() => makeVault().vault.update('missing', undefined)).toThrow(
      StorageArgumentError
    );
  });

  it('set() rejects options that are not an object', () => {
    const { vault } = makeVault();

    expect(() => vault.set('k', 1, null as unknown as SetOptions)).toThrow(
      StorageArgumentError
    );
    expect(() => vault.set('k', 1, 5 as unknown as SetOptions)).toThrow(
      StorageArgumentError
    );
  });

  it('stats().bytes is the size of the stored string, even when it is unreadable', () => {
    const driver = new MemoryDriver();
    driver.write('RAW', 'x'.repeat(5000));
    const { vault } = makeVault({ key: 'RAW' }, driver);

    expect(vault.stats().bytes).toBe(5000);
    expect(vault.stats().itemCount).toBe(0);
  });

  it('stats().bytes counts expired items that are still stored', () => {
    const { vault, raw } = makeVault();
    vault.set('old', 'x'.repeat(100), { ttl: 10 });
    vi.advanceTimersByTime(11);

    expect(vault.stats().bytes).toBe(utf8ByteLength(raw() ?? ''));
    expect(vault.stats().itemCount).toBe(0);
  });

  it('stats().bytes reports the size a pending debounced write will have', () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });
    vault.set('a', 'é');
    const pendingBytes = vault.stats().bytes;

    vault.flush();

    expect(pendingBytes).toBe(utf8ByteLength(raw() ?? ''));
  });

  it('clear() keeps a pending write when removing the key fails', () => {
    const { vault, driver } = makeVault({ debounceMs: 100 });
    vault.set('a', 1);
    vi.spyOn(driver, 'remove').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => vault.clear()).toThrow(StorageAccessError);
    expect(vault.get('a')).toBe(1);
  });

  it('purgeExpired() counts only expired items, not maxItems evictions', () => {
    const driver = new MemoryDriver();
    driver.write(
      'OVER',
      JSON.stringify({
        v: 2,
        items: [
          { key: 'a', value: 1 },
          { key: 'b', value: 2 },
          { key: 'c', value: 3 },
          { key: 'gone', value: 4, expiresAt: 500 },
        ],
      })
    );
    const { vault } = makeVault({ key: 'OVER', maxItems: 2 }, driver);

    expect(vault.purgeExpired()).toBe(1);
    expect(vault.keys()).toEqual(['b', 'c']);
  });

  it('an item is still live at exactly expiresAt and gone 1 ms later, as in 1.x', () => {
    const { vault } = makeVault();
    vault.set('k', 1, { ttl: 500 });

    vi.advanceTimersByTime(500);
    expect(vault.get('k')).toBe(1);
    expect(vault.ttl('k')).toBe(0);

    vi.advanceTimersByTime(1);
    expect(vault.get('k')).toBeNull();
  });
});

// Plain JavaScript callers get no type errors, so the sync vault checks.
describe('async parts handed to the sync vault', () => {
  const asyncCodec = {
    encode: (text: string) => Promise.resolve(text),
    decode: (text: string) => Promise.resolve(text),
  } as unknown as Codec;

  it('refuses an async codec on write instead of storing "[object Promise]"', () => {
    const { vault, raw } = makeVault({ codecs: [asyncCodec] });

    expect(() => vault.set('a', 1)).toThrow(StorageArgumentError);
    expect(() => vault.set('a', 1)).toThrow(/createAsyncVault/);
    expect(raw()).toBeNull();
  });

  it('refuses an async codec on read, rather than reporting the data as corrupt', () => {
    const driver = new MemoryDriver();
    driver.write('CODEC', '{"v":2,"items":[{"key":"keep","value":1}]}');
    const { vault, onError } = makeVault(
      { key: 'CODEC', codecs: [asyncCodec] },
      driver
    );

    expect(() => vault.get('keep')).toThrow(StorageArgumentError);
    expect(onError).not.toHaveBeenCalled();
    expect(driver.read('CODEC')).toBe(
      '{"v":2,"items":[{"key":"keep","value":1}]}'
    );
  });

  it('clear() refuses an async driver', () => {
    const vault = createVault({
      key: 'ASYNC_CLEAR',
      driver: new AsyncMemoryDriver() as unknown as MemoryDriver,
    });
    created.push(vault);

    expect(() => vault.clear()).toThrow(StorageArgumentError);
  });
});
