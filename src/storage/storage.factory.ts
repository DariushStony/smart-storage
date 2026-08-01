import { InMemoryStorage } from './in-memory-storage.js';
import { LocalStorage } from './local-storage.js';
import { SessionStorage } from './session-storage.js';
import type { IStorage } from './storage.interface.js';
import { StorageType } from './storage-type.js';
import type { StorageTypeValue } from './storage-type.js';

/**
 * Factory for creating storage instances based on the storage type.
 */
function createStorage(storageType: StorageTypeValue): IStorage {
  switch (storageType) {
    case StorageType.Local:
      return new LocalStorage();
    case StorageType.Session:
      return new SessionStorage();
    case StorageType.InMemory:
      return new InMemoryStorage();
    default: {
      const _exhaustive: never = storageType;
      throw new Error(`Unknown storage type: ${_exhaustive as string}`);
    }
  }
}

export { createStorage };
