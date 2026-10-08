/**
 * The async port: the StorageDriver contract (docs/CUSTOM_STORAGE.md), except
 * every method returns a Promise and failures reject. createAsyncVault
 * accepts these as well as sync drivers.
 */
interface AsyncStorageDriver {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type { AsyncStorageDriver };
