import type { Codec } from '../codec/codec.js';
import {
  assertKey,
  assertMaxItems,
  assertNonNegative,
  assertPositive,
} from '../core/validation.js';
import type { DriverSpec } from '../drivers/resolve-driver.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import { StorageArgumentError } from '../errors.js';
import type { StorageError } from '../errors.js';
import type { VaultOptions } from './vault.js';

const DEFAULT_MAX_BYTES = 4_000_000;

// Migrating code tends to spread 1.x options into createVault(); ignoring
// them would silently change where data goes or how it is decoded.
const LEGACY_OPTIONS: Record<string, string> = {
  storageType: "driver ('local' | 'session' | 'memory')",
  storageKey: 'key',
  maxSizeBytes: 'maxBytes',
  maxItemsInMemory: 'maxItems',
  logger: 'onError',
  transforms: 'codecs',
  transformChain: 'codecs',
};

interface ResolvedOptions {
  key: string;
  driver: DriverSpec;
  codecs: readonly Codec[];
  debounceMs: number;
  maxBytes: number;
  maxItems: number;
  onError: ((error: StorageError) => void) | undefined;
}

function resolveOptions(options: VaultOptions): ResolvedOptions {
  // Checked at runtime because JavaScript callers get no type checking.
  if (typeof (options as unknown) !== 'object' || options === null) {
    throw new StorageArgumentError(
      'createVault() needs an options object, e.g. createVault({ key: "APP" }).'
    );
  }

  for (const [legacy, replacement] of Object.entries(LEGACY_OPTIONS)) {
    if (legacy in options) {
      throw new StorageArgumentError(
        `"${legacy}" is a 1.x option; use ${replacement} instead. See docs/MIGRATION.md.`
      );
    }
  }

  const {
    key,
    driver = 'local',
    codecs = [],
    debounceMs = 0,
    maxBytes = DEFAULT_MAX_BYTES,
    maxItems = Infinity,
    onError,
  } = options;

  assertKey(key, 'Vault key');
  assertDriver(driver);
  assertCodecs(codecs);
  assertNonNegative('debounceMs', debounceMs);
  assertPositive('maxBytes', maxBytes);
  assertMaxItems(maxItems);
  if (onError !== undefined && typeof onError !== 'function') {
    throw new StorageArgumentError('onError must be a function.');
  }

  return { key, driver, codecs, debounceMs, maxBytes, maxItems, onError };
}

function assertDriver(driver: unknown): void {
  if (driver === 'local' || driver === 'session' || driver === 'memory') return;

  const candidate = driver as Partial<StorageDriver> | null;
  const valid =
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.read === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.remove === 'function';
  if (!valid) {
    throw new StorageArgumentError(
      'driver must be "local", "session", "memory" or a StorageDriver object.'
    );
  }
}

function assertCodecs(codecs: unknown): void {
  const valid =
    Array.isArray(codecs) &&
    codecs.every((codec: unknown) => {
      const candidate = codec as Partial<Codec> | null;
      return (
        typeof candidate === 'object' &&
        candidate !== null &&
        typeof candidate.encode === 'function' &&
        typeof candidate.decode === 'function'
      );
    });
  if (!valid) {
    throw new StorageArgumentError(
      'codecs must be an array of { encode, decode } objects.'
    );
  }
}

export { resolveOptions, DEFAULT_MAX_BYTES };
export type { ResolvedOptions };
