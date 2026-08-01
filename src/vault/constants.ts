/**
 * Default storage key used when none is specified.
 */
const DEFAULT_STORAGE_KEY = 'APP_DATA';

/**
 * Default maximum size in bytes (~4MB).
 * Typical localStorage quota is 5-10MB per origin.
 */
const DEFAULT_MAX_SIZE_BYTES = 4_000_000;

/**
 * Default maximum items for in-memory storage to prevent memory leaks.
 */
const DEFAULT_MAX_ITEMS_IN_MEMORY = 1000;

/**
 * Default debounce time in milliseconds.
 * Balance between performance and data safety.
 */
const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Dangerous keys that could cause prototype pollution attacks.
 */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

export {
  DEFAULT_STORAGE_KEY,
  DEFAULT_MAX_SIZE_BYTES,
  DEFAULT_MAX_ITEMS_IN_MEMORY,
  DEFAULT_DEBOUNCE_MS,
  DANGEROUS_KEYS,
};
