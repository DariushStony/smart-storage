import { InMemoryStorage } from './in-memory-storage';
import { LocalStorage } from './local-storage';
import { SessionStorage } from './session-storage';
import type { IStorage } from './storage.interface';
import { StorageType } from './storage-type';
import type { StorageTypeValue } from './storage-type';

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
