import { BaseStorageDriver } from './base-storage-driver.js';
import type { BaseStorageDriverOptions } from './base-storage-driver.js';

type WebStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Adapts localStorage, sessionStorage or any object with the same three methods. */
class WebStorageDriver extends BaseStorageDriver {
  override readonly name: string;
  private readonly storage: WebStorageLike;

  constructor(
    storage: WebStorageLike,
    name = 'webStorage',
    options?: BaseStorageDriverOptions
  ) {
    super(options);
    this.storage = storage;
    this.name = name;
  }

  protected override readRaw(key: string): string | null {
    return this.storage.getItem(key);
  }

  protected override writeRaw(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  protected override removeRaw(key: string): void {
    this.storage.removeItem(key);
  }
}

export { WebStorageDriver };
export type { WebStorageLike };
