/**
 * Storage type constants for the vault.
 *
 * Using `as const` with a const object provides type-safe string literals
 * without the pitfalls of TypeScript enums (tree-shaking, runtime overhead).
 */
const StorageType = {
  /** Uses localStorage (persists across browser sessions, ~5-10MB quota) */
  Local: 'local',
  /** Uses sessionStorage (cleared when tab closes, ~5-10MB quota) */
  Session: 'session',
  /** Uses Map (cleared on page reload, useful for testing or temporary data) */
  InMemory: 'in-memory',
} as const;

/**
 * Union type derived from StorageType values.
 * Equivalent to: 'local' | 'session' | 'in-memory'
 */
type StorageTypeValue = (typeof StorageType)[keyof typeof StorageType];

/**
 * Default storage type (localStorage).
 */
const DEFAULT_STORAGE_TYPE: StorageTypeValue = StorageType.Local;

export { StorageType, DEFAULT_STORAGE_TYPE };
export type { StorageTypeValue };
