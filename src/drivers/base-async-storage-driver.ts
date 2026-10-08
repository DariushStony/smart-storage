import type { AsyncStorageDriver } from './async-storage-driver.js';
import { namespacePrefix } from './base-storage-driver.js';
import type { BaseStorageDriverOptions } from './base-storage-driver.js';

type BaseAsyncStorageDriverOptions = BaseStorageDriverOptions;

/**
 * The async counterpart of BaseStorageDriver (Template Method): implement
 * the three raw methods. The public methods add the namespace, and are
 * async so even a raw method that throws synchronously ends up rejecting.
 */
abstract class BaseAsyncStorageDriver implements AsyncStorageDriver {
  abstract readonly name: string;
  readonly #prefix: string;

  constructor(options: BaseAsyncStorageDriverOptions = {}) {
    this.#prefix = namespacePrefix(options.namespace);
  }

  async read(key: string): Promise<string | null> {
    return this.readRaw(this.#prefix + key);
  }

  async write(key: string, value: string): Promise<void> {
    return this.writeRaw(this.#prefix + key, value);
  }

  async remove(key: string): Promise<void> {
    return this.removeRaw(this.#prefix + key);
  }

  /** Resolve with the stored string, or null when there is none. */
  protected abstract readRaw(key: string): Promise<string | null>;
  /** Store the string. Reject with an error named 'QuotaExceededError' when full. */
  protected abstract writeRaw(key: string, value: string): Promise<void>;
  /** Delete the key; resolve even if it was not there. */
  protected abstract removeRaw(key: string): Promise<void>;
}

export { BaseAsyncStorageDriver };
export type { BaseAsyncStorageDriverOptions };
