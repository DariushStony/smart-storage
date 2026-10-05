import type { StorageLogger } from '../logger/storage-logger.js';
import type { StorageTypeValue } from '../storage/storage-type.js';
import type { TransformChain } from '../transform/transform-chain.js';
import type { TransformHandler } from '../transform/transform-handler.js';
import type { StorageTransform } from '../transform/types.js';

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
 * - **Logging**: `logger` reports storage problems (corrupted data, quota, failed writes,
 *   blocked web storage). To also observe data flowing through the transform chain,
 *   add a `LoggingHandler` to it.
 * - **Statistics**: Use `StorageStatistics` externally. Don't create one if you don't need stats.
 */
interface StorageVaultOptions {
  storageType?: StorageTypeValue;
  storageKey?: string;
  maxSizeBytes?: number;
  maxItemsInMemory?: number;
  debounceMs?: number;

  /**
   * Receives a message for every storage problem the vault handles or recovers from:
   * corrupted data being cleared, quota breaches and cleanups, failed writes, and web
   * storage being blocked (the vault then falls back to memory). Optional; without it
   * the vault stays silent. It is not part of the singleton key, so the logger of the
   * call that first creates a slice is the one that stays.
   *
   * @example
   * const vault = getStorageSlice('DATA', {
   *   logger: { log: (message, error) => reportToSentry(message, error) },
   * });
   */
  logger?: StorageLogger;

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
