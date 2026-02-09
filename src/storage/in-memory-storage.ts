import type { IStorage } from './storage.interface';

/**
 * Storage adapter using an in-memory Map.
 * Useful for testing, SSR, or temporary data that doesn't need persistence.
 * Data is cleared on page reload.
 */
class InMemoryStorage implements IStorage {
  private storage: Map<string, string> = new Map();

  getStorage(): Map<string, string> {
    return this.storage;
  }

  read(key: string): string | null {
    return this.storage.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.storage.set(key, value);
  }

  remove(key: string): void {
    this.storage.delete(key);
  }

  isAvailable(): boolean {
    return true;
  }

  getStorageType():
    | 'localStorage'
    | 'sessionStorage'
    | 'memory'
    | 'unavailable' {
    return 'memory';
  }

  registerUnloadHandler(_handler: () => void): void {
    // No-op: in-memory storage doesn't survive page unloads,
    // so there's no need to flush writes.
  }

  cleanup(): void {
    // No-op: no event listeners to clean up.
  }
}

export { InMemoryStorage };
