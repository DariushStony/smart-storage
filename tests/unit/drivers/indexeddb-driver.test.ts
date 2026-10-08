import {
  IDBObjectStore as FakeObjectStore,
  IDBFactory,
  forceCloseDatabase,
} from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedDBDriver } from '../../../src/drivers/indexeddb-driver.js';
import { assertAsyncStorageDriver } from '../../../src/testing/index.js';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openRaw(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(name)
        : indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDBDriver', () => {
  it('honours the async driver contract', async () => {
    await assertAsyncStorageDriver(
      () => new IndexedDBDriver({ databaseName: 'kit' })
    );
  });

  it('persists across driver instances on the same database', async () => {
    await new IndexedDBDriver({ databaseName: 'shared' }).write('k', 'v');

    expect(
      await new IndexedDBDriver({ databaseName: 'shared' }).read('k')
    ).toBe('v');
  });

  it('opens the database lazily, on first use', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const driver = new IndexedDBDriver({ databaseName: 'lazy' });
    expect(open).not.toHaveBeenCalled();

    await driver.read('k');
    expect(open).toHaveBeenCalled();
  });

  it('adds a missing store to an existing database by upgrading it', async () => {
    await new IndexedDBDriver({ databaseName: 'multi', storeName: 'a' }).write(
      'k',
      'from a'
    );
    const b = new IndexedDBDriver({ databaseName: 'multi', storeName: 'b' });

    await b.write('k', 'from b');

    expect(await b.read('k')).toBe('from b');
    expect(
      await new IndexedDBDriver({ databaseName: 'multi', storeName: 'a' }).read(
        'k'
      )
    ).toBe('from a');
  });

  it('closes on versionchange so another tab can upgrade, then reopens', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'upgrade' });
    await driver.write('k', 'v');

    const other = await openRaw('upgrade', 5);
    other.close();

    expect(await driver.read('k')).toBe('v');
  });

  it('retries opening after a failed open', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'retry' });
    vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    await expect(driver.read('k')).rejects.toThrow('denied');
    expect(await driver.read('k')).toBeNull();
  });

  it('rejects with the original error, keeping a quota error name', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'quota' });
    await driver.read('k');
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    await expect(driver.write('k', 'v')).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  // Site data cleared, or Safari's "Connection to Indexed Database server lost".
  it('reopens after the browser closes its connection', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'lost' });
    await driver.write('k', 'v');
    const connection = (
      driver as unknown as { connection: Promise<IDBDatabase> | null }
    ).connection;
    if (!connection) throw new Error('expected an open connection');
    // fake-indexeddb types this parameter as the class rather than an instance.
    forceCloseDatabase(
      (await connection) as unknown as Parameters<typeof forceCloseDatabase>[0]
    );

    expect(await driver.read('k')).toBe('v');
  });

  it('rejects instead of hanging when an upgrade is blocked by another connection', async () => {
    const other = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blocked');
      request.onupgradeneeded = () => {
        request.result.createObjectStore('other');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Ignores versionchange, like many IndexedDB wrappers do by default.
    other.onversionchange = null;

    await expect(
      new IndexedDBDriver({ databaseName: 'blocked' }).read('k')
    ).rejects.toThrow(/blocked/);
    other.close();
  });

  it('keeps namespaces apart in one store', async () => {
    const a = new IndexedDBDriver({ databaseName: 'ns', namespace: 'a' });
    const b = new IndexedDBDriver({ databaseName: 'ns', namespace: 'b' });

    await a.write('k', 'from a');
    await b.write('k', 'from b');

    expect(await a.read('k')).toBe('from a');
    expect(await b.read('k')).toBe('from b');
  });

  it('throws on construction where IndexedDB does not exist', () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(() => new IndexedDBDriver()).toThrow(/IndexedDB/);
  });
});
