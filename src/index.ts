/**
 * A unified wrapper around Web Storage (localStorage / sessionStorage) with optional in-memory fallback.
 * Supports TTL-based expiration, JSON serialization, transform pipelines, and safe handling for both browser and server environments.
 *
 * All data is stored as a single serialized object under one key to avoid cluttering the storage space.
 *
 * @storage STORAGE TYPES:
 * - 'local': Uses localStorage (persists across browser sessions, ~5-10MB quota)
 * - 'session': Uses sessionStorage (cleared when tab closes, ~5-10MB quota)
 * - 'in-memory': Uses Map (cleared on page reload, useful for testing or temporary data)
 * Specify type via: getStorageSlice('KEY', { storageType: 'session' })
 *
 * @security WARNING: Web Storage is accessible via JavaScript and is NOT secure for sensitive data.
 * Do NOT store authentication tokens, passwords, or other sensitive information here.
 * For sensitive data, use httpOnly cookies or secure server-side sessions instead.
 * All stored data should be treated as potentially compromised and validated on retrieval.
 *
 * @ssr HYDRATION WARNING: During server-side rendering, this vault uses in-memory storage.
 * When hydrating on the client, a new instance with localStorage will be created, but any
 * server-rendered state will be lost. If you need to preserve SSR data, pass initial data
 * as props and call setItem() in useEffect() or similar client-side hook.
 *
 * @serialization JSON LIMITATIONS: Values are serialized with JSON.stringify(), which has limitations:
 * - Functions, undefined, and Symbol values are silently dropped
 * - Date objects become strings (must be manually converted back)
 * - Circular references will throw an error
 * - Map, Set, and other non-plain objects lose their type information
 * For complex data types, serialize them manually before storing.
 *
 * @transforms TRANSFORM PIPELINE: You can chain multiple transforms (compression, encryption, encoding):
 * - Transforms are applied AFTER JSON.stringify (string → string transformations)
 * - Applied in order during writes: serialize → transform1 → transform2 → ... → persist
 * - Reversed during reads: persist → reverse transformN → ... → reverse transform1 → deserialize
 * - Use for: compression (LZ-String), encryption (Web Crypto), encoding (Base64), etc.
 *
 * @performance When to use slices (getStorageSlice):
 * - Split data by update frequency (e.g., user preferences vs. temporary cache)
 * - Isolate large datasets to avoid re-serializing everything on each write
 * - Separate critical data from experimental features
 * Example: getStorageSlice('USER_PREFS') vs getStorageSlice('TEMP_CACHE')
 *
 * @performance DEBOUNCING: Write operations are debounced by default (100ms) to batch rapid updates.
 * - Reads always see pending writes immediately (read-after-write consistency)
 * - Pending writes are automatically flushed on page unload to prevent data loss
 * - For time-critical operations, call flush() to force immediate persistence
 * - Set debounceMs: 0 to disable debouncing (writes become synchronous)
 * - Consider higher debounceMs (200-500ms) for battery-sensitive or high-frequency scenarios
 */

import { StorageVault } from './core/vault';
import type { StorageVaultOptions } from './utils/types';

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
 * const persistent = getStorageSlice('USER_PREFS', { storageType: 'local' }); // Persists across sessions
 * const temporary = getStorageSlice('SESSION_DATA', { storageType: 'session' }); // Cleared when tab closes
 * const testData = getStorageSlice('TEST_DATA', { storageType: 'in-memory' }); // For testing, cleared on reload
 *
 * @example
 * // Good: Separate frequently-updated data from stable data
 * const userPrefs = getStorageSlice('USER_PREFERENCES'); // Updated rarely
 * const tempCache = getStorageSlice('TEMP_CACHE'); // Updated frequently
 *
 * @example
 * // Using transforms
 * import LZString from 'lz-string';
 *
 * const compressionTransform = {
 *   serialize: (data: string) => LZString.compress(data),
 *   deserialize: (data: string) => LZString.decompress(data)
 * };
 *
 * const vault = getStorageSlice('LARGE_DATA', {
 *   transforms: [compressionTransform]
 * });
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
 *
 * @example
 * const tempVault = getStorageSlice('TEMP_SESSION', { storageType: 'session' });
 * // ... use vault ...
 * disposeStorageSlice('TEMP_SESSION', { storageType: 'session' }); // Clean up when done
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

export {
  // Main API functions
  getStorageSlice,
  disposeStorageSlice,
  StorageVault,
};

export type {
  StorageType,
  StorageLogger,
  StorageTransform,
  StorageVaultOptions,
  StorageStats,
  StoredData,
  DataRecord,
} from './utils/types';
