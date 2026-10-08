import { assertKey } from '../core/validation.js';
import { StorageArgumentError, StorageUnavailableError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
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

/**
 * Builds the driver for a registered name. Throw to say "not available
 * here": vaults then fall back to memory and report StorageUnavailableError.
 */
type DriverFactory = () => StorageDriver;

interface RegisterDriverOptions {
  /**
   * One instance per name, shared by every vault (default true). Sharing
   * lets the package notice two vaults on one key.
   */
  shared?: boolean;
}

interface Resolution {
  driver: StorageDriver;
  problem?: StorageUnavailableError;
}

interface Registration {
  factory: DriverFactory;
  shared: boolean;
  resolution?: Resolution;
}

const BUILT_IN_NAMES: readonly string[] = ['local', 'session', 'memory'];

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
    ['local', { factory: webStorageFactory('localStorage'), shared: true }],
    ['session', { factory: webStorageFactory('sessionStorage'), shared: true }],
    ['memory', { factory: () => new MemoryDriver(), shared: false }],
  ]);
}

let registrations = builtIns();

/**
 * Makes a driver available by name: `createVault({ key, driver: name })`.
 * Registering a name again replaces it, so hot module reloading works.
 */
function registerDriver(
  name: string,
  factory: DriverFactory,
  options: RegisterDriverOptions = {}
): void {
  assertKey(name, 'Driver name');
  assertNotBuiltIn(name);
  if (typeof factory !== 'function') {
    throw new StorageArgumentError(
      'registerDriver() needs a factory function.'
    );
  }
  registrations.set(name, { factory, shared: options.shared ?? true });
}

/** Returns false when the name was not registered. */
function unregisterDriver(name: string): boolean {
  assertNotBuiltIn(name);
  return registrations.delete(name);
}

function resolveDriver(spec: DriverSpec, report: Reporter): StorageDriver {
  if (typeof spec !== 'string') return spec;

  const registration = registrations.get(spec);
  if (!registration) {
    throw new StorageArgumentError(
      `Unknown driver "${spec}". Register it first with registerDriver("${spec}", factory).`
    );
  }

  let resolution = registration.resolution;
  if (!resolution) {
    resolution = build(spec, registration.factory);
    if (registration.shared) registration.resolution = resolution;
  }
  if (resolution.problem) report(resolution.problem);
  return resolution.driver;
}

function build(name: string, factory: DriverFactory): Resolution {
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
}

export { registerDriver, unregisterDriver, resolveDriver, resetDriverRegistry };
export type { DriverSpec, DriverFactory, RegisterDriverOptions };
