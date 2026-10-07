import type { Codec } from '../codec/codec.js';
import type { DriverSpec } from '../drivers/resolve-driver.js';
import type { StorageError } from '../errors.js';

interface SetOptions {
  /** Lifetime in milliseconds (> 0). Omit for an item that never expires. */
  ttl?: number;
}

interface VaultStats {
  key: string;
  /** "localStorage", "sessionStorage", "memory" or a custom driver's name. */
  driver: string;
  /** Live (non-expired) items. */
  itemCount: number;
  /** UTF-8 size of the stored string, after codecs. */
  bytes: number;
  maxBytes: number;
  /** bytes / maxBytes. */
  usage: number;
}

interface VaultOptions {
  /** The storage key this vault owns. All its items live in one string under it. */
  key: string;
  /** Where data is kept. Default 'local'. */
  driver?: DriverSpec;
  /** String transforms applied after JSON on write, reversed on read. */
  codecs?: readonly Codec[];
  /** Milliseconds to coalesce writes. Default 0: every change is written at once. */
  debounceMs?: number;
  /** Hard limit on the stored string's UTF-8 size. Default 4_000_000. */
  maxBytes?: number;
  /** Keep at most this many items; the least recently written go first. Default Infinity. */
  maxItems?: number;
  /**
   * Receives problems the caller cannot otherwise see: unreadable stored
   * data, a fallback to memory, a replaced vault, and failed deferred writes.
   * Errors thrown here are ignored. Messages can contain storage keys, so
   * filter them before forwarding to telemetry.
   */
  onError?: (error: StorageError) => void;
}

/** A typed key-value store over one storage key. Values round-trip through JSON. */
interface Vault {
  readonly key: string;
  /** A fresh copy of the value, or null when missing or expired. Never writes. */
  get<T>(key: string): T | null;
  /** Throws StorageArgumentError, StorageSerializationError or StorageQuotaError. */
  set<T>(key: string, value: T, options?: SetOptions): void;
  has(key: string): boolean;
  /** Replaces the value and keeps the expiry. False when missing or expired. */
  update<T>(key: string, value: T): boolean;
  /** Adds `ms` to the lifetime; a non-expiring item stays non-expiring. False when missing or expired. */
  extend(key: string, ms: number): boolean;
  /** Milliseconds left, Infinity when it never expires, null when missing or expired. */
  ttl(key: string): number | null;
  remove(key: string): boolean;
  /** Live keys, least recently written first. */
  keys(): string[];
  toObject(): Record<string, unknown>;
  /** Deletes the storage key and drops any pending write. */
  clear(): void;
  /** Removes expired items from storage and returns how many went. */
  purgeExpired(): number;
  /** Saves a pending debounced write now. Throws if that fails. */
  flush(): void;
  stats(): VaultStats;
  /** Flushes, detaches listeners and frees the key. Later calls throw StorageDisposedError. */
  dispose(): void;
}

export type { Vault, VaultOptions, VaultStats, SetOptions };
