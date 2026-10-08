import { assertKey } from '../core/validation.js';
import { StorageArgumentError } from '../errors.js';
import type { StorageDriver } from './storage-driver.js';

interface BaseStorageDriverOptions {
  /**
   * Prefix every key with `${namespace}:`, for backends shared with other
   * code. Must not contain ":", so two namespaces can never overlap.
   */
  namespace?: string;
}

/** Validates a namespace and returns the key prefix it stands for. */
function namespacePrefix(namespace: string | undefined): string {
  if (namespace === undefined) return '';
  assertKey(namespace, 'namespace');
  if (namespace.includes(':')) {
    throw new StorageArgumentError(
      'namespace must not contain ":"; "app" with key "x:y" and "app:x" with key "y" would collide.'
    );
  }
  return `${namespace}:`;
}

/**
 * A starting point for custom drivers (Template Method). Implement the three
 * raw methods; the public `read` / `write` / `remove` add the namespace and
 * should not be overridden.
 */
abstract class BaseStorageDriver implements StorageDriver {
  abstract readonly name: string;
  // ES-private, so subclasses can declare their own `prefix`.
  readonly #prefix: string;

  constructor(options: BaseStorageDriverOptions = {}) {
    this.#prefix = namespacePrefix(options.namespace);
  }

  read(key: string): string | null {
    return this.readRaw(this.#prefix + key);
  }

  write(key: string, value: string): void {
    this.writeRaw(this.#prefix + key, value);
  }

  remove(key: string): void {
    this.removeRaw(this.#prefix + key);
  }

  /** Return the stored string, or null when there is none. */
  protected abstract readRaw(key: string): string | null;
  /** Store the string. Throw an error named 'QuotaExceededError' when full. */
  protected abstract writeRaw(key: string, value: string): void;
  /** Delete the key; do nothing if it is not there. */
  protected abstract removeRaw(key: string): void;
}

export { BaseStorageDriver, namespacePrefix };
export type { BaseStorageDriverOptions };
