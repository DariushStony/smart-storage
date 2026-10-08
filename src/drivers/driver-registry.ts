import { assertKey } from '../core/validation.js';
import { StorageArgumentError, StorageUnavailableError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import type { AsyncStorageDriver } from './async-storage-driver.js';
import { MemoryDriver } from './memory-driver.js';
import { isStorageDriver } from './storage-driver.js';
import type { StorageDriver } from './storage-driver.js';
import { WebStorageDriver } from './web-storage-driver.js';

/** A registered name, or a driver instance. */
type DriverSpec =
  | 'local'
  | 'session'
  | 'memory'
  | (string & Record<never, never>)
  | StorageDriver;

type AnyStorageDriver = StorageDriver | AsyncStorageDriver;

/**
 * Builds the driver for a registered name. Throw to say "not available
 * here": vaults then fall back to memory and report StorageUnavailableError.
 */
type DriverFactory = () => StorageDriver;

/** Like DriverFactory, for drivers only createAsyncVault can use. */
type AsyncDriverFactory = () => AsyncStorageDriver;

interface RegisterDriverOptions {
  /**
   * One instance per name, shared by every vault (default true). Sharing
   * lets the package notice two vaults on one key.
   */
  shared?: boolean;
}

interface Resolution {
  driver: AnyStorageDriver;
  problem?: StorageUnavailableError;
}

interface Registration {
  kind: 'sync' | 'async';
  factory: () => AnyStorageDriver;
  shared: boolean;
  resolution?: Resolution;
}

// indexeddb is resolved by the async vault itself, so sync-only bundles never
// include the IndexedDB driver; it is reserved here all the same.
const BUILT_IN_NAMES: readonly string[] = [
  'local',
  'session',
  'memory',
  'indexeddb',
];
const ASYNC_BUILT_IN_NAMES: readonly string[] = ['indexeddb'];

function webStorageFactory(
  name: 'localStorage' | 'sessionStorage'
): DriverFactory {
  return () => {
    // `window`, not `globalThis`: Node >= 25 has its own localStorage global,
    // which must never be picked up during server rendering.
    if (typeof window === 'undefined') return new MemoryDriver();
    const storage = window[name] as Storage | null | undefined;
    if (!storage) throw new Error(`${name} is not available.`);
    return new WebStorageDriver(storage, name);
  };
}

function builtIns(): Map<string, Registration> {
  return new Map<string, Registration>([
    [
      'local',
      {
        kind: 'sync',
        factory: webStorageFactory('localStorage'),
        shared: true,
      },
    ],
    [
      'session',
      {
        kind: 'sync',
        factory: webStorageFactory('sessionStorage'),
        shared: true,
      },
    ],
    [
      'memory',
      { kind: 'sync', factory: () => new MemoryDriver(), shared: false },
    ],
  ]);
}

let registrations = builtIns();

// The identity two vaults are compared by for each shared name. It outlives
// re-registration, so after hot module reloading builds a new driver
// instance, a new vault still sees the one created before it.
let scopes = new Map<string, object>();

/**
 * Makes a driver available by name: `createVault({ key, driver: name })`.
 * Registering a name again replaces it, so hot module reloading works.
 */
function registerDriver(
  name: string,
  factory: DriverFactory,
  options: RegisterDriverOptions = {}
): void {
  register(name, factory, 'sync', options, 'registerDriver');
}

/**
 * Makes an async driver available by name to `createAsyncVault`. Same rules
 * as registerDriver; `createVault` refuses these names.
 */
function registerAsyncDriver(
  name: string,
  factory: AsyncDriverFactory,
  options: RegisterDriverOptions = {}
): void {
  register(name, factory, 'async', options, 'registerAsyncDriver');
}

function register(
  name: string,
  factory: unknown,
  kind: Registration['kind'],
  options: RegisterDriverOptions,
  caller: string
): void {
  assertKey(name, 'Driver name');
  assertNotBuiltIn(name);
  if (typeof factory !== 'function') {
    throw new StorageArgumentError(`${caller}() needs a factory function.`);
  }
  registrations.set(name, {
    kind,
    factory: factory as () => AnyStorageDriver,
    shared: options.shared ?? true,
  });
}

/** Returns false when the name was not registered. */
function unregisterDriver(name: string): boolean {
  assertNotBuiltIn(name);
  return registrations.delete(name);
}

/** For createVault: sync drivers only. */
function resolveDriver(spec: DriverSpec, report: Reporter): StorageDriver {
  if (
    typeof spec === 'string' &&
    (ASYNC_BUILT_IN_NAMES.includes(spec) ||
      registrations.get(spec)?.kind === 'async')
  ) {
    throw new StorageArgumentError(
      `"${spec}" is an async driver; use createAsyncVault() with it.`
    );
  }
  return resolveAnyDriver(spec, report) as StorageDriver;
}

/** For createAsyncVault: drivers of either kind (it awaits every call). */
function resolveAnyDriver(
  spec: string | AnyStorageDriver,
  report: Reporter
): AnyStorageDriver {
  if (typeof spec !== 'string') return spec;

  const registration = registrations.get(spec);
  if (!registration) {
    throw new StorageArgumentError(
      `Unknown driver "${spec}". Register it first with registerDriver("${spec}", factory).`
    );
  }

  let resolution = registration.resolution;
  if (!resolution) {
    resolution = buildDriver(spec, registration.factory);
    if (registration.shared) registration.resolution = resolution;
  }
  if (resolution.problem) report(resolution.problem);
  return resolution.driver;
}

/**
 * What "the same storage" means for conflict detection: the shared name's
 * scope for registered shared drivers, otherwise the driver instance.
 */
function conflictScope(
  spec: string | AnyStorageDriver,
  driver: AnyStorageDriver
): object {
  if (typeof spec !== 'string' || !registrations.get(spec)?.shared) {
    return driver;
  }
  let scope = scopes.get(spec);
  if (!scope) {
    scope = {};
    scopes.set(spec, scope);
  }
  return scope;
}

/** Runs a factory; a throw means "unavailable here" and falls back to memory. */
function buildDriver(
  name: string,
  factory: () => AnyStorageDriver
): Resolution {
  let driver: unknown;
  try {
    driver = factory();
  } catch (error) {
    return {
      driver: new MemoryDriver(),
      problem: new StorageUnavailableError(
        `The "${name}" driver is not available here; data is kept in memory only.`,
        { cause: error }
      ),
    };
  }
  if (!isStorageDriver(driver)) {
    throw new StorageArgumentError(
      `The factory registered as "${name}" did not return a StorageDriver.`
    );
  }
  return { driver };
}

function assertNotBuiltIn(name: string): void {
  if (BUILT_IN_NAMES.includes(name)) {
    throw new StorageArgumentError(
      `"${name}" is a built-in driver and cannot be replaced or removed.`
    );
  }
}

/** Test hook: back to only the built-ins. Not exported from the package. */
function resetDriverRegistry(): void {
  registrations = builtIns();
  scopes = new Map();
}

export {
  registerDriver,
  registerAsyncDriver,
  unregisterDriver,
  resolveDriver,
  resolveAnyDriver,
  buildDriver,
  conflictScope,
  resetDriverRegistry,
};
export type {
  DriverSpec,
  DriverFactory,
  AsyncDriverFactory,
  AnyStorageDriver,
  RegisterDriverOptions,
  Resolution,
};
