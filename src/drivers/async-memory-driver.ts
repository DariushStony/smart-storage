import { BaseAsyncStorageDriver } from './base-async-storage-driver.js';

/** The reference async driver: a Map behind promises. Handy in tests. */
class AsyncMemoryDriver extends BaseAsyncStorageDriver {
  override readonly name: string = 'memory';
  private readonly data = new Map<string, string>();

  protected override readRaw(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  protected override writeRaw(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  protected override removeRaw(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

export { AsyncMemoryDriver };
