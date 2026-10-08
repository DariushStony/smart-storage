import {
  StorageAccessError,
  StorageCorruptionError,
  StorageQuotaError,
} from '../errors.js';
import type { StorageError } from '../errors.js';

// Rules both repositories (sync and async) apply, so they cannot drift apart.

/** Throws when `bytes` is over `maxBytes` and would grow what is already stored. */
function assertFits(
  key: string,
  bytes: number,
  storedBytes: number,
  maxBytes: number
): void {
  // Stored data may already be over the limit (written by 1.x, or under a
  // higher limit). Writes that do not grow it must pass, or it could never
  // be shrunk.
  if (bytes > maxBytes && bytes > storedBytes) {
    throw new StorageQuotaError(
      `"${key}" would be ${String(bytes)} bytes, over its ${String(maxBytes)}-byte limit.`,
      { bytes, maxBytes }
    );
  }
}

function writeFailure(
  key: string,
  bytes: number,
  error: unknown
): StorageError {
  if (isQuotaError(error)) {
    return new StorageQuotaError(
      `The browser's storage quota is full; "${key}" was not saved.`,
      { cause: error, bytes }
    );
  }
  return new StorageAccessError(`Writing "${key}" failed.`, { cause: error });
}

function accessFailure(
  action: 'Reading' | 'Removing',
  key: string,
  error: unknown
): StorageAccessError {
  return new StorageAccessError(`${action} "${key}" failed.`, { cause: error });
}

function unreadable(key: string, error: unknown): StorageCorruptionError {
  return new StorageCorruptionError(
    `Stored data for "${key}" is unreadable and was ignored; the next write replaces it.`,
    { cause: error }
  );
}

function skipped(key: string, dropped: number): StorageCorruptionError {
  return new StorageCorruptionError(
    `Skipped ${String(dropped)} unreadable item(s) in "${key}".`
  );
}

// Duck-typed: DOMException may not exist on the server, and browsers differ
// in name and legacy code (22 in most, 1014 in old Firefox).
function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

export { assertFits, writeFailure, accessFailure, unreadable, skipped };
