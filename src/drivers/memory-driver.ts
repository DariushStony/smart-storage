import type { StorageDriver } from './storage-driver.js';

/** Keeps data in a Map for the lifetime of the page (or process, on a server). */
class MemoryDriver implements StorageDriver {
  readonly name: string = 'memory';
  private readonly data = new Map<string, string>();

  read(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.data.set(key, value);
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

export { MemoryDriver };
