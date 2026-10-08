import type { AsyncCodec } from '../codec/async-codec.js';
import type { AsyncStorageDriver } from '../drivers/async-storage-driver.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import type { SetOptions, VaultOptions, VaultStats } from './vault.js';

/** 'indexeddb', any sync or async registered name, or a driver of either kind. */
type AsyncDriverSpec =
  | 'indexeddb'
  | 'local'
  | 'session'
  | 'memory'
  | (string & Record<never, never>)
  | StorageDriver
  | AsyncStorageDriver;

interface AsyncVaultOptions extends Omit<VaultOptions, 'driver' | 'codecs'> {
  /** Where data is kept. Default 'indexeddb'. Sync drivers work too. */
  driver?: AsyncDriverSpec;
  /** String transforms that may be asynchronous (e.g. Web Crypto). */
  codecs?: readonly AsyncCodec[];
}

/**
 * The async counterpart of Vault: the same methods and rules, but each
 * returns a Promise. Calls run one at a time, in call order. Failures
 * reject; nothing throws synchronously.
 */
interface AsyncVault {
  readonly key: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  has(key: string): Promise<boolean>;
  update<T>(key: string, value: T): Promise<boolean>;
  extend(key: string, ms: number): Promise<boolean>;
  ttl(key: string): Promise<number | null>;
  remove(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  toObject(): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
  purgeExpired(): Promise<number>;
  flush(): Promise<void>;
  stats(): Promise<VaultStats>;
  dispose(): Promise<void>;
}

export type { AsyncVault, AsyncVaultOptions, AsyncDriverSpec };
