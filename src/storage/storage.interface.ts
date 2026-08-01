/**
 * Interface for storage implementations.
 *
 * All storage adapters (localStorage, sessionStorage, in-memory)
 * must implement this contract to be used interchangeably.
 */
interface IStorage {
  /**
   * Gets the underlying storage instance.
   */
  getStorage(): Storage | Map<string, string> | null;

  /**
   * Reads data from storage by key.
   * @param key - The storage key to read.
   * @returns The stored string value, or null if not found.
   */
  read(key: string): string | null;

  /**
   * Writes data to storage.
   * @param key - The storage key.
   * @param value - The string value to persist.
   */
  write(key: string, value: string): void;

  /**
   * Removes data from storage by key.
   * @param key - The storage key to remove.
   */
  remove(key: string): void;

  /**
   * Checks if the storage is available and operational.
   */
  isAvailable(): boolean;

  /**
   * Returns a human-readable label for the storage type.
   */
  getStorageType():
    | 'localStorage'
    | 'sessionStorage'
    | 'memory'
    | 'unavailable';

  /**
   * Registers a handler to be called on page unload (pagehide).
   * Used to flush pending writes before the page is closed.
   * @param handler - The callback to invoke on page unload.
   */
  registerUnloadHandler(handler: () => void): void;

  /**
   * Cleans up any event listeners or resources held by this storage.
   */
  cleanup(): void;
}

export type { IStorage };
