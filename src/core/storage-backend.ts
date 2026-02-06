import { isWindowAvailable } from '../utils/helpers';
import type { StorageLogger, StorageType } from '../utils/types';

/**
 * Storage backend abstraction layer.
 * Handles initialization and access to different storage types.
 */
class StorageBackend {
  private storage: Storage | Map<string, string> | null = null;
  private unloadHandler: (() => void) | null = null;

  constructor(
    private storageType: StorageType,
    private logger?: StorageLogger
  ) {
    this.initialize();
  }

  /**
   * Initializes the storage backend based on the storage type.
   */
  private initialize(): void {
    // Explicitly requested in-memory storage
    if (this.storageType === 'in-memory') {
      this.storage = new Map();
      return;
    }

    // Try to use web storage (localStorage or sessionStorage)
    if (isWindowAvailable()) {
      try {
        this.storage =
          this.storageType === 'session' ? sessionStorage : localStorage;
      } catch (e) {
        // Fallback to in-memory storage (Map) if accessing web storage throws an error
        // This can happen in private browsing mode or when storage is disabled
        this.logger?.log(
          'Web storage is not accessible. Falling back to in-memory storage.',
          e
        );
        this.storage = new Map();
      }
    } else {
      // SSR is expected behavior - use in-memory fallback without logging
      this.storage = new Map();
    }
  }

  /**
   * Gets the underlying storage instance.
   */
  getStorage(): Storage | Map<string, string> | null {
    return this.storage;
  }

  /**
   * Reads data from storage.
   */
  read(key: string): string | null {
    if (!this.storage) return null;

    if (this.storage instanceof Map) {
      return this.storage.get(key) ?? null;
    }

    return this.storage.getItem(key);
  }

  /**
   * Writes data to storage.
   */
  write(key: string, value: string): void {
    if (!this.storage) return;

    if (this.storage instanceof Map) {
      this.storage.set(key, value);
    } else {
      this.storage.setItem(key, value);
    }
  }

  /**
   * Removes data from storage.
   */
  remove(key: string): void {
    if (!this.storage) return;

    if (this.storage instanceof Map) {
      this.storage.delete(key);
    } else {
      this.storage.removeItem(key);
    }
  }

  /**
   * Checks if storage is available.
   */
  isAvailable(): boolean {
    return this.storage !== null;
  }

  /**
   * Gets the storage type.
   */
  getStorageType():
    | 'localStorage'
    | 'sessionStorage'
    | 'memory'
    | 'unavailable' {
    if (!this.storage) return 'unavailable';
    if (this.storage instanceof Map) return 'memory';
    if (this.storage === localStorage) return 'localStorage';
    if (this.storage === sessionStorage) return 'sessionStorage';
    return 'unavailable';
  }

  /**
   * Registers a beforeunload handler for the storage backend.
   */
  registerUnloadHandler(handler: () => void): void {
    if (isWindowAvailable() && !this.unloadHandler) {
      this.unloadHandler = handler;
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  /**
   * Cleans up event listeners.
   */
  cleanup(): void {
    if (isWindowAvailable() && this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }
  }
}

export { StorageBackend };
