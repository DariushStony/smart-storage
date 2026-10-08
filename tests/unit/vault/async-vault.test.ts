import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { AsyncCodec } from '../../../src/codec/async-codec.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import {
  registerAsyncDriver,
  resetDriverRegistry,
} from '../../../src/drivers/driver-registry.js';
import { resetIndexedDBBuiltIn } from '../../../src/drivers/indexeddb-builtin.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  StorageArgumentError,
  StorageConflictError,
  StorageCorruptionError,
  StorageDisposedError,
  StorageQuotaError,
  StorageUnavailableError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import type {
  AsyncVault,
  AsyncVaultOptions,
} from '../../../src/vault/async-vault.js';
import { createAsyncVault } from '../../../src/vault/create-async-vault.js';
import { createVault } from '../../../src/vault/create-vault.js';
import type { Vault } from '../../../src/vault/vault.js';

interface Harness {
  vault: AsyncVault;
  driver: AsyncMemoryDriver;
  onError: Mock<(error: StorageError) => void>;
  raw: () => Promise<string | null>;
}

const created: Array<AsyncVault | Vault> = [];
let counter = 0;

function makeVault(
  options: Partial<AsyncVaultOptions> = {},
  driver = new AsyncMemoryDriver()
): Harness {
  counter += 1;
  const onError = vi.fn<(error: StorageError) => void>();
  const vault = createAsyncVault({
    key: `ASYNC_${String(counter)}`,
    driver,
    onError,
    ...options,
  });
  created.push(vault);
  return { vault, driver, onError, raw: () => driver.read(vault.key) };
}

beforeEach(() => {
  resetDriverRegistry();
  resetIndexedDBBuiltIn();
  vi.useFakeTimers({
    now: 1_000,
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
});

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((vault) => Promise.resolve(vault.dispose()))
  );
  vi.useRealTimers();
  resetDriverRegistry();
  resetIndexedDBBuiltIn();
});

describe('createAsyncVault', () => {
  it('validates its options synchronously', () => {
    expect(() => createAsyncVault({ key: '' })).toThrow(StorageArgumentError);
  });

  it('stores values as the v2 envelope and returns fresh copies', async () => {
    const { vault, raw } = makeVault();
    await vault.set('a', { n: 1 });

    const read = await vault.get<{ n: number }>('a');
    if (read) read.n = 2;

    expect(await vault.get('a')).toEqual({ n: 1 });
    expect(await raw()).toBe('{"v":2,"items":[{"key":"a","value":{"n":1}}]}');
  });

  it('rejects bad arguments instead of throwing synchronously', async () => {
    const { vault } = makeVault();
    let pending: Promise<void> | undefined;

    expect(() => {
      pending = vault.set('', 1);
    }).not.toThrow();
    await expect(pending).rejects.toThrow(StorageArgumentError);
    await expect(vault.set('k', undefined)).rejects.toThrow(
      StorageArgumentError
    );
    await expect(vault.extend('k', 0)).rejects.toThrow(StorageArgumentError);
  });
});

describe('ordering', () => {
  it('runs 50 concurrent writes in order without losing any', async () => {
    const { vault } = makeVault();
    const names = Array.from({ length: 50 }, (_, i) => `k${String(i)}`);

    await Promise.all(names.map((name, i) => vault.set(name, i)));

    expect(await vault.keys()).toEqual(names);
  });

  it('a read queued after a write sees it', async () => {
    const { vault } = makeVault();

    const [, value] = await Promise.all([vault.set('a', 1), vault.get('a')]);

    expect(value).toBe(1);
  });

  it('a failed call does not block the calls after it', async () => {
    const { vault } = makeVault();
    const failing = vault.set('', 1);
    const next = vault.set('ok', 1);

    await expect(failing).rejects.toThrow(StorageArgumentError);
    await next;
    expect(await vault.get('ok')).toBe(1);
  });
});

describe('same semantics as the sync vault', () => {
  it('expiry, update, extend, ttl and remove', async () => {
    const { vault } = makeVault();
    await vault.set('t', 'x', { ttl: 500 });
    vi.advanceTimersByTime(200);

    expect(await vault.ttl('t')).toBe(300);
    expect(await vault.update('t', 'y')).toBe(true);
    expect(await vault.ttl('t')).toBe(300);
    expect(await vault.extend('t', 100)).toBe(true);
    expect(await vault.ttl('t')).toBe(400);

    vi.advanceTimersByTime(401);
    expect(await vault.get('t')).toBeNull();
    expect(await vault.has('t')).toBe(false);
    expect(await vault.update('t', 'z')).toBe(false);
    expect(await vault.remove('t')).toBe(false);
  });

  it('keys, toObject, purgeExpired and clear', async () => {
    const { vault, raw } = makeVault();
    await vault.set('a', 1);
    await vault.set('gone', 2, { ttl: 10 });
    vi.advanceTimersByTime(11);

    expect(await vault.toObject()).toEqual({ a: 1 });
    expect(await vault.purgeExpired()).toBe(1);
    await vault.clear();
    expect(await raw()).toBeNull();
  });

  it('rejects a write over maxBytes and keeps what was stored', async () => {
    const { vault, raw } = makeVault({ maxBytes: 100 });
    await vault.set('a', 1);
    const before = await raw();

    await expect(vault.set('big', 'x'.repeat(200))).rejects.toThrow(
      StorageQuotaError
    );
    expect(await raw()).toBe(before);
  });

  it('reports corrupted data, and reads 1.x data', async () => {
    const driver = new AsyncMemoryDriver();
    await driver.write('BROKEN', 'not json');
    await driver.write(
      'LEGACY',
      JSON.stringify({ theme: { value: 'dark', expiry: null } })
    );
    const broken = makeVault({ key: 'BROKEN' }, driver);
    const legacy = makeVault({ key: 'LEGACY' }, driver);

    expect(await broken.vault.get('a')).toBeNull();
    expect(broken.onError).toHaveBeenCalledWith(
      expect.any(StorageCorruptionError)
    );
    expect(await legacy.vault.get('theme')).toBe('dark');
  });

  it('stats() describes the stored data', async () => {
    const { vault, raw } = makeVault({ maxBytes: 1000 });
    await vault.set('a', 1);

    const stats = await vault.stats();

    expect(stats).toMatchObject({
      driver: 'memory',
      itemCount: 1,
      maxBytes: 1000,
    });
    expect(stats.bytes).toBe((await raw())?.length);
  });
});

