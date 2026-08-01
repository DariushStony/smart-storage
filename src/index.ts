/**
 * A unified wrapper around Web Storage (localStorage / sessionStorage) with optional in-memory fallback.
 * Supports TTL-based expiration, JSON serialization, transform pipelines, and safe handling for both browser and server environments.
 *
 * All data is stored as a single serialized object under one key to avoid cluttering the storage space.
 *
 * @storage STORAGE TYPES:
 * - StorageType.Local: Uses localStorage (persists across browser sessions, ~5-10MB quota)
 * - StorageType.Session: Uses sessionStorage (cleared when tab closes, ~5-10MB quota)
 * - StorageType.InMemory: Uses Map (cleared on page reload, useful for testing or temporary data)
 * Specify type via: getStorageSlice('KEY', { storageType: StorageType.Session })
 *
 * @transforms TRANSFORM CHAIN (Chain of Responsibility):
 * - Transforms are applied AFTER JSON.stringify (string → string transformations)
 * - Applied in order during writes: handler1 → handler2 → ... → persist
 * - Reversed during reads: persist → handlerN → ... → handler1 → deserialize
 * - Use for: compression (LZ-String), encryption (Web Crypto), encoding (Base64), logging, etc.
 *
 * @logging PLUGGABLE LOGGING: Logging is a chain handler, not a built-in concern.
 * - Add `new LoggingHandler(myLogger)` to the transforms array to enable logging.
 * - Remove it to disable logging — zero code changes, zero overhead.
 *
 * @statistics PLUGGABLE STATISTICS: Statistics are a separate concern, not built into the vault.
 * - Use `new StorageStatistics(vault)` to collect metrics on demand.
 * - Don't create one if you don't need stats — zero overhead.
 */

import { StorageVault } from './vault/storage-vault';
import { StorageType } from './storage/storage-type';
import type { StorageVaultOptions } from './vault/types';

/**
 * Creates a new StorageVault instance with a custom storage key.
 * Use slices to split large or frequently updated data into independent storage blobs.
 *
 * @param sliceKey - The key to store the data under. Must be unique.
 * @param options - Configuration options for the vault.
 * @returns A StorageVault instance (singleton per sliceKey + storage type).
 *
 * @example
 * // Using different storage types
 * import { StorageType } from '@dariushstony/smart-storage';
 *
 * const persistent = getStorageSlice('USER_PREFS', { storageType: StorageType.Local });
 * const temporary = getStorageSlice('SESSION_DATA', { storageType: StorageType.Session });
 * const testData = getStorageSlice('TEST_DATA', { storageType: StorageType.InMemory });
 *
 * @example
 * // With logging in the chain
 * import { LoggingHandler } from '@dariushstony/smart-storage';
 *
 * const vault = getStorageSlice('DATA', {
 *   transforms: [
 *     new LoggingHandler(myLogger),  // add to enable logging
 *     compressionTransform,
 *   ],
 * });
 *
 * @example
 * // With statistics
 * import { StorageStatistics } from '@dariushstony/smart-storage';
 *
 * const vault = getStorageSlice('DATA');
 * const stats = new StorageStatistics(
 *   vault.getStorageAdapter(),
 *   vault.getStorageKey(),
 *   vault.getTransformChain(),
 *   vault.getMaxSizeBytes(),
 * );
 * console.log(stats.collect(() => vault.getAllData()));
 */
function getStorageSlice(
  sliceKey: string,
  options: Omit<StorageVaultOptions, 'storageKey'> = {}
): StorageVault {
  return StorageVault.getInstance({
    ...options,
    storageKey: sliceKey,
  });
}

/**
 * Disposes a storage slice instance, removing it from the singleton cache.
 * Call this when you're done with a temporary slice to allow garbage collection.
 *
 * @param sliceKey - The key of the slice to dispose.
 * @param options - The same options used when creating the slice (must match exactly).
 * @returns True if the slice was found and disposed; false otherwise.
 */
function disposeStorageSlice(
  sliceKey: string,
  options: Omit<StorageVaultOptions, 'storageKey'> = {}
): boolean {
  return StorageVault.disposeInstance({
    ...options,
    storageKey: sliceKey,
  });
}

// ==================== Value Exports ====================
export {
  // Main API functions
  getStorageSlice,
  disposeStorageSlice,

  // Vault class
  StorageVault,

  // Storage type constants
  StorageType,
};

// ==================== Logger ====================
export type { StorageLogger } from './logger/storage-logger';
export { LoggingHandler } from './logger/logging-handler';

// ==================== Storage ====================
export type { StorageTypeValue } from './storage/storage-type';
export type { IStorage } from './storage/storage.interface';

// ==================== Transform ====================
export type { StorageTransform } from './transform/types';
export { TransformHandler } from './transform/transform-handler';
export { InlineTransformHandler } from './transform/inline-transform-handler';
export { TransformChain } from './transform/transform-chain';

// ==================== Statistics ====================
export { StorageStatistics } from './statistics/storage-statistics';

// ==================== Vault Types ====================
export type {
  StorageVaultOptions,
  StorageStats,
  StoredData,
  DataRecord,
} from './vault/types';
