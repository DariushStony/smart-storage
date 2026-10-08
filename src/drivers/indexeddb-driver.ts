import { assertKey } from '../core/validation.js';
import { BaseAsyncStorageDriver } from './base-async-storage-driver.js';
import type { BaseAsyncStorageDriverOptions } from './base-async-storage-driver.js';

interface IndexedDBDriverOptions extends BaseAsyncStorageDriverOptions {
  /** Default 'smart-storage'. */
  databaseName?: string;
  /** Default 'keyval'. Added to an existing database by upgrading it. */
  storeName?: string;
}

/** Stores each vault as one string in an IndexedDB object store. */
class IndexedDBDriver extends BaseAsyncStorageDriver {
  override readonly name: string = 'indexedDB';
  private readonly databaseName: string;
  private readonly storeName: string;
  private connection: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBDriverOptions = {}) {
    super(options);
    // Throwing makes the registered 'indexeddb' driver fall back to memory.
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available here.');
    }
    this.databaseName = options.databaseName ?? 'smart-storage';
    this.storeName = options.storeName ?? 'keyval';
    assertKey(this.databaseName, 'databaseName');
    assertKey(this.storeName, 'storeName');
  }

  protected override async readRaw(key: string): Promise<string | null> {
    const value: unknown = await this.request('readonly', (store) =>
      store.get(key)
    );
    return typeof value === 'string' ? value : null;
  }

  protected override async writeRaw(key: string, value: string): Promise<void> {
    await this.request('readwrite', (store) => store.put(value, key));
  }

  protected override async removeRaw(key: string): Promise<void> {
    await this.request('readwrite', (store) => store.delete(key));
  }

  private async request<T>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode);
      const request = makeRequest(transaction.objectStore(this.storeName));
      // Settle on the transaction, so a resolved write is durable.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new DOMException('The transaction was aborted.', 'AbortError')
        );
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;

    const connection = openStore(this.databaseName, this.storeName);
    this.connection = connection;
    // Forget a failed or closed connection, so the next call reopens.
    void connection.then(
      (database) => {
        database.onversionchange = () => {
          database.close();
          if (this.connection === connection) this.connection = null;
        };
      },
      () => {
        if (this.connection === connection) this.connection = null;
      }
    );
    return connection;
  }
}

/** Opens the database, creating the store (one version up) if it is missing. */
function openStore(
  databaseName: string,
  storeName: string,
  version?: number
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(databaseName)
        : indexedDB.open(databaseName, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(storeName)) {
        resolve(database);
        return;
      }
      const next = database.version + 1;
      database.close();
      openStore(databaseName, storeName, next).then(resolve, reject);
    };
    request.onerror = () => reject(request.error);
  });
}

export { IndexedDBDriver };
export type { IndexedDBDriverOptions };