describe('debounced async vault', () => {
  it('reads its own pending write and saves after the delay', async () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    await vault.set('a', 1);
    expect(await vault.get('a')).toBe(1);
    expect(await raw()).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(await raw()).toBe(
      encodeEnvelope(Snapshot.empty.with('a', { json: '1', expiresAt: null }))
    );
  });

  it('reports a failed deferred write, and flush() rejects with it', async () => {
    const { vault, onError } = makeVault({ debounceMs: 100, maxBytes: 60 });

    await vault.set('big', 'x'.repeat(100));
    await vi.advanceTimersByTimeAsync(100);

    expect(onError).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    await expect(vault.flush()).rejects.toThrow(StorageQuotaError);
  });

  it('dispose() saves the pending write', async () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    await vault.set('a', 1);
    await vault.dispose();

    expect(await raw()).not.toBeNull();
  });
});

describe('dispose and takeover', () => {
  it('rejects every call after dispose', async () => {
    const { vault } = makeVault();
    await vault.dispose();

    await expect(vault.get('a')).rejects.toThrow(StorageDisposedError);
    await expect(vault.set('a', 1)).rejects.toThrow(StorageDisposedError);
    await expect(vault.stats()).rejects.toThrow(StorageDisposedError);
    await expect(vault.dispose()).resolves.toBeUndefined();
  });

  it('a newer vault waits for the retired one to save its pending write', async () => {
    const driver = new AsyncMemoryDriver();
    const first = createAsyncVault({ key: 'K', driver, debounceMs: 1000 });
    created.push(first);
    await first.set('a', 1);

    const onError = vi.fn<(error: StorageError) => void>();
    const second = createAsyncVault({ key: 'K', driver, onError });
    created.push(second);

    expect(await second.get('a')).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
    await expect(first.get('a')).rejects.toThrow(StorageDisposedError);
  });

  it('a sync and an async vault on one driver conflict', () => {
    const driver = new MemoryDriver();
    created.push(createVault({ key: 'K', driver }));
    const onError = vi.fn<(error: StorageError) => void>();

    created.push(createAsyncVault({ key: 'K', driver, onError }));

    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
  });
});

describe('drivers and codecs', () => {
  it('uses sync driver names such as local', async () => {
    localStorage.clear();
    const vault = createAsyncVault({ key: 'ASYNC_LOCAL', driver: 'local' });
    created.push(vault);

    await vault.set('a', 1);

    expect(localStorage.getItem('ASYNC_LOCAL')).not.toBeNull();
  });

  it('round-trips through an async codec', async () => {
    const reverse: AsyncCodec = {
      encode: async (text) => {
        await Promise.resolve();
        return text.split('').reverse().join('');
      },
      decode: (text) => text.split('').reverse().join(''),
    };
    const { vault, raw } = makeVault({ codecs: [reverse] });

    await vault.set('a', 1);

    expect(await raw()).not.toContain('"v":2');
    expect(await vault.get('a')).toBe(1);
  });

  it('uses a registered async driver by name', async () => {
    const driver = new AsyncMemoryDriver();
    registerAsyncDriver('remote', () => driver);
    const vault = createAsyncVault({ key: 'REMOTE', driver: 'remote' });
    created.push(vault);

    await vault.set('a', 1);

    expect(await driver.read('REMOTE')).not.toBeNull();
  });

  it('createVault refuses async drivers', () => {
    registerAsyncDriver('remote', () => new AsyncMemoryDriver());

    expect(() => createVault({ key: 'K', driver: 'indexeddb' })).toThrow(
      /createAsyncVault/
    );
    expect(() => createVault({ key: 'K2', driver: 'remote' })).toThrow(
      /createAsyncVault/
    );
    const vault = createVault({
      key: 'K3',
      driver: new AsyncMemoryDriver() as unknown as MemoryDriver,
    });
    created.push(vault);
    expect(() => vault.get('a')).toThrow(StorageArgumentError);
  });
});

describe('the default IndexedDB driver', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('defaults to IndexedDB', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const vault = createAsyncVault({ key: 'IDB_DEFAULT' });
    created.push(vault);

    await vault.set('a', 1);

    expect((await vault.stats()).driver).toBe('indexedDB');
    expect(await vault.get('a')).toBe(1);
  });

  it('falls back to memory and reports it when a browser has no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const onError = vi.fn<(error: StorageError) => void>();
    const vault = createAsyncVault({ key: 'NO_IDB', onError });
    created.push(vault);

    await vault.set('a', 1);

    expect(await vault.get('a')).toBe(1);
    expect((await vault.stats()).driver).toBe('memory');
    expect(onError).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });

  it('uses memory silently on the server', async () => {
    vi.stubGlobal('window', undefined);
    const onError = vi.fn<(error: StorageError) => void>();
    const vault = createAsyncVault({ key: 'SSR', onError });
    created.push(vault);

    await vault.set('a', 1);

    expect(await vault.get('a')).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
