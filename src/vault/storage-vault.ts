import type { IStorage } from '../storage/storage.interface';
import { createStorage } from '../storage/storage.factory';
import { DEFAULT_STORAGE_TYPE } from '../storage/storage-type';
import { TransformChain } from '../transform/transform-chain';
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_ITEMS_IN_MEMORY,
  DEFAULT_MAX_SIZE_BYTES,
  DEFAULT_STORAGE_KEY,
} from './constants';
import {
  getByteSize,
  isCircularReferenceError,
  isExpired,
  isQuotaExceededError,
  isValidDataRecord,
  validateKey,
} from './helpers';
import type {
  DataRecord,
  StorageVaultOptions,
  StoredData,
} from './types';

/**
 * StorageVault - A unified wrapper around Web Storage with TTL, transforms, and safe handling.
 *
 * Logging and statistics are **detachable concerns**, not baked into the vault:
 *
 * - **Logging**: Add a `LoggingHandler` to the transform chain to observe data flowing through.
 *   Remove it from the array to disable logging — zero code changes, zero overhead.
 *
 * - **Statistics**: Use `StorageStatistics` externally to collect metrics on demand.
 *   Don't create one if you don't need stats — zero overhead.
 *
 * @see README.md for comprehensive documentation
 */
class StorageVault {
  private static instances = new Map<string, StorageVault>();

  private storage: IStorage;
  private transformChain: TransformChain;
  private storageKey: string;
  private maxSizeBytes: number;
  private maxItemsInMemory: number;
  private debounceMs: number;
  private isCleaningUp = false;
  private pendingSave: ReturnType<typeof setTimeout> | null = null;
  private dirtyData: DataRecord | null = null;

  /**
   * Gets or creates a singleton instance of StorageVault.
   */
  static getInstance(options: StorageVaultOptions = {}): StorageVault {
    const {
      storageType = DEFAULT_STORAGE_TYPE,
      storageKey = DEFAULT_STORAGE_KEY,
      maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
      maxItemsInMemory = DEFAULT_MAX_ITEMS_IN_MEMORY,
      debounceMs = DEFAULT_DEBOUNCE_MS,
      transformChain,
      transforms = [],
    } = options;

    const key = `${storageType}-${storageKey}`;

    if (!StorageVault.instances.has(key)) {
      StorageVault.instances.set(
        key,
        new StorageVault({
          storageType,
          storageKey,
          maxSizeBytes,
          maxItemsInMemory,
          debounceMs,
          transformChain,
          transforms,
        })
      );
    }

    const instance = StorageVault.instances.get(key);
    if (!instance) {
      throw new Error(
        `Failed to create or retrieve StorageVault instance: ${key}`
      );
    }

    return instance;
  }

  /**
   * Removes an instance from the singleton map.
   */
  static disposeInstance(options: StorageVaultOptions = {}): boolean {
    const {
      storageType = DEFAULT_STORAGE_TYPE,
      storageKey = DEFAULT_STORAGE_KEY,
    } = options;

    const key = `${storageType}-${storageKey}`;
    const instance = StorageVault.instances.get(key);

    if (instance) {
      instance.flush();
      instance.cleanup();
    }

    return StorageVault.instances.delete(key);
  }

  /**
   * Clears all instances from memory. Useful for testing.
   */
  static clearAllInstances(): void {
    StorageVault.instances.forEach((instance) => {
      instance.flush();
      instance.cleanup();
    });
    StorageVault.instances.clear();
  }

  /**
   * Creates a new StorageVault instance (private - use getInstance instead).
   */
  private constructor(options: StorageVaultOptions = {}) {
    const {
      storageType = DEFAULT_STORAGE_TYPE,
      storageKey = DEFAULT_STORAGE_KEY,
      maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
      maxItemsInMemory = DEFAULT_MAX_ITEMS_IN_MEMORY,
      debounceMs = DEFAULT_DEBOUNCE_MS,
      transformChain,
      transforms = [],
    } = options;

    this.storageKey = storageKey;
    this.maxSizeBytes = maxSizeBytes;
    this.maxItemsInMemory = maxItemsInMemory;
    this.debounceMs = debounceMs;
    this.storage = createStorage(storageType);
    this.transformChain = transformChain ?? TransformChain.from(transforms);

    // Setup pagehide handler to flush pending writes
    this.storage.registerUnloadHandler(() => {
      if (this.dirtyData) {
        this.saveAllDataImmediate(this.dirtyData);
        this.dirtyData = null;
      }
    });
  }

  // ==================== INTERNAL ACCESSORS ====================
  // Exposed for StorageStatistics and other detachable concerns.

  /**
   * Returns the underlying storage adapter.
   * Used by detachable concerns like StorageStatistics.
   */
  getStorageAdapter(): IStorage {
    return this.storage;
  }

  /**
   * Returns the transform chain.
   * Used by detachable concerns like StorageStatistics.
   */
  getTransformChain(): TransformChain {
    return this.transformChain;
  }

  /**
   * Returns the storage key used by this vault instance.
   */
  getStorageKey(): string {
    return this.storageKey;
  }

