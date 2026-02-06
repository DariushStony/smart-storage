/**
 * Storage type options for the vault.
 * - 'local': Uses localStorage (persists across browser sessions)
 * - 'session': Uses sessionStorage (cleared when tab closes)
 * - 'in-memory': Uses Map (cleared on page reload, useful for testing or temporary data)
 */
type StorageType = 'local' | 'session' | 'in-memory';

/**
 * Logger interface for error reporting.
 * Implement this to connect to your logging service (e.g., Sentry).
 */
interface StorageLogger {
  log(message: string, error?: unknown): void;
}

/**
 * Transform interface for custom serialization pipelines.
 * Transforms are applied in order during writes and reversed during reads.
 *
 * @example Compression transform
 * const compressionTransform: StorageTransform = {
 *   serialize: (data) => LZString.compress(data),
 *   deserialize: (data) => LZString.decompress(data)
 * };
 *
 * @example Base64 encoding transform
 * const base64Transform: StorageTransform = {
 *   serialize: (data) => btoa(data),
 *   deserialize: (data) => atob(data)
 * };
 *
 * @example Chaining transforms
 * const vault = getStorageSlice('DATA', {
 *   transforms: [compressionTransform, base64Transform] // compress then encode
 * });
 */
interface StorageTransform {
  /**
   * Transforms serialized data before persistence.
   * @param data - The serialized JSON string.
   * @returns The transformed string.
   */
  serialize: (data: string) => string;

  /**
   * Reverses the transformation after reading from storage.
   * @param data - The transformed string from storage.
   * @returns The original serialized JSON string.
   */
  deserialize: (data: string) => string;
}

/**
 * Internal structure for storing data with expiry information.
 */
interface StoredData<T> {
  value: T;
  expiry: number | null;
}

/**
 * Internal data record type.
 */
type DataRecord = Record<string, StoredData<unknown>>;

/**
 * Configuration options for StorageVault.
 */
interface StorageVaultOptions {
  storageType?: StorageType;
  storageKey?: string;
  logger?: StorageLogger;
  maxSizeBytes?: number;
  maxItemsInMemory?: number;
  debounceMs?: number;
  transforms?: StorageTransform[];
}

/**
 * Storage statistics.
 */
interface StorageStats {
  itemCount: number;
  sizeBytes: number;
  stringLength: number;
  maxSizeBytes: number;
  quotaPercentage: number;
  storageType: 'localStorage' | 'sessionStorage' | 'memory' | 'unavailable';
}

export type {
  StorageType,
  StorageLogger,
  StorageTransform,
  StoredData,
  DataRecord,
  StorageVaultOptions,
  StorageStats,
};
