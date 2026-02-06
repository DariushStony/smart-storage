import { TransformPipeline } from '../transforms/pipeline';
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_ITEMS_IN_MEMORY,
  DEFAULT_MAX_SIZE_BYTES,
  DEFAULT_STORAGE_KEY,
  DEFAULT_STORAGE_TYPE,
} from '../utils/constants';
import {
  getByteSize,
  isCircularReferenceError,
  isExpired,
  isQuotaExceededError,
  isValidDataRecord,
  validateKey,
} from '../utils/helpers';
import type {
  DataRecord,
  StorageLogger,
  StorageStats,
  StorageVaultOptions,
  StoredData,
} from '../utils/types';
import { StorageBackend } from './storage-backend';

/**
 * StorageVault - A unified wrapper around Web Storage with TTL, transforms, and safe handling.
 *
 * @see README.md for comprehensive documentation
 */
class StorageVault {
  private static instances = new Map<string, StorageVault>();

  private backend: StorageBackend;
  private transformPipeline: TransformPipeline;
  private storageKey: string;
  private logger?: StorageLogger;
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
      logger,
      maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
      maxItemsInMemory = DEFAULT_MAX_ITEMS_IN_MEMORY,
      debounceMs = DEFAULT_DEBOUNCE_MS,
      transforms = [],
    } = options;

    const key = `${storageType}-${storageKey}`;

    if (!StorageVault.instances.has(key)) {
      StorageVault.instances.set(
        key,
        new StorageVault({
          storageType,
          storageKey,
          logger,
          maxSizeBytes,
          maxItemsInMemory,
          debounceMs,
          transforms,
        })
      );
    }

    const instance = StorageVault.instances.get(key);
    if (!instance) {
      logger?.log('Failed to create or retrieve StorageVault instance', {
        key,
      });
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
      logger,
      maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
      maxItemsInMemory = DEFAULT_MAX_ITEMS_IN_MEMORY,
      debounceMs = DEFAULT_DEBOUNCE_MS,
      transforms = [],
    } = options;

    this.logger = logger;
    this.storageKey = storageKey;
    this.maxSizeBytes = maxSizeBytes;
    this.maxItemsInMemory = maxItemsInMemory;
    this.debounceMs = debounceMs;
    this.backend = new StorageBackend(storageType, logger);
    this.transformPipeline = new TransformPipeline(transforms, logger);

    // Setup pagehide handler to flush pending writes
    this.backend.registerUnloadHandler(() => {
      if (this.dirtyData) {
        this.saveAllDataImmediate(this.dirtyData);
        this.dirtyData = null;
      }
    });
  }

  /**
   * Reads and deserializes all data from storage.
   */
  private getAllData(): DataRecord {
    const storage = this.backend.getStorage();
    if (!storage) return {};

    // Return dirty data if we have pending writes (read-after-write consistency)
    if (this.dirtyData !== null) {
      return Object.freeze(this.dirtyData ?? {});
    }

    try {
      const dataStr = this.backend.read(this.storageKey);
      if (!dataStr) return {};

      // Apply reverse transforms before JSON parsing
      const deserializedStr = this.transformPipeline.reverse(dataStr);
      const parsed = JSON.parse(deserializedStr) as unknown;

      // Validate structure to handle corrupted data
      if (!isValidDataRecord(parsed)) {
        throw new Error('Invalid storage data structure');
      }

      return parsed as DataRecord;
    } catch (e) {
      this.logger?.log('Storage data corrupted or invalid, clearing storage', {
        error: e,
        storageKey: this.storageKey,
      });

      // Clear corrupted storage
      try {
        this.backend.remove(this.storageKey);
      } catch (clearError) {
        this.logger?.log('Failed to clear corrupted storage', clearError);
      }

      return {};
    }
  }

  /**
   * Serializes and writes data immediately to storage.
   */
  private saveAllDataImmediate(data: DataRecord): void {
    const storage = this.backend.getStorage();
    if (!storage) return;

    // Enforce max items limit for in-memory storage
    if (storage instanceof Map) {
      const itemCount = Object.keys(data).length;
      if (itemCount > this.maxItemsInMemory) {
        this.logger?.log(
          'In-memory storage item limit exceeded, cleaning up oldest items',
          {
            itemCount,
            maxItems: this.maxItemsInMemory,
          }
        );
        this.enforceItemLimit(data);
      }
    }

    try {
      const dataStr = JSON.stringify(data);
      const transformedStr = this.transformPipeline.apply(dataStr);
      const byteSize = getByteSize(transformedStr);

      // Check size and warn if approaching quota
      if (byteSize > this.maxSizeBytes) {
        this.logger?.log('Storage approaching quota limit', {
          byteSize,
          stringLength: transformedStr.length,
          maxSizeBytes: this.maxSizeBytes,
        });
      }

      this.backend.write(this.storageKey, transformedStr);
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
        this.logger?.log('Storage quota exceeded, attempting cleanup', error);
        this.isCleaningUp = true;

        try {
          const removedCount = this.cleanupExpiredItems();
          this.logger?.log(`Cleanup removed ${removedCount} expired items`);

          // Retry after cleanup
          const freshData = this.getAllData();
          const dataStr = JSON.stringify(freshData);
          const transformedStr = this.transformPipeline.apply(dataStr);
          this.backend.write(this.storageKey, transformedStr);
        } catch (retryError) {
          this.logger?.log(
            'Storage quota exceeded even after cleanup',
            retryError
          );
          throw new Error(
            'Storage quota exceeded. Clear some data or use storage slices to reduce size.'
          );
        } finally {
          this.isCleaningUp = false;
        }
      } else {
        this.logger?.log(
          'Already cleaning up, skipping recursive cleanup',
          error
        );
        throw new Error('Storage quota exceeded during cleanup');
      }
    } else if (isCircularReferenceError(error)) {
      this.logger?.log('Circular reference detected in stored data', error);
      throw new Error(
        'Cannot store data with circular references. Serialize manually before storing.'
      );
    } else {
      this.logger?.log('Error saving to storage', error);
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
          } catch (e) {
            this.logger?.log('Debounced save failed', e);
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
    // Clear any pending timers
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }

    // Remove event listeners
    this.backend.cleanup();
  }

  // ==================== PUBLIC API ====================

  /**
   * Stores a value with an optional time-to-live (TTL).
   */
  setItem<T>(key: string, value: T, ttl?: number): boolean {
    validateKey(key, this.backend.getStorage());

    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl < 0)) {
      throw new Error('TTL must be a non-negative finite number.');
    }

    // Handle TTL=0 case: immediately delete the item
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
    validateKey(key, this.backend.getStorage());

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
    validateKey(key, this.backend.getStorage());

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
    validateKey(key, this.backend.getStorage());

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
    validateKey(key, this.backend.getStorage());

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
    if (!this.backend.isAvailable()) {
      throw new Error('Storage is not available (unavailable environment).');
    }

    // Cancel any pending writes
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
    this.dirtyData = null;

    try {
      this.backend.remove(this.storageKey);
      return true;
    } catch (error) {
      this.logger?.log('Error clearing storage', {
        error,
        storageKey: this.storageKey,
      });
      throw new Error(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Checks whether an item exists and is not expired.
   */
  hasItem(key: string): boolean {
    validateKey(key, this.backend.getStorage());

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
    if (!this.backend.isAvailable()) return null;

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
    if (!this.backend.isAvailable()) return 0;

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
    if (!this.backend.isAvailable()) return [];

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
    if (!this.backend.isAvailable()) return {};

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
    if (!this.backend.isAvailable()) return 0;

    try {
      const data = this.getAllData();
      const dataStr = JSON.stringify(data);
      return getByteSize(dataStr);
    } catch (e) {
      this.logger?.log('Error calculating storage size', e);
      return 0;
    }
  }

  /**
   * Returns storage statistics.
   */
  getStats(): StorageStats {
    if (!this.backend.isAvailable()) {
      return {
        itemCount: 0,
        sizeBytes: 0,
        stringLength: 0,
        maxSizeBytes: this.maxSizeBytes,
        quotaPercentage: 0,
        storageType: 'unavailable',
      };
    }

    const data = this.getAllData();
    const itemCount = Object.keys(data).length;
    const dataStr = JSON.stringify(data);
    const sizeBytes = getByteSize(dataStr);
    const quotaPercentage = (sizeBytes / this.maxSizeBytes) * 100;

    return {
      itemCount,
      sizeBytes,
      stringLength: dataStr.length,
      maxSizeBytes: this.maxSizeBytes,
      quotaPercentage,
      storageType: this.backend.getStorageType(),
    };
  }
}

export { StorageVault };
