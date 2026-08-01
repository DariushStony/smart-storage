import { isWindowAvailable } from './environment';
import type { IStorage } from './storage.interface';

/**
 * Storage adapter using the browser's localStorage API.
 * Falls back to in-memory Map if localStorage is not accessible
 * (e.g., private browsing, disabled storage, SSR).
 */
class LocalStorage implements IStorage {
  private storage: Storage | Map<string, string> | null = null;
  private unloadHandler: (() => void) | null = null;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (isWindowAvailable()) {
      try {
        this.storage = localStorage;
      } catch {
        this.storage = new Map();
      }
    } else {
      this.storage = new Map();
    }
  }

  getStorage(): Storage | Map<string, string> | null {
    return this.storage;
  }

  read(key: string): string | null {
    if (!this.storage) return null;
    if (this.storage instanceof Map) {
      return this.storage.get(key) ?? null;
    }
    return this.storage.getItem(key);
  }

  write(key: string, value: string): void {
    if (!this.storage) return;
    if (this.storage instanceof Map) {
      this.storage.set(key, value);
    } else {
      this.storage.setItem(key, value);
    }
  }

  remove(key: string): void {
    if (!this.storage) return;
    if (this.storage instanceof Map) {
      this.storage.delete(key);
    } else {
      this.storage.removeItem(key);
    }
  }

  isAvailable(): boolean {
    return this.storage !== null;
  }

  getStorageType():
    | 'localStorage'
    | 'sessionStorage'
    | 'memory'
    | 'unavailable' {
    if (!this.storage) return 'unavailable';
    if (this.storage instanceof Map) return 'memory';
    return 'localStorage';
  }

  registerUnloadHandler(handler: () => void): void {
    if (isWindowAvailable() && !this.unloadHandler) {
      this.unloadHandler = handler;
      window.addEventListener('pagehide', this.unloadHandler);
    }
  }

  cleanup(): void {
    if (isWindowAvailable() && this.unloadHandler) {
      window.removeEventListener('pagehide', this.unloadHandler);
      this.unloadHandler = null;
    }
  }
}

export { LocalStorage };