  /**
   * Returns the configured max size in bytes.
   */
  getMaxSizeBytes(): number {
    return this.maxSizeBytes;
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Reads and deserializes all data from storage.
   */
  getAllData(): DataRecord {
    const raw = this.storage.getStorage();
    if (!raw) return {};

    // Return dirty data if we have pending writes (read-after-write consistency)
    if (this.dirtyData !== null) {
      return { ...(this.dirtyData ?? {}) };
    }

    try {
      const dataStr = this.storage.read(this.storageKey);
      if (!dataStr) return {};

      // Apply reverse transforms before JSON parsing
      const deserializedStr = this.transformChain.reverse(dataStr);
      const parsed = JSON.parse(deserializedStr) as unknown;

      // Validate structure to handle corrupted data
      if (!isValidDataRecord(parsed)) {
        throw new Error('Invalid storage data structure');
      }

      return parsed as DataRecord;
    } catch {
      // Clear corrupted storage
      try {
        this.storage.remove(this.storageKey);
      } catch {
        // Best-effort cleanup — if this also fails, we still return empty data
      }

      return {};
    }
  }

  /**
   * Serializes and writes data immediately to storage.
   */
  private saveAllDataImmediate(data: DataRecord): void {
    const raw = this.storage.getStorage();
    if (!raw) return;

    // Enforce max items limit for in-memory storage
    if (raw instanceof Map) {
      const itemCount = Object.keys(data).length;
      if (itemCount > this.maxItemsInMemory) {
        this.enforceItemLimit(data);
      }
    }

    try {
      const dataStr = JSON.stringify(data);
      const transformedStr = this.transformChain.apply(dataStr);
      const byteSize = getByteSize(transformedStr);

      if (byteSize > this.maxSizeBytes) {
        // Data exceeds configured limit — still write, but consumers
        // should use StorageStatistics to monitor quota usage.
      }

      this.storage.write(this.storageKey, transformedStr);
    } catch (e) {
      this.handleSaveError(e);
    }
  }

  /**
   * Handles errors during save operations.
   */
  private handleSaveError(error: unknown): void {
    if (isQuotaExceededError(error)) {
      if (!this.isCleaningUp) {
        this.isCleaningUp = true;

        try {
          this.cleanupExpiredItems();

          // Retry after cleanup
          const freshData = this.getAllData();
          const dataStr = JSON.stringify(freshData);
          const transformedStr = this.transformChain.apply(dataStr);
          this.storage.write(this.storageKey, transformedStr);
        } catch {
          throw new Error(
            'Storage quota exceeded. Clear some data or use storage slices to reduce size.'
          );
        } finally {
          this.isCleaningUp = false;
        }
      } else {
        throw new Error('Storage quota exceeded during cleanup');
      }
    } else if (isCircularReferenceError(error)) {
      throw new Error(
        'Cannot store data with circular references. Serialize manually before storing.'
      );
    } else {
      throw new Error(
        `Failed to save to storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Saves data with optional debouncing.
   */
  private saveAllData(data: DataRecord): void {
    if (this.debounceMs > 0) {
      // Debounced write: store in memory first for read-after-write consistency
      this.dirtyData = data;

      if (this.pendingSave) {
        clearTimeout(this.pendingSave);
      }

      this.pendingSave = setTimeout(() => {
        if (this.dirtyData) {
          try {
            this.saveAllDataImmediate(this.dirtyData);
            this.dirtyData = null;
          } catch {
            // Keep dirtyData so next flush/save can retry
          }
        }
        this.pendingSave = null;
      }, this.debounceMs);
    } else {
      // Immediate write (no debouncing)
      this.saveAllDataImmediate(data);
    }
  }

  /**
   * Removes an item if it's expired.
   */
  private removeIfExpired(
    key: string,
    item: StoredData<unknown> | undefined,
    data: DataRecord
  ): boolean {
    if (!item) return true;

    if (isExpired(item.expiry)) {
      delete data[key];
      return true;
    }

    return false;
  }

  /**
   * Enforces the maximum item limit for in-memory storage.
   */
  private enforceItemLimit(data: DataRecord): void {
    const keys = Object.keys(data);
    if (keys.length <= this.maxItemsInMemory) return;

    // Sort by expiry time (oldest first)
    const sortedKeys = keys.sort((a, b) => {
      const expiryA = data[a]?.expiry ?? Infinity;
      const expiryB = data[b]?.expiry ?? Infinity;
      return expiryA - expiryB;
    });

    // Remove oldest items until we're under the limit
    const itemsToRemove = keys.length - this.maxItemsInMemory;
    for (let i = 0; i < itemsToRemove; i++) {
      const keyToDelete = sortedKeys[i];
      if (keyToDelete !== undefined) {
        delete data[keyToDelete];
      }
    }
  }

  /**
   * Cleans up resources used by this instance.
   */
  private cleanup(): void {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }

    this.storage.cleanup();
  }

  // ==================== PUBLIC API ====================

  /**
   * Stores a value with an optional time-to-live (TTL).
   */
  setItem<T>(key: string, value: T, ttl?: number): boolean {
    validateKey(key, this.storage.getStorage());

    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl < 0)) {
      throw new Error('TTL must be a non-negative finite number.');
    }

    if (ttl === 0) {
      return this.removeItem(key);
    }

    const data = this.getAllData();
    const expiry = ttl !== undefined ? Date.now() + ttl : null;
    data[key] = { value, expiry };

    this.saveAllData(data);
    return true;
  }

  /**
   * Retrieves a stored value by key.
   */
  getItem<T>(key: string): T | null {
    validateKey(key, this.storage.getStorage());

    const data = this.getAllData();
    const item = data[key] as StoredData<T> | undefined;

    if (!item) return null;

    const expired = this.removeIfExpired(key, item, data);

    if (expired) {
      this.saveAllData(data);
      return null;
    }

    return item.value;
  }

  /**
   * Updates the value of an existing item without modifying its expiry time.
   */
  updateItem<T>(key: string, newValue: T): boolean {
    validateKey(key, this.storage.getStorage());

    const data = this.getAllData();
    const item = data[key];

    if (!item) return false;

    const expired = this.removeIfExpired(key, item, data);

    if (expired) {
      this.saveAllData(data);
      return false;
    }

    item.value = newValue;
    this.saveAllData(data);
    return true;
  }

  /**
   * Extends the expiry time of an existing item.
   */
  extendTTL(key: string, additionalTTL: number): boolean {
    validateKey(key, this.storage.getStorage());

    if (!Number.isFinite(additionalTTL) || additionalTTL <= 0) {
      throw new Error('additionalTTL must be a positive finite number.');
    }

    const data = this.getAllData();
    const item = data[key];

    if (!item) return false;

    const expired = this.removeIfExpired(key, item, data);

    if (expired) {
      this.saveAllData(data);
      return false;
    }

    item.expiry =
      item.expiry !== null
        ? item.expiry + additionalTTL
        : Date.now() + additionalTTL;
    this.saveAllData(data);
    return true;
  }

  /**
   * Removes an item from storage.
   */
  removeItem(key: string): boolean {
    validateKey(key, this.storage.getStorage());

    const data = this.getAllData();
    if (key in data) {
      delete data[key];
      this.saveAllData(data);
      return true;
    }

    return false;
  }

  /**
   * Clears all stored data under the vault's storage key.
   */
  clear(): boolean {
    if (!this.storage.isAvailable()) {
      throw new Error('Storage is not available (unavailable environment).');
    }

    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
    this.dirtyData = null;

    try {
      this.storage.remove(this.storageKey);
      return true;
    } catch (error) {
      throw new Error(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Checks whether an item exists and is not expired.
   */
  hasItem(key: string): boolean {
    validateKey(key, this.storage.getStorage());

    const data = this.getAllData();
    const item = data[key];

    if (!item) return false;

    const expired = this.removeIfExpired(key, item, data);

    if (expired) {
      this.saveAllData(data);
      return false;
    }

    return true;
  }

  /**
   * Returns the remaining time-to-live (TTL) for a stored item.
   */
  getRemainingTTL(key: string): number | null {
    if (!this.storage.isAvailable()) return null;

    const data = this.getAllData();
    const item = data[key];

    if (!item || item.expiry === null) return null;

    const remainingTime = item.expiry - Date.now();

    if (remainingTime <= 0) {
      delete data[key];
      this.saveAllData(data);
      return null;
    }

    return remainingTime;
  }

  /**
   * Removes all expired items from storage.
   */
  cleanupExpiredItems(): number {
    if (!this.storage.isAvailable()) return 0;

    const data = this.getAllData();
    let removedCount = 0;
    const now = Date.now();

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const item = data[key];
        if (item && item.expiry !== null && now > item.expiry) {
          delete data[key];
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      this.saveAllDataImmediate(data);
    }

    return removedCount;
  }

  /**
   * Flushes any pending debounced writes immediately.
   */
  flush(): void {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }

    if (this.dirtyData) {
      this.saveAllDataImmediate(this.dirtyData);
      this.dirtyData = null;
    }
  }

  /**
   * Returns all keys currently stored in the vault (excluding expired items).
   */
  getAllKeys(): string[] {
    if (!this.storage.isAvailable()) return [];

    const data = this.getAllData();
    const validKeys: string[] = [];
    const now = Date.now();

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const item = data[key];
        if (item && (item.expiry === null || now <= item.expiry)) {
          validKeys.push(key);
        }
      }
    }

    return validKeys;
  }

  /**
   * Returns all stored items as a key-value object (excluding expired items).
   */
  getAll(): Record<string, unknown> {
    if (!this.storage.isAvailable()) return {};

    const data = this.getAllData();
    const result: Record<string, unknown> = {};
    const now = Date.now();

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const item = data[key];
        if (item && (item.expiry === null || now <= item.expiry)) {
          result[key] = item.value;
        }
      }
    }

    return result;
  }

  /**
   * Returns the current size of stored data in bytes.
   */
  getCurrentSize(): number {
    if (!this.storage.isAvailable()) return 0;

    try {
      const data = this.getAllData();
      const dataStr = JSON.stringify(data);
      return getByteSize(dataStr);
    } catch {
      return 0;
    }
  }
}

export { StorageVault };
