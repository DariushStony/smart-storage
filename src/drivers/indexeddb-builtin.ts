import type { Reporter } from '../reporting/reporter.js';
import { AsyncMemoryDriver } from './async-memory-driver.js';
import { buildDriver } from './driver-registry.js';
import type { AnyStorageDriver, Resolution } from './driver-registry.js';
import { IndexedDBDriver } from './indexeddb-driver.js';

// Lives beside the async vault, not in the registry, so sync-only bundles
// never contain the IndexedDB driver.
let resolution: Resolution | undefined;

/**
 * The shared 'indexeddb' driver: silent memory on the server, reported
 * memory when a browser has no IndexedDB.
 */
function resolveIndexedDB(report: Reporter): AnyStorageDriver {
  if (!resolution) {
    resolution = buildDriver('indexeddb', () =>
      // `window`, not `globalThis`: Node has no IndexedDB, and the server
      // must fall back silently.
      typeof window === 'undefined'
        ? new AsyncMemoryDriver()
        : new IndexedDBDriver()
    );
  }
  if (resolution.problem) report(resolution.problem);
  return resolution.driver;
}

/** Test hook. Not exported from the package. */
function resetIndexedDBBuiltIn(): void {
  resolution = undefined;
}

export { resolveIndexedDB, resetIndexedDBBuiltIn };
