import { DANGEROUS_KEYS } from './constants';

/**
 * Validates a storage key.
 *
 * @param key - The key to validate.
 * @param storage - The storage instance to check availability.
 * @throws Will throw if storage is unavailable.
 * @throws Will throw if key is empty, contains only whitespace, or is a dangerous key.
 */
function validateKey(
  key: string,
  storage: Storage | Map<string, string> | null
): void {
  if (!storage) {
    throw new Error('Storage is not available (unavailable environment).');
  }

  if (!key || key.trim() === '') {
    throw new Error('Storage key cannot be empty or whitespace.');
  }

  if (DANGEROUS_KEYS.includes(key as never)) {
    throw new Error(
      `Storage key "${key}" is not allowed as it may cause prototype pollution.`
    );
  }
}

/**
 * Checks if a stored item is expired.
 *
 * @param expiry - The expiry timestamp or null if no expiry.
 * @returns True if the item is expired; false otherwise.
 */
function isExpired(expiry: number | null): boolean {
  if (expiry === null) return false;
  return Date.now() > expiry;
}

/**
 * Calculates the byte size of a string.
 *
 * @param str - The string to measure.
 * @returns The size in bytes.
 */
function getByteSize(str: string): number {
  return new Blob([str]).size;
}

/**
 * Checks if an error is a quota exceeded error.
 *
 * @param error - The error to check.
 * @returns True if the error is a quota exceeded error.
 */
function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/**
 * Checks if an error is a circular reference error.
 *
 * @param error - The error to check.
 * @returns True if the error is a circular reference error.
 */
function isCircularReferenceError(error: unknown): boolean {
  return error instanceof TypeError && error.message.includes('circular');
}

/**
 * Checks if the data record has the correct structure.
 *
 * @param parsed - The parsed data to validate.
 * @returns True if the data record has the correct structure; false otherwise.
 */
function isValidDataRecord(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  );
}

/**
 * Checks if the window is available.
 *
 * @returns True if the window is available.
 */
function isWindowAvailable(): boolean {
  return typeof window !== 'undefined';
}

export {
  validateKey,
  isExpired,
  getByteSize,
  isQuotaExceededError,
  isCircularReferenceError,
  isValidDataRecord,
  isWindowAvailable,
};
