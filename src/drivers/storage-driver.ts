/**
 * The port every storage backend implements: raw string I/O under a key.
 * Drivers know nothing about TTL, JSON or codecs; the vault does that.
 *
 * Contract (verified by `@dariushstony/smart-storage/testing`; details in
 * docs/CUSTOM_STORAGE.md):
 * - `name` is a non-empty string that never changes.
 * - Methods return their results directly, never a Promise.
 * - `read` returns `null` for a key that was never written, and exactly the
 *   written string otherwise (including `''`, unicode and large values).
 * - A second `write` replaces the value; after `remove`, `read` is `null`;
 *   removing a missing key does not throw.
 * - Keys are independent and exact, and may contain any characters.
 * - When out of space, `write` throws an error named `'QuotaExceededError'`.
 */
interface StorageDriver {
  readonly name: string;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

function isStorageDriver(value: unknown): value is StorageDriver {
  const candidate = value as Partial<StorageDriver> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.read === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.remove === 'function'
  );
}

export { isStorageDriver };
export type { StorageDriver };
