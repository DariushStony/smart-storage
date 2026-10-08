import { BaseStorageDriver } from './base-storage-driver.js';

/** Keeps data in a Map for the lifetime of the page (or process, on a server). */
class MemoryDriver extends BaseStorageDriver {
  override readonly name: string = 'memory';
  private readonly data = new Map<string, string>();

  protected override readRaw(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  protected override writeRaw(key: string, value: string): void {
    this.data.set(key, value);
  }

  protected override removeRaw(key: string): void {
    this.data.delete(key);
  }
}

export { MemoryDriver };
