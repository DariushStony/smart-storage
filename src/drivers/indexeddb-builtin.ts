import type { Reporter } from '../reporting/reporter.js';
import { AsyncMemoryDriver } from './async-memory-driver.js';
import { buildDriver } from './driver-registry.js';
import type { AnyStorageDriver, Resolution } from './driver-registry.js';
import { IndexedDBDriver } from './indexeddb-driver.js';

// Lives beside the async vault, not in the registry, so sync-only bundles
// never contain the IndexedDB driver.
let resolution: Resolution | undefined;

/**
 * The shared 'indexeddb' driver: IndexedDB in browsers and workers, silent
 * memory on a server, reported memory in a browser without IndexedDB.
 */
function resolveIndexedDB(report: Reporter): AnyStorageDriver {
  if (!resolution) {
    resolution = buildDriver('indexeddb', () => {
      // Browsers and workers (which have no window) both have IndexedDB.
      if (typeof indexedDB !== 'undefined') return new IndexedDBDriver();
      // No IndexedDB: expected on a server, so fall back silently there; in
      // a browser it is a problem worth reporting.
      if (typeof window === 'undefined') return new AsyncMemoryDriver();
      throw new Error('This browser has no IndexedDB.');
    });
  }
  if (resolution.problem) report(resolution.problem);
  return resolution.driver;
}

/** Test hook. Not exported from the package. */
function resetIndexedDBBuiltIn(): void {
  resolution = undefined;
}

export { resolveIndexedDB, resetIndexedDBBuiltIn };
