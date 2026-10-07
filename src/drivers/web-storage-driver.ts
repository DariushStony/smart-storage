import type { StorageDriver } from './storage-driver.js';

type WebStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Adapts localStorage, sessionStorage or any object with the same three methods. */
class WebStorageDriver implements StorageDriver {
  constructor(
    private readonly storage: WebStorageLike,
    readonly name: string = 'webStorage'
  ) {}

  read(key: string): string | null {
    return this.storage.getItem(key);
  }

  write(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  remove(key: string): void {
    this.storage.removeItem(key);
  }
}

export { WebStorageDriver };
export type { WebStorageLike };
