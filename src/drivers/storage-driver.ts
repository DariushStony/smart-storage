/**
 * The port every backend implements: raw string I/O under a key.
 * Drivers know nothing about TTL, JSON or codecs.
 */
interface StorageDriver {
  /** Shown in stats and messages, e.g. "localStorage" or "memory". */
  readonly name: string;
  read(key: string): string | null;
  /** May throw, e.g. a QuotaExceededError DOMException. */
  write(key: string, value: string): void;
  remove(key: string): void;
}

export type { StorageDriver };
