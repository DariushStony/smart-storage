import type { StorageTypeValue } from '../storage/storage-type';
import type { TransformChain } from '../transform/transform-chain';
import type { TransformHandler } from '../transform/transform-handler';
import type { StorageTransform } from '../transform/types';

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
 *
 * Logging and statistics are **not** configured here — they are pluggable concerns:
 *
 * - **Logging**: Add a `LoggingHandler` to the transform chain. Remove it to disable logging.
 * - **Statistics**: Use `StorageStatistics` externally. Don't create one if you don't need stats.
 */
interface StorageVaultOptions {
  storageType?: StorageTypeValue;
  storageKey?: string;
  maxSizeBytes?: number;
  maxItemsInMemory?: number;
  debounceMs?: number;

  /**
   * A pre-built TransformChain instance (Chain of Responsibility).
   * Takes precedence over `transforms` if both are provided.
   *
   * @example
   * const chain = TransformChain.from([
   *   new LoggingHandler(myLogger),
   *   new CompressionHandler(),
   * ]);
   * const vault = getStorageSlice('DATA', { transformChain: chain });
   */
  transformChain?: TransformChain;

  /**
   * An array of transform handlers or plain transform objects.
   * Automatically wrapped into a TransformChain (Chain of Responsibility).
   *
   * Accepts:
   * - TransformHandler subclass instances (class-based, including LoggingHandler)
   * - Plain { serialize, deserialize } objects (legacy, backward-compatible)
   * - A mix of both
   *
   * Ignored if `transformChain` is provided.
   *
   * @example
   * const vault = getStorageSlice('DATA', {
   *   transforms: [
   *     new LoggingHandler(myLogger),
   *     new CompressionHandler(),
   *     { serialize: (d) => btoa(d), deserialize: (d) => atob(d) },
   *   ],
   * });
   */
  transforms?: (TransformHandler | StorageTransform)[];
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

export type { StoredData, DataRecord, StorageVaultOptions, StorageStats };
