import { StorageUnavailableError } from '../errors.js';
import type { StorageError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import { MemoryDriver } from './memory-driver.js';
import type { StorageDriver } from './storage-driver.js';
import { WebStorageDriver } from './web-storage-driver.js';

type DriverSpec = 'local' | 'session' | 'memory' | StorageDriver;
type WebKind = 'local' | 'session';

interface Resolution {
  driver: StorageDriver;
  problem?: StorageError;
}

// One driver per kind, so the vault registry can see two vaults claiming the
// same localStorage key.
let shared: Partial<Record<WebKind, Resolution>> = {};

function resolveDriver(spec: DriverSpec, report: Reporter): StorageDriver {
  if (spec === 'memory') return new MemoryDriver();
  if (spec !== 'local' && spec !== 'session') return spec;

  const resolution = shared[spec] ?? (shared[spec] = resolveWebStorage(spec));
  if (resolution.problem) report(resolution.problem);
  return resolution.driver;
}

function resolveWebStorage(kind: WebKind): Resolution {
  // `window`, not `globalThis`: Node >= 25 has its own localStorage global,
  // which must never be picked up during server rendering.
  if (typeof window === 'undefined') return { driver: new MemoryDriver() };

  const name = kind === 'local' ? 'localStorage' : 'sessionStorage';
  try {
    const storage = window[name] as Storage | null | undefined;
    if (storage) return { driver: new WebStorageDriver(storage, name) };
    return {
      driver: new MemoryDriver(),
      problem: new StorageUnavailableError(
        `${name} is not available; data is kept in memory only.`
      ),
    };
  } catch (error) {
    return {
      driver: new MemoryDriver(),
      problem: new StorageUnavailableError(
        `${name} is blocked; data is kept in memory only.`,
        { cause: error }
      ),
    };
  }
}

/** Test hook: forget shared drivers so environment changes are seen. Not exported from the package. */
function resetSharedDrivers(): void {
  shared = {};
}

export { resolveDriver, resetSharedDrivers };
export type { DriverSpec };
