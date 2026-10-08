/**
 * smart-storage: a typed key-value vault over localStorage, sessionStorage
 * or memory, with TTL, codecs, optional debounced writes, and typed errors.
 *
 * @example
 * import { createVault } from '@dariushstony/smart-storage';
 *
 * export const prefs = createVault({ key: 'USER_PREFS' });
 * prefs.set('theme', 'dark');
 */

export { createVault } from './vault/create-vault.js';
export { MemoryDriver } from './drivers/memory-driver.js';
export { WebStorageDriver } from './drivers/web-storage-driver.js';
export { BaseStorageDriver } from './drivers/base-storage-driver.js';
export { registerDriver, unregisterDriver } from './drivers/driver-registry.js';
export {
  StorageError,
  StorageArgumentError,
  StorageQuotaError,
  StorageSerializationError,
  StorageAccessError,
  StorageDisposedError,
  StorageCorruptionError,
  StorageUnavailableError,
  StorageConflictError,
} from './errors.js';

export type {
  Vault,
  VaultOptions,
  VaultStats,
  SetOptions,
} from './vault/vault.js';
export type { Codec } from './codec/codec.js';
export type { StorageDriver } from './drivers/storage-driver.js';
export type {
  DriverSpec,
  DriverFactory,
  RegisterDriverOptions,
} from './drivers/driver-registry.js';
export type { BaseStorageDriverOptions } from './drivers/base-storage-driver.js';
export type { WebStorageLike } from './drivers/web-storage-driver.js';
export type {
  StorageErrorCode,
  StorageErrorOptions,
  StorageQuotaErrorOptions,
} from './errors.js';
