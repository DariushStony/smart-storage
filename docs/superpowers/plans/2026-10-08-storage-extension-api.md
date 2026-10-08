# Storage Extension API Implementation Plan (PR 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let engineers add new storage backends without modifying the package: a specified driver contract, a name registry, a base class, a conformance kit, a worked example and a guide. Also move the package internals onto interfaces (DIP).

**Architecture:** `driver-registry.ts` replaces the hard-coded switch (OCP). `BaseStorageDriver` is a Template Method with namespacing, and the built-in drivers extend it. `SnapshotStore` and `SnapshotFormat` are the interfaces the vault and strategies depend on. `src/testing` is a test-runner-agnostic kit, published at `/testing`.

**Tech Stack:** TypeScript 7, tsup, Vitest 4 + happy-dom, Playwright, oxlint, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-08-storage-extension-api-design.md`

**Convention:** a code block whose info string is `ts file=<path>` holds the complete file. Write it, then run Prettier on it.

## Global Constraints

- All changes are additive to the public API. Existing signatures keep working: `new WebStorageDriver(storage, name?)` and `new MemoryDriver()`.
- The main entry stays ≤ 5 KB brotli. The kit ships only via the `./testing` subpath.
- The kit imports no test runner.
- Every error is a `StorageError` subclass. It is either thrown or reported, never both.
- Built-in driver names are `local`, `session` and `memory`.
- Commits follow the Conventional Commits format and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The branch is `feat/storage-extension-api`. The PR targets `fix/v2-minor-findings` (#23). Never push to `main`.

## Review Focus

1. **Hot module reloading re-runs `registerDriver('x', …)`.** Expect the registration to be replaced, not an error → Task 1 test.
2. **A factory that throws.** Expect a memory fallback that is reported to _every_ vault using that name, not only the first → Task 1 test.
3. **A factory that returns garbage (`{}`).** Expect a clear `StorageArgumentError` at vault creation, not a crash later → Task 1 test.
4. **The kit run against real `localStorage`.** Expect no leftover keys, including the bare `__proto__` key → Task 4 test.
5. **Two namespaced drivers on one backend.** Expect their data to stay separate → Task 2 test.

---

### Task 1: Driver registry (OCP)

**Files:**

- Create: `src/drivers/driver-registry.ts`, `tests/unit/drivers/driver-registry.test.ts`
- Modify: `src/drivers/storage-driver.ts` (add `isStorageDriver`), `src/vault/options.ts`, `src/vault/vault.ts`, `src/vault/create-vault.ts`, `src/index.ts` (DriverSpec import path), `tests/unit/vault/options.test.ts`, `tests/unit/vault/vault.test.ts`, `tests/unit/vault/registry.test.ts`, `vitest.config.ts`
- Delete: `src/drivers/resolve-driver.ts`, `tests/unit/drivers/resolve-driver.test.ts`

**Interfaces:**

- Produces:
  - `type DriverSpec = 'local' | 'session' | 'memory' | (string & Record<never, never>) | StorageDriver`
  - `type DriverFactory = () => StorageDriver`
  - `interface RegisterDriverOptions { shared?: boolean }`
  - `registerDriver(name, factory, options?)`, `unregisterDriver(name): boolean`
  - `resolveDriver(spec, report): StorageDriver`, `resetDriverRegistry()` (test hook)
  - `isStorageDriver(value): value is StorageDriver`

- [ ] **Step 1: Write the failing tests**

```ts file=tests/unit/drivers/driver-registry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import {
  registerDriver,
  resetDriverRegistry,
  resolveDriver,
  unregisterDriver,
} from '../../../src/drivers/driver-registry.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import type { StorageDriver } from '../../../src/drivers/storage-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import {
  StorageArgumentError,
  StorageUnavailableError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';

let report: Mock<(error: StorageError) => void>;

beforeEach(() => {
  resetDriverRegistry();
  report = vi.fn<(error: StorageError) => void>();
});

afterEach(() => {
  resetDriverRegistry();
});

describe('built-in drivers', () => {
  it("gives a fresh MemoryDriver per call for 'memory'", () => {
    const a = resolveDriver('memory', report);
    expect(a).toBeInstanceOf(MemoryDriver);
    expect(resolveDriver('memory', report)).not.toBe(a);
  });

  it('passes a driver object through unchanged', () => {
    const custom = new MemoryDriver();
    expect(resolveDriver(custom, report)).toBe(custom);
  });

  it.each([
    ['local', 'localStorage'],
    ['session', 'sessionStorage'],
  ] as const)("wraps window storage for '%s'", (spec, name) => {
    const driver = resolveDriver(spec, report);

    expect(driver).toBeInstanceOf(WebStorageDriver);
    expect(driver.name).toBe(name);
    driver.write('k', 'v');
    expect(window[name].getItem('k')).toBe('v');
    window[name].removeItem('k');
    expect(report).not.toHaveBeenCalled();
  });

  it('shares one driver per name', () => {
    expect(resolveDriver('local', report)).toBe(resolveDriver('local', report));
    expect(resolveDriver('local', report)).not.toBe(
      resolveDriver('session', report)
    );
  });

  it('falls back to memory silently when there is no window (SSR)', () => {
    vi.stubGlobal('window', undefined);

    expect(resolveDriver('local', report)).toBeInstanceOf(MemoryDriver);
    expect(report).not.toHaveBeenCalled();
  });

  it('falls back to memory and reports when storage access throws', () => {
    const denied = new DOMException('denied', 'SecurityError');
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw denied;
      },
    });

    expect(resolveDriver('local', report)).toBeInstanceOf(MemoryDriver);
    expect(report).toHaveBeenCalledTimes(1);
    const error = report.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error?.cause).toBe(denied);
  });

  it('falls back and reports when the storage object is missing', () => {
    vi.stubGlobal('window', { localStorage: null });

    expect(resolveDriver('local', report)).toBeInstanceOf(MemoryDriver);
    expect(report).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });

  it('reports the fallback to every caller, with one shared driver', () => {
    vi.stubGlobal('window', { localStorage: null });

    const first = resolveDriver('local', report);
    const second = resolveDriver('local', report);

    expect(second).toBe(first);
    expect(report).toHaveBeenCalledTimes(2);
  });
});

describe('registerDriver', () => {
  it('makes a custom driver resolvable by name', () => {
    const custom = new MemoryDriver();
    registerDriver('custom', () => custom);

    expect(resolveDriver('custom', report)).toBe(custom);
  });

  it('shares one instance per name by default', () => {
    registerDriver('custom', () => new MemoryDriver());

    expect(resolveDriver('custom', report)).toBe(
      resolveDriver('custom', report)
    );
  });

  it('creates an instance per vault with shared: false', () => {
    registerDriver('custom', () => new MemoryDriver(), { shared: false });

    expect(resolveDriver('custom', report)).not.toBe(
      resolveDriver('custom', report)
    );
  });

  // Hot module reloading re-runs registrations.
  it('replaces an existing custom registration and its shared instance', () => {
    const first = new MemoryDriver();
    const second = new MemoryDriver();
    registerDriver('custom', () => first);
    resolveDriver('custom', report);

    registerDriver('custom', () => second);

    expect(resolveDriver('custom', report)).toBe(second);
  });

  it.each(['local', 'session', 'memory'])(
    'refuses to replace the built-in %s',
    (name) => {
      expect(() => registerDriver(name, () => new MemoryDriver())).toThrow(
        StorageArgumentError
      );
    }
  );

  it.each([
    ['an empty name', '', (): StorageDriver => new MemoryDriver()],
    ['a non-function factory', 'custom', 'not a function'],
  ])('rejects %s', (_label, name, factory) => {
    expect(() => registerDriver(name, factory as () => StorageDriver)).toThrow(
      StorageArgumentError
    );
  });

  it('falls back to memory and reports to every caller when a custom factory throws', () => {
    const failure = new Error('backend down');
    registerDriver('flaky', () => {
      throw failure;
    });

    const first = resolveDriver('flaky', report);
    const second = resolveDriver('flaky', report);

    expect(first).toBeInstanceOf(MemoryDriver);
    expect(second).toBe(first);
    expect(report).toHaveBeenCalledTimes(2);
    const error = report.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error?.cause).toBe(failure);
  });

  it('rejects a factory that does not return a StorageDriver', () => {
    registerDriver('broken', () => ({}) as StorageDriver);

    expect(() => resolveDriver('broken', report)).toThrow(StorageArgumentError);
  });
});

describe('unregisterDriver', () => {
  it('removes a custom driver', () => {
    registerDriver('custom', () => new MemoryDriver());

    expect(unregisterDriver('custom')).toBe(true);
    expect(() => resolveDriver('custom', report)).toThrow(StorageArgumentError);
    expect(unregisterDriver('custom')).toBe(false);
  });

  it('refuses to remove a built-in', () => {
    expect(() => unregisterDriver('local')).toThrow(StorageArgumentError);
  });
});

describe('resolveDriver', () => {
  it('points at registerDriver when a name is unknown', () => {
    expect(() => resolveDriver('nope', report)).toThrow(/registerDriver/);
  });
});
```

Then delete the old suite (its cases are carried over above), and update the three files that used the old hook:

```bash
git rm -q tests/unit/drivers/resolve-driver.test.ts
sed -i '' "s#import { resetSharedDrivers } from '../../../src/drivers/resolve-driver.js';#import { resetDriverRegistry } from '../../../src/drivers/driver-registry.js';#; s/resetSharedDrivers()/resetDriverRegistry()/g" tests/unit/vault/vault.test.ts tests/unit/vault/registry.test.ts
```

In `tests/unit/vault/options.test.ts`, remove the row `['an unknown driver name', { key: 'K', driver: 'indexeddb' }],` and add `['an empty driver name', { key: 'K', driver: '' }],`. Add this test after `'keeps provided values…'`:

```ts
it('accepts any driver name; unknown names fail when the vault is built', () => {
  expect(
    resolveOptions({ key: 'K', driver: 'not-registered-yet' }).driver
  ).toBe('not-registered-yet');
});
```

In `tests/unit/vault/registry.test.ts`, add these imports: `import { registerDriver } from '../../../src/drivers/driver-registry.js';` and `StorageArgumentError` from errors. Then add these tests inside `describe('one live vault per storage key', …)`:

```ts
it('detects two vaults on one key through a registered driver name', () => {
  registerDriver('custom', () => new MemoryDriver());
  const onError = conflictSpy();
  track(createVault({ key: 'K', driver: 'custom' }));
  track(createVault({ key: 'K', driver: 'custom', onError }));

  expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
});

it('rejects a driver name nobody registered', () => {
  expect(() => createVault({ key: 'K', driver: 'nope' })).toThrow(
    StorageArgumentError
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/drivers tests/unit/vault`
Expected: FAIL. `driver-registry.js` does not resolve yet.

- [ ] **Step 3: Implement**

Add to `src/drivers/storage-driver.ts`, replacing the file:

```ts file=src/drivers/storage-driver.ts
/**
 * The port every storage backend implements: raw string I/O under a key.
 * Drivers know nothing about TTL, JSON or codecs; the vault does that.
 *
 * Contract (verified by `@dariushstony/smart-storage/testing`; details in
 * docs/CUSTOM_STORAGE.md):
 * - `name` is a non-empty string that never changes.
 * - Methods return their results directly, never a Promise.
 * - `read` returns `null` for a key that was never written, and exactly the
 *   written string otherwise (including `''`, unicode and large values).
 * - A second `write` replaces the value; after `remove`, `read` is `null`;
 *   removing a missing key does not throw.
 * - Keys are independent and exact, and may contain any characters.
 * - When out of space, `write` throws an error named `'QuotaExceededError'`.
 */
interface StorageDriver {
  readonly name: string;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

function isStorageDriver(value: unknown): value is StorageDriver {
  const candidate = value as Partial<StorageDriver> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.read === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.remove === 'function'
  );
}

export { isStorageDriver };
export type { StorageDriver };
```

```ts file=src/drivers/driver-registry.ts
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
```

```bash
git rm -q src/drivers/resolve-driver.ts
sed -i '' "s#'../drivers/resolve-driver.js'#'../drivers/driver-registry.js'#" src/vault/create-vault.ts src/vault/vault.ts src/vault/options.ts
sed -i '' "s#'./drivers/resolve-driver.js'#'./drivers/driver-registry.js'#" src/index.ts
```

In `src/vault/options.ts`, replace the whole `assertDriver` function with the version below. Import `isStorageDriver` from `'../drivers/storage-driver.js'`, and drop the now-unused `StorageDriver` type import if oxlint reports it.

```ts
function assertDriver(driver: unknown): void {
  const valid =
    typeof driver === 'string' ? driver.trim() !== '' : isStorageDriver(driver);
  if (!valid) {
    throw new StorageArgumentError(
      'driver must be a registered driver name (such as "local") or a StorageDriver object.'
    );
  }
}
```

In `vitest.config.ts`, the coverage `exclude` becomes `['src/vault/vault.ts']`, because `storage-driver.ts` now has runtime code.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add -A src tests vitest.config.ts
git commit -m "feat(drivers): add a driver registry so new storages plug in by name

registerDriver(name, factory) makes a backend usable as
createVault({ key, driver: name }). The built-in local, session and memory
drivers register the same way, replacing the hard-coded switch. A factory
that throws makes vaults fall back to memory and report it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `BaseStorageDriver` (Template Method)

**Files:**

- Create: `src/drivers/base-storage-driver.ts`, `tests/unit/drivers/base-storage-driver.test.ts`
- Modify: `src/drivers/memory-driver.ts`, `src/drivers/web-storage-driver.ts`

**Interfaces:**

- Consumes: `StorageDriver` (Task 1), `assertKey`.
- Produces: `abstract class BaseStorageDriver implements StorageDriver` with `constructor(options?: BaseStorageDriverOptions)`, protected abstract `readRaw` / `writeRaw` / `removeRaw`, and `interface BaseStorageDriverOptions { namespace?: string }`. Also `MemoryDriver(options?)` and `WebStorageDriver(storage, name?, options?)`.

- [ ] **Step 1: Write the failing test**

```ts file=tests/unit/drivers/base-storage-driver.test.ts
import { beforeEach, describe, expect, it } from 'vitest';

import { BaseStorageDriver } from '../../../src/drivers/base-storage-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import { StorageArgumentError } from '../../../src/errors.js';

class RecordingDriver extends BaseStorageDriver {
  override readonly name = 'recording';
  readonly data = new Map<string, string>();

  protected override readRaw(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  protected override writeRaw(key: string, value: string): void {
    this.data.set(key, value);
  }

  protected override removeRaw(key: string): void {
    this.data.delete(key);
  }
}

beforeEach(() => {
  localStorage.clear();
});

describe('BaseStorageDriver', () => {
  it('delegates to the raw methods with the key unchanged by default', () => {
    const driver = new RecordingDriver();

    driver.write('k', 'v');

    expect([...driver.data.keys()]).toEqual(['k']);
    expect(driver.read('k')).toBe('v');
    driver.remove('k');
    expect(driver.data.size).toBe(0);
  });

  it('prefixes every key with the namespace', () => {
    const driver = new RecordingDriver({ namespace: 'app' });

    driver.write('k', 'v');

    expect([...driver.data.keys()]).toEqual(['app:k']);
    expect(driver.read('k')).toBe('v');
    driver.remove('k');
    expect(driver.data.size).toBe(0);
  });

  it('keeps two namespaces on one backend apart', () => {
    const a = new WebStorageDriver(localStorage, 'localStorage', {
      namespace: 'a',
    });
    const b = new WebStorageDriver(localStorage, 'localStorage', {
      namespace: 'b',
    });

    a.write('k', 'from a');
    b.write('k', 'from b');

    expect(a.read('k')).toBe('from a');
    expect(b.read('k')).toBe('from b');
    expect(localStorage.getItem('a:k')).toBe('from a');
  });

  it.each(['', '   ', 5])('rejects the namespace %j', (namespace) => {
    expect(
      () => new RecordingDriver({ namespace: namespace as string })
    ).toThrow(StorageArgumentError);
  });

  it('is the base of the built-in drivers', () => {
    expect(new MemoryDriver()).toBeInstanceOf(BaseStorageDriver);
    expect(new WebStorageDriver(localStorage)).toBeInstanceOf(
      BaseStorageDriver
    );
  });

  it('gives MemoryDriver a namespace option too', () => {
    const driver = new MemoryDriver({ namespace: 'ns' });
    driver.write('k', 'v');
    expect(driver.read('k')).toBe('v');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/drivers/base-storage-driver.test.ts`
Expected: FAIL. `base-storage-driver.js` does not resolve yet.

- [ ] **Step 3: Implement**

```ts file=src/drivers/base-storage-driver.ts
import { assertKey } from '../core/validation.js';
import type { StorageDriver } from './storage-driver.js';

interface BaseStorageDriverOptions {
  /** Prefix every key with `${namespace}:`, for backends shared with other code. */
  namespace?: string;
}

/**
 * A starting point for custom drivers (Template Method). Implement the three
 * raw methods; the public `read` / `write` / `remove` add the namespace and
 * should not be overridden.
 */
abstract class BaseStorageDriver implements StorageDriver {
  abstract readonly name: string;
  private readonly prefix: string;

  constructor(options: BaseStorageDriverOptions = {}) {
    const { namespace } = options;
    if (namespace !== undefined) assertKey(namespace, 'namespace');
    this.prefix = namespace === undefined ? '' : `${namespace}:`;
  }

  read(key: string): string | null {
    return this.readRaw(this.prefix + key);
  }

  write(key: string, value: string): void {
    this.writeRaw(this.prefix + key, value);
  }

  remove(key: string): void {
    this.removeRaw(this.prefix + key);
  }

  /** Return the stored string, or null when there is none. */
  protected abstract readRaw(key: string): string | null;
  /** Store the string. Throw an error named 'QuotaExceededError' when full. */
  protected abstract writeRaw(key: string, value: string): void;
  /** Delete the key; do nothing if it is not there. */
  protected abstract removeRaw(key: string): void;
}

export { BaseStorageDriver };
export type { BaseStorageDriverOptions };
```

```ts file=src/drivers/memory-driver.ts
import { BaseStorageDriver } from './base-storage-driver.js';
import type { BaseStorageDriverOptions } from './base-storage-driver.js';

/** Keeps data in a Map for the lifetime of the page (or process, on a server). */
class MemoryDriver extends BaseStorageDriver {
  override readonly name: string = 'memory';
  private readonly data = new Map<string, string>();

  constructor(options?: BaseStorageDriverOptions) {
    super(options);
  }

  protected override readRaw(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  protected override writeRaw(key: string, value: string): void {
    this.data.set(key, value);
  }

  protected override removeRaw(key: string): void {
    this.data.delete(key);
  }
}

export { MemoryDriver };
```

```ts file=src/drivers/web-storage-driver.ts
import { BaseStorageDriver } from './base-storage-driver.js';
import type { BaseStorageDriverOptions } from './base-storage-driver.js';

type WebStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Adapts localStorage, sessionStorage or any object with the same three methods. */
class WebStorageDriver extends BaseStorageDriver {
  override readonly name: string;
  private readonly storage: WebStorageLike;

  constructor(
    storage: WebStorageLike,
    name = 'webStorage',
    options?: BaseStorageDriverOptions
  ) {
    super(options);
    this.storage = storage;
    this.name = name;
  }

  protected override readRaw(key: string): string | null {
    return this.storage.getItem(key);
  }

  protected override writeRaw(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  protected override removeRaw(key: string): void {
    this.storage.removeItem(key);
  }
}

export { WebStorageDriver };
export type { WebStorageLike };
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/drivers tests/unit/drivers
git commit -m "feat(drivers): add BaseStorageDriver with optional key namespace

Custom drivers implement three protected raw methods; the base adds an
optional namespace prefix. The built-in drivers extend it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Depend on interfaces inside the package (DIP)

**Files:**

- Create: `src/persistence/snapshot-store.ts`
- Modify: `src/persistence/snapshot-repository.ts`, `src/persistence/snapshot-serializer.ts`, `src/persistence/write-strategy.ts`, `src/vault/default-vault.ts`, `vitest.config.ts`, `tests/unit/persistence/write-strategy.test.ts`, `tests/unit/persistence/snapshot-repository.test.ts`

**Interfaces:**

- Produces: `interface SnapshotFormat { serialize; deserialize }` and `interface SnapshotStore { key; driverName; load; save; remove; measure; storedBytes }`.

- [ ] **Step 1: Write the failing tests** (they fail on types, because the interfaces do not exist yet)

Append to `tests/unit/persistence/write-strategy.test.ts`. Add the imports `import type { SnapshotStore } from '../../../src/persistence/snapshot-store.js';` and `import { Snapshot } …` (already imported).

```ts
describe('seams', () => {
  it('ImmediateWriteStrategy works with any SnapshotStore', () => {
    const saved: Snapshot[] = [];
    const store: SnapshotStore = {
      key: 'K',
      driverName: 'fake',
      load: () => Snapshot.empty,
      save: (snapshot) => {
        saved.push(snapshot);
      },
      remove: () => undefined,
      measure: () => 0,
      storedBytes: () => 0,
    };

    new ImmediateWriteStrategy(store).write(one);

    expect(saved).toEqual([one]);
  });
});
```

Append to `tests/unit/persistence/snapshot-repository.test.ts`. Add the import `import type { SnapshotFormat } from '../../../src/persistence/snapshot-store.js';`.

```ts
describe('SnapshotRepository seams', () => {
  it('works with any SnapshotFormat', () => {
    const driver = new MemoryDriver();
    const format: SnapshotFormat = {
      serialize: () => 'TEXT',
      deserialize: () => ({
        snapshot: Snapshot.empty.with('a', entry(1)),
        dropped: 0,
      }),
    };
    const repository = new SnapshotRepository({
      driver,
      key: 'K',
      serializer: format,
      maxBytes: 1000,
      report: vi.fn(),
    });

    repository.save(Snapshot.empty);
    driver.write('K', 'OTHER');

    expect(driver.read('K')).toBe('OTHER');
    expect(repository.load().get('a', 0)).toEqual(entry(1));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm typecheck`
Expected: FAIL. `Cannot find module '…/snapshot-store.js'`.

- [ ] **Step 3: Implement**

```ts file=src/persistence/snapshot-store.ts
import type { DecodedEnvelope } from '../core/envelope.js';
import type { Snapshot } from '../core/snapshot.js';

/** Turns a snapshot into stored text and back. */
interface SnapshotFormat {
  serialize(snapshot: Snapshot): string;
  /** Throws when the text cannot be read; callers treat that as corruption. */
  deserialize(text: string): DecodedEnvelope;
}

/** Loads and saves the snapshot kept under one storage key. */
interface SnapshotStore {
  readonly key: string;
  readonly driverName: string;
  load(): Snapshot;
  /** Throws StorageQuotaError, StorageAccessError or StorageSerializationError. */
  save(snapshot: Snapshot): void;
  remove(): void;
  measure(snapshot: Snapshot): number;
  storedBytes(): number;
}

export type { SnapshotFormat, SnapshotStore };
```

Then:

- `snapshot-serializer.ts`: `class SnapshotSerializer implements SnapshotFormat`, with `import type { SnapshotFormat } from './snapshot-store.js';`.
- `snapshot-repository.ts`: `class SnapshotRepository implements SnapshotStore`. The `RepositoryDeps.serializer` field and the private `serializer` field are typed `SnapshotFormat`, imported from `'./snapshot-store.js'`. Remove the `SnapshotSerializer` type import.
- `write-strategy.ts`: replace every `SnapshotRepository` type with `SnapshotStore`, imported from `'./snapshot-store.js'`.
- `default-vault.ts`: `VaultDeps.repository` and the field become `SnapshotStore`, imported from `'../persistence/snapshot-store.js'`.
- `vitest.config.ts` coverage `exclude`: `['src/vault/vault.ts', 'src/persistence/snapshot-store.ts']`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm typecheck && pnpm test && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A src tests vitest.config.ts
git commit -m "refactor(persistence): depend on SnapshotStore and SnapshotFormat interfaces

The vault and write strategies no longer name the concrete repository,
and the repository no longer names the concrete serializer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Conformance kit at `@dariushstony/smart-storage/testing`

**Files:**

- Create: `src/testing/conformance.ts`, `src/testing/index.ts`, `tests/unit/testing/conformance.test.ts`
- Modify: `tsup.config.ts`, `package.json` (`exports`), `tests/types/consumer.ts`

**Interfaces:**

- Produces: `verifyStorageDriver(create, options?) → Promise<ConformanceReport>`, `assertStorageDriver(create, options?) → Promise<void>`, and the types `VerifyOptions`, `ConformanceCheck`, `ConformanceReport`. Internals for PR 3: `runConformance(create, modeCheck, options)`, `SYNC_CHECK`, `formatFailures(report)`, `CheckedDriver`.

- [ ] **Step 1: Write the failing test**

```ts file=tests/unit/testing/conformance.test.ts
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import type { StorageDriver } from '../../../src/drivers/storage-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import {
  assertStorageDriver,
  verifyStorageDriver,
} from '../../../src/testing/index.js';

const RULES = [
  'sync',
  'name',
  'missing',
  'roundtrip',
  'empty',
  'exact',
  'large',
  'overwrite',
  'remove',
  'remove-missing',
  'independent',
  'any-key',
];

type Override = (data: Map<string, string>) => object;

/** A correct Map-backed driver, with whatever `override` replaces. */
function brokenDriver(override: Override): () => StorageDriver {
  return () => {
    const data = new Map<string, string>();
    const correct = {
      name: 'broken',
      read: (key: string): string | null => data.get(key) ?? null,
      write: (key: string, value: string): void => {
        data.set(key, value);
      },
      remove: (key: string): void => {
        data.delete(key);
      },
    };
    return { ...correct, ...override(data) } as StorageDriver;
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the built-in drivers honour the contract', () => {
  it.each([
    ['MemoryDriver', (): StorageDriver => new MemoryDriver()],
    [
      'MemoryDriver with a namespace',
      (): StorageDriver => new MemoryDriver({ namespace: 'ns' }),
    ],
    [
      'WebStorageDriver over localStorage',
      (): StorageDriver => new WebStorageDriver(localStorage, 'localStorage'),
    ],
    [
      'WebStorageDriver over sessionStorage',
      (): StorageDriver =>
        new WebStorageDriver(sessionStorage, 'sessionStorage'),
    ],
  ])('%s', async (_label, create) => {
    await expect(assertStorageDriver(create)).resolves.toBeUndefined();
  });
});

describe('verifyStorageDriver', () => {
  it('reports every rule, in order, with the driver name', async () => {
    const report = await verifyStorageDriver(() => new MemoryDriver());

    expect(report.driver).toBe('memory');
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.rule)).toEqual(RULES);
  });

  it('removes every key it wrote, including the bare __proto__ key', async () => {
    await verifyStorageDriver(
      () => new WebStorageDriver(localStorage, 'localStorage')
    );

    expect(localStorage.length).toBe(0);
  });

  it.each<[string, Override]>([
    [
      'sync',
      (data) => ({
        read: (key: string) => Promise.resolve(data.get(key) ?? null),
      }),
    ],
    ['name', () => ({ name: '' })],
    ['missing', (data) => ({ read: (key: string) => data.get(key) })],
    ['roundtrip', () => ({ write: () => undefined })],
    ['empty', (data) => ({ read: (key: string) => data.get(key) || null })],
    [
      'exact',
      (data) => ({
        write: (key: string, value: string) => {
          data.set(key, value.trim());
        },
      }),
    ],
    [
      'large',
      (data) => ({
        write: (key: string, value: string) => {
          data.set(key, value.slice(0, 1000));
        },
      }),
    ],
    [
      'overwrite',
      (data) => ({
        write: (key: string, value: string) => {
          if (!data.has(key)) data.set(key, value);
        },
      }),
    ],
    ['remove', () => ({ remove: () => undefined })],
    [
      'remove-missing',
      (data) => ({
        remove: (key: string) => {
          if (!data.delete(key)) throw new Error('no such key');
        },
      }),
    ],
    [
      'independent',
      (data) => ({
        read: (key: string) => data.get(key.toLowerCase()) ?? null,
        write: (key: string, value: string) => {
          data.set(key.toLowerCase(), value);
        },
        remove: (key: string) => {
          data.delete(key.toLowerCase());
        },
      }),
    ],
    [
      'any-key',
      () => {
        const record: Record<string, unknown> = {};
        return {
          read: (key: string) => (key in record ? record[key] : null),
          write: (key: string, value: string) => {
            record[key] = value;
          },
          remove: (key: string) => {
            Reflect.deleteProperty(record, key);
          },
        };
      },
    ],
  ])('detects a driver that breaks [%s]', async (rule, override) => {
    const report = await verifyStorageDriver(brokenDriver(override));

    const failed = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.rule);
    expect(failed).toContain(rule);
    expect(report.passed).toBe(false);
  });

  it('records a driver whose constructor throws as failing every rule', async () => {
    const report = await verifyStorageDriver(() => {
      throw new Error('no backend');
    });

    expect(report.driver).toBe('unknown');
    expect(report.checks.every((check) => !check.passed)).toBe(true);
  });

  it('lets small backends lower the large-value size', async () => {
    const truncating = brokenDriver((data) => ({
      write: (key: string, value: string) => {
        data.set(key, value.slice(0, 1000));
      },
    }));

    const report = await verifyStorageDriver(truncating, {
      largeValueLength: 500,
    });

    expect(report.passed).toBe(true);
  });
});

describe('assertStorageDriver', () => {
  it('throws an error naming each broken rule', async () => {
    await expect(
      assertStorageDriver(brokenDriver(() => ({ remove: () => undefined })))
    ).rejects.toThrow(/\[remove\] read returns null after remove/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/testing`
Expected: FAIL. `src/testing/index.js` does not resolve yet.

- [ ] **Step 3: Implement**

```ts file=src/testing/conformance.ts
type MaybePromise<T> = T | Promise<T>;

/** The surface the checks touch; sync and async drivers both fit it. */
interface CheckedDriver {
  readonly name: string;
  read(key: string): MaybePromise<string | null>;
  write(key: string, value: string): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

interface VerifyOptions {
  /**
   * Characters written by the [large] check. Default 65_536; lower it for
   * small backends such as cookies.
   */
  largeValueLength?: number;
}

interface ConformanceCheck {
  /** Rule id, as listed in docs/CUSTOM_STORAGE.md. */
  rule: string;
  description: string;
  passed: boolean;
  /** Why it failed: a ContractViolation, or whatever the driver threw. */
  error?: unknown;
}

interface ConformanceReport {
  /** The driver's name, or 'unknown' when none could be read. */
  driver: string;
  passed: boolean;
  checks: ConformanceCheck[];
}

interface Settings {
  largeValueLength: number;
}

interface Check {
  rule: string;
  description: string;
  run(
    driver: CheckedDriver,
    keys: KeyTracker,
    settings: Settings
  ): MaybePromise<void>;
}

class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}

/** Remembers every key a check touches, so the runner can remove them. */
class KeyTracker {
  readonly used = new Set<string>();

  key(name: string): string {
    this.used.add(name);
    return name;
  }
}

const P = '__conformance__:';

const EXACT_VALUES = [
  'unicode: é 中文 😀',
  'quotes: " \' and a backslash \\',
  'whitespace:\n\r\t and trailing  ',
  '{"json":[1,2,{"nested":null}],"escaped":"\\u0000"}',
];

function show(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 60
      ? `a ${String(value.length)}-character string`
      : JSON.stringify(value);
  }
  if (value === null) return 'null';
  return typeof value === 'object' ? 'an object' : String(value);
}

function same(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new ContractViolation(
      `${what}: expected ${show(expected)}, got ${show(actual)}.`
    );
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function largeValue(length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(97 + (i % 26));
  }
  return text;
}

async function roundTrip(
  driver: CheckedDriver,
  key: string,
  value: string,
  what: string
): Promise<void> {
  await driver.write(key, value);
  same(await driver.read(key), value, what);
}

const CONTRACT: Check[] = [
  {
    rule: 'name',
    description: 'name is a non-empty string',
    run: (driver) => {
      if (typeof driver.name !== 'string' || driver.name.trim() === '') {
        throw new ContractViolation(
          `name: expected a non-empty string, got ${show(driver.name)}.`
        );
      }
    },
  },
  {
    rule: 'missing',
    description: 'read returns null for a key that was never written',
    run: async (driver, keys) => {
      same(
        await driver.read(keys.key(`${P}missing`)),
        null,
        'read of a missing key'
      );
    },
  },
  {
    rule: 'roundtrip',
    description: 'read returns exactly what write stored',
    run: (driver, keys) =>
      roundTrip(driver, keys.key(`${P}roundtrip`), 'value', 'read after write'),
  },
  {
    rule: 'empty',
    description: 'the empty string round-trips as "", not null',
    run: (driver, keys) =>
      roundTrip(driver, keys.key(`${P}empty`), '', 'read after writing ""'),
  },
  {
    rule: 'exact',
    description:
      'unicode, quotes, backslashes, newlines and JSON text round-trip unchanged',
    run: async (driver, keys) => {
      for (const [index, value] of EXACT_VALUES.entries()) {
        await roundTrip(
          driver,
          keys.key(`${P}exact-${String(index)}`),
          value,
          `read after writing ${show(value)}`
        );
      }
    },
  },
  {
    rule: 'large',
    description: 'a large value round-trips',
    run: (driver, keys, settings) =>
      roundTrip(
        driver,
        keys.key(`${P}large`),
        largeValue(settings.largeValueLength),
        'read after a large write'
      ),
  },
  {
    rule: 'overwrite',
    description: 'a second write replaces the value',
    run: async (driver, keys) => {
      const key = keys.key(`${P}overwrite`);
      await driver.write(key, 'first');
      await roundTrip(driver, key, 'second', 'read after overwriting');
    },
  },
  {
    rule: 'remove',
    description: 'read returns null after remove',
    run: async (driver, keys) => {
      const key = keys.key(`${P}remove`);
      await driver.write(key, 'value');
      await driver.remove(key);
      same(await driver.read(key), null, 'read after remove');
    },
  },
  {
    rule: 'remove-missing',
    description: 'removing a key that was never written does not throw',
    run: async (driver, keys) => {
      await driver.remove(keys.key(`${P}never-written`));
    },
  },
  {
    rule: 'independent',
    description: 'keys are independent and exact (case and spaces matter)',
    run: async (driver, keys) => {
      const removed = keys.key(`${P}a`);
      const kept = [`${P}b`, `${P}K`, `${P}k`, `${P} k`].map((key) =>
        keys.key(key)
      );
      for (const key of [removed, ...kept]) {
        await driver.write(key, `value of ${key}`);
      }
      await driver.remove(removed);

      same(await driver.read(removed), null, 'read of a removed key');
      for (const key of kept) {
        same(await driver.read(key), `value of ${key}`, `read of ${show(key)}`);
      }
    },
  },
  {
    rule: 'any-key',
    description: 'keys may contain ":", "/", spaces, unicode and "__proto__"',
    run: async (driver, keys) => {
      // The bare __proto__ catches drivers built on plain objects.
      for (const key of [`${P}a:b/c d`, `${P}ü 中文 😀`, '__proto__']) {
        await roundTrip(
          driver,
          keys.key(key),
          `value of ${key}`,
          `read of ${show(key)}`
        );
      }
    },
  },
];

const SYNC_CHECK: Check = {
  rule: 'sync',
  description:
    'read, write and remove return their results directly, not Promises',
  run: (driver, keys) => {
    const key = keys.key(`${P}sync`);
    const results: Array<[string, unknown]> = [
      ['write', driver.write(key, 'value')],
      ['read', driver.read(key)],
      ['remove', driver.remove(key)],
    ];
    for (const [method, result] of results) {
      if (isThenable(result)) {
        // Swallow its outcome so it cannot surface as an unhandled rejection.
        result.then(undefined, () => undefined);
        throw new ContractViolation(
          `${method} returned a Promise; a sync driver must return its result directly.`
        );
      }
    }
  },
};

async function runConformance(
  create: () => MaybePromise<CheckedDriver>,
  modeCheck: Check,
  options: VerifyOptions = {}
): Promise<ConformanceReport> {
  const settings: Settings = {
    largeValueLength: options.largeValueLength ?? 65_536,
  };
  const checks: ConformanceCheck[] = [];
  let driverName = 'unknown';

  for (const check of [modeCheck, ...CONTRACT]) {
    const keys = new KeyTracker();
    let driver: CheckedDriver | undefined;
    try {
      driver = await create();
      if (typeof driver.name === 'string' && driver.name !== '') {
        driverName = driver.name;
      }
      await check.run(driver, keys, settings);
      checks.push({
        rule: check.rule,
        description: check.description,
        passed: true,
      });
    } catch (error) {
      checks.push({
        rule: check.rule,
        description: check.description,
        passed: false,
        error,
      });
    } finally {
      if (driver) await cleanUp(driver, keys);
    }
  }

  return {
    driver: driverName,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function cleanUp(driver: CheckedDriver, keys: KeyTracker): Promise<void> {
  for (const key of keys.used) {
    try {
      await driver.remove(key);
    } catch {
      // Best effort: a broken remove is already reported by its own rule.
    }
  }
}

function formatFailures(report: ConformanceReport): string {
  const failed = report.checks.filter((check) => !check.passed);
  const lines = failed.map((check) => {
    const reason =
      check.error instanceof Error ? check.error.message : String(check.error);
    return `- [${check.rule}] ${check.description}: ${reason}`;
  });
  return `Driver "${report.driver}" breaks ${String(failed.length)} contract rule(s):\n${lines.join('\n')}`;
}

export { runConformance, formatFailures, SYNC_CHECK, ContractViolation };
export type {
  Check,
  CheckedDriver,
  ConformanceCheck,
  ConformanceReport,
  VerifyOptions,
};
```

```ts file=src/testing/index.ts
/**
 * Test kit for storage drivers: proves a driver honours the contract the
 * vault relies on. Plain async functions, so it works with any test runner.
 *
 * @example
 * import { assertStorageDriver } from '@dariushstony/smart-storage/testing';
 *
 * it('honours the driver contract', async () => {
 *   await assertStorageDriver(() => new MyDriver());
 * });
 */
import type { StorageDriver } from '../drivers/storage-driver.js';
import { SYNC_CHECK, formatFailures, runConformance } from './conformance.js';
import type {
  ConformanceCheck,
  ConformanceReport,
  VerifyOptions,
} from './conformance.js';

/** Runs every contract check, each against a fresh driver from `create`. */
function verifyStorageDriver(
  create: () => StorageDriver,
  options?: VerifyOptions
): Promise<ConformanceReport> {
  return runConformance(create, SYNC_CHECK, options);
}

/** Like verifyStorageDriver, but throws an Error listing every broken rule. */
async function assertStorageDriver(
  create: () => StorageDriver,
  options?: VerifyOptions
): Promise<void> {
  const report = await verifyStorageDriver(create, options);
  if (!report.passed) throw new Error(formatFailures(report));
}

export { verifyStorageDriver, assertStorageDriver };
export type { ConformanceCheck, ConformanceReport, VerifyOptions };
```

Build wiring:

- `tsup.config.ts`: `entry: { index: 'src/index.ts', testing: 'src/testing/index.ts' },`
- `package.json` `exports`: add
  ```json
  "./testing": {
    "types": "./dist/testing/index.d.ts",
    "import": "./dist/testing.js",
    "require": "./dist/testing.cjs"
  }
  ```
- `tests/types/consumer.ts`: add

  ```ts
  import { assertStorageDriver } from '@dariushstony/smart-storage/testing';
  import type { ConformanceReport } from '@dariushstony/smart-storage/testing';

  export const checkDriver = (driver: StorageDriver): Promise<void> =>
    assertStorageDriver(() => driver);
  export const passed = (report: ConformanceReport): boolean => report.passed;
  ```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests && pnpm build && pnpm typecheck:dist && ls dist/testing.js dist/testing.cjs dist/testing/index.d.ts`
Expected: everything passes, and all three files exist.

- [ ] **Step 5: Commit**

```bash
git add -A src tests tsup.config.ts package.json
git commit -m "feat(testing): add a conformance kit for storage drivers

@dariushstony/smart-storage/testing exports verifyStorageDriver and
assertStorageDriver. They check every rule of the driver contract against
fresh driver instances, work with any test runner, and clean up after
themselves.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Public exports and the worked cookie-driver example

**Files:**

- Modify: `src/index.ts`, `tests/unit/public-api.test.ts`, `vitest.config.ts` (aliases), `tsconfig.test.json` (paths + examples)
- Create: `examples/cookie-driver/cookie-driver.ts`, `examples/cookie-driver/README.md`, `tests/unit/examples/cookie-driver.test.ts`

**Interfaces:**

- Produces: main-entry runtime additions `registerDriver`, `unregisterDriver`, `BaseStorageDriver`, and type additions `DriverFactory`, `RegisterDriverOptions`, `BaseStorageDriverOptions`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/public-api.test.ts`, add `'BaseStorageDriver'`, `'registerDriver'` and `'unregisterDriver'` to the expected list, and append:

```ts
describe('testing entry', () => {
  it('exports exactly the kit', async () => {
    const testing = await import('../../src/testing/index.js');
    expect(Object.keys(testing).sort()).toEqual([
      'assertStorageDriver',
      'verifyStorageDriver',
    ]);
  });
});
```

```ts file=tests/unit/examples/cookie-driver.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StorageQuotaError,
  StorageUnavailableError,
  createVault,
  registerDriver,
  unregisterDriver,
} from '@dariushstony/smart-storage';
import type { StorageError, Vault } from '@dariushstony/smart-storage';
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';

import { CookieDriver } from '../../../examples/cookie-driver/cookie-driver.js';

const vaults: Vault[] = [];

function clearCookies(): void {
  if (typeof document === 'undefined') return;
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

afterEach(() => {
  vaults.splice(0).forEach((vault) => vault.dispose());
  unregisterDriver('cookie');
  clearCookies();
});

describe('CookieDriver (examples/cookie-driver)', () => {
  it('honours the driver contract', async () => {
    await assertStorageDriver(() => new CookieDriver({ namespace: 'test' }), {
      largeValueLength: 1_000,
    });
  });

  it('works as a registered driver under a vault', () => {
    registerDriver('cookie', () => new CookieDriver({ namespace: 'app' }));
    const vault = createVault({ key: 'PREFS', driver: 'cookie' });
    vaults.push(vault);

    vault.set('theme', 'dark');

    expect(document.cookie).toContain('app%3APREFS=');
    expect(vault.get('theme')).toBe('dark');
  });

  it('turns an oversized cookie into StorageQuotaError', () => {
    registerDriver('cookie', () => new CookieDriver());
    const vault = createVault({ key: 'BIG', driver: 'cookie' });
    vaults.push(vault);

    expect(() => vault.set('text', 'x'.repeat(5_000))).toThrow(
      StorageQuotaError
    );
  });

  it('falls back to memory, and reports it, without a document', () => {
    vi.stubGlobal('document', undefined);
    registerDriver('cookie', () => new CookieDriver());
    const onError = vi.fn<(error: StorageError) => void>();

    const vault = createVault({ key: 'SSR', driver: 'cookie', onError });
    vaults.push(vault);
    vault.set('a', 1);

    expect(vault.get('a')).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/public-api.test.ts tests/unit/examples`
Expected: FAIL. The new exports are missing, and the package alias and example do not exist yet.

- [ ] **Step 3: Implement**

`src/index.ts`. Add these runtime exports:

```ts
export { registerDriver, unregisterDriver } from './drivers/driver-registry.js';
export { BaseStorageDriver } from './drivers/base-storage-driver.js';
```

Replace the `DriverSpec` type export with:

```ts
export type {
  DriverSpec,
  DriverFactory,
  RegisterDriverOptions,
} from './drivers/driver-registry.js';
export type { BaseStorageDriverOptions } from './drivers/base-storage-driver.js';
```

In `vitest.config.ts`, add at the top `import { fileURLToPath } from 'node:url';` and this helper:

```ts
const fromSrc = (path: string): string =>
  fileURLToPath(new URL(`./src/${path}`, import.meta.url));
```

Add inside `defineConfig({ … })`, beside `test`:

```ts
  // Lets examples import the package by name while tests run the source.
  resolve: {
    alias: [
      {
        find: /^@dariushstony\/smart-storage\/testing$/,
        replacement: fromSrc('testing/index.ts'),
      },
      { find: /^@dariushstony\/smart-storage$/, replacement: fromSrc('index.ts') },
    ],
  },
```

In `tsconfig.test.json`, add `"paths": { "@dariushstony/smart-storage": ["./src/index.ts"], "@dariushstony/smart-storage/testing": ["./src/testing/index.ts"] }` under `compilerOptions`, and add `"examples/**/*.ts"` to `include`.

```ts file=examples/cookie-driver/cookie-driver.ts
import { BaseStorageDriver } from '@dariushstony/smart-storage';
import type { BaseStorageDriverOptions } from '@dariushstony/smart-storage';

interface CookieDriverOptions extends BaseStorageDriverOptions {
  /** Days until the cookie expires. Default 365. */
  maxAgeDays?: number;
}

// Browsers keep at most about 4 KB per cookie (name, value and attributes).
const MAX_COOKIE_LENGTH = 4096;

/**
 * Stores each vault in one cookie. A teaching example of a custom driver:
 * cookies travel with every HTTP request, so prefer localStorage in real
 * apps.
 */
class CookieDriver extends BaseStorageDriver {
  override readonly name = 'cookie';
  private readonly maxAgeSeconds: number;

  constructor(options: CookieDriverOptions = {}) {
    super(options);
    // Throwing here makes a registered factory fall back to memory on the server.
    if (typeof document === 'undefined') {
      throw new Error('CookieDriver needs a browser document.');
    }
    this.maxAgeSeconds = Math.round((options.maxAgeDays ?? 365) * 86_400);
  }

  protected override readRaw(key: string): string | null {
    const name = encodeURIComponent(key);
    for (const part of document.cookie.split('; ')) {
      const separator = part.indexOf('=');
      if (separator > 0 && part.slice(0, separator) === name) {
        return decodeURIComponent(part.slice(separator + 1));
      }
    }
    return null;
  }

  protected override writeRaw(key: string, value: string): void {
    const cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=${String(this.maxAgeSeconds)}; SameSite=Lax`;
    if (cookie.length > MAX_COOKIE_LENGTH) {
      // Named like the browser's own quota error, so the vault turns it into
      // StorageQuotaError.
      throw new DOMException(
        `The cookie for "${key}" would be ${String(cookie.length)} characters; browsers keep at most ${String(MAX_COOKIE_LENGTH)}.`,
        'QuotaExceededError'
      );
    }
    document.cookie = cookie;
  }

  protected override removeRaw(key: string): void {
    document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export { CookieDriver };
export type { CookieDriverOptions };
```

`examples/cookie-driver/README.md` (prose): what the example shows (each contract rule visible in code, `namespace`, quota mapping, server fallback); the 4 KB limit and that cookies travel with every request; usage:

```ts
import { createVault, registerDriver } from '@dariushstony/smart-storage';
import { CookieDriver } from './cookie-driver';

registerDriver('cookie', () => new CookieDriver({ namespace: 'myapp' }));
export const consent = createVault({ key: 'CONSENT', driver: 'cookie' });
```

It also links to the test (`tests/unit/examples/cookie-driver.test.ts`) and to `docs/CUSTOM_STORAGE.md`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests && pnpm build && pnpm size`
Expected: all pass; main entry ≤ 5 kB.

- [ ] **Step 5: Commit**

```bash
git add -A src tests examples vitest.config.ts tsconfig.test.json
git commit -m "feat: export the extension API and add a worked cookie-driver example

registerDriver, unregisterDriver and BaseStorageDriver are public. The
cookie driver in examples/ is written only against the public API,
passes the conformance kit, and shows quota mapping and server fallback.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: E2E against the built bundle

**Files:**

- Modify: `tests/e2e/harness.html`, `tests/e2e/global.d.ts`, `tests/e2e/storage.e2e.ts`

- [ ] **Step 1: Write the failing specs**

`harness.html` module script: also `import * as smartStorageTesting from '/dist/testing.js';` and set `window.smartStorageTesting = smartStorageTesting;` before the ready flag.

`global.d.ts`: add `import type * as SmartStorageTesting from '../../src/testing/index.js';` and, on `Window`, `smartStorageTesting: typeof SmartStorageTesting;`.

`storage.e2e.ts`: add `'BaseStorageDriver'`, `'registerDriver'` and `'unregisterDriver'` to the export list. Then append:

```ts
test.describe('extension API in a real browser', () => {
  test('real localStorage and sessionStorage honour the driver contract', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { WebStorageDriver } = window.smartStorage;
      const { verifyStorageDriver } = window.smartStorageTesting;
      const failures = (report: {
        checks: Array<{ rule: string; passed: boolean; error?: unknown }>;
      }): string[] =>
        report.checks
          .filter((check) => !check.passed)
          .map((check) => `${check.rule}: ${String(check.error)}`);

      const local = await verifyStorageDriver(
        () => new WebStorageDriver(localStorage, 'localStorage')
      );
      const session = await verifyStorageDriver(
        () => new WebStorageDriver(sessionStorage, 'sessionStorage')
      );
      return {
        local: failures(local),
        session: failures(session),
        leftover: localStorage.length + sessionStorage.length,
      };
    });

    expect(result).toEqual({ local: [], session: [], leftover: 0 });
  });

  test('a registered, namespaced driver works through the built bundle', async ({
    page,
  }) => {
    const raw = await page.evaluate(() => {
      const { WebStorageDriver, createVault, registerDriver } =
        window.smartStorage;
      registerDriver(
        'prefixed',
        () =>
          new WebStorageDriver(localStorage, 'prefixed', { namespace: 'app' })
      );
      createVault({ key: 'E2E_REGISTERED', driver: 'prefixed' }).set('a', 1);
      return localStorage.getItem('app:E2E_REGISTERED');
    });

    expect(JSON.parse(raw ?? 'null')).toEqual({
      v: 2,
      items: [{ key: 'a', value: 1 }],
    });
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm test:e2e`
Expected: all specs pass (15). These e2e specs run against code that already exists, so they verify behaviour rather than drive it.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e
git commit -m "test(e2e): run the conformance kit and a registered driver in Chromium

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Guide, docs, verification, PR

**Files:**

- Create: `docs/CUSTOM_STORAGE.md`, `docs/adr/0007-driver-registry.md`, `docs/adr/0008-conformance-kit-and-base-driver.md`
- Modify: `README.md` (Custom drivers section), `docs/ARCHITECTURE.md`, `docs/README.md`, `CONTRIBUTING.md` (structure tree), `examples/README.md`

- [ ] **Step 1: Write `docs/CUSTOM_STORAGE.md`**, following spec §3.7. Sections in order:
  1. When you need a driver, and when a codec is enough.
  2. The contract: the interface, plus the rules table with the rule ids exactly as the kit reports them (`sync`, `name`, `missing`, `roundtrip`, `empty`, `exact`, `large`, `overwrite`, `remove`, `remove-missing`, `independent`, `any-key`), followed by the two documented-only rules (quota error name; throw on failure).
  3. Implementing it three ways: a plain object, a class implementing `StorageDriver`, and `extends BaseStorageDriver` with `namespace`.
  4. Errors.
  5. Verifying it with the kit, with Vitest and Jest snippets and the `largeValueLength` note.
  6. Registering it: `registerDriver`, `shared`, a throwing factory meaning "unavailable", silent server fallback, hot module reloading, `unregisterDriver`, and built-in names being reserved.
  7. Using it: by name, or by passing an instance.
  8. A pre-publish checklist.
  9. A link to `examples/cookie-driver`.

  Every code sample must use only the exported API.

- [ ] **Step 2: Update the other docs**
  - README "Custom drivers": a 10-line `BaseStorageDriver` example plus `registerDriver`, then links to the guide and the kit.
  - ARCHITECTURE: add the registry, base class, `SnapshotStore` / `SnapshotFormat` and `src/testing` to the units table, and state the dependency rule for `testing` (it imports only driver types).
  - `docs/README.md`: add CUSTOM_STORAGE and the two ADRs.
  - CONTRIBUTING tree: `drivers/driver-registry.ts`, `drivers/base-storage-driver.ts`, `persistence/snapshot-store.ts`, `testing/`, and `examples/cookie-driver/`.
  - `examples/README.md`: list the cookie driver.
  - The ADRs follow the existing format (Status / Context / Decision / Consequences):
    - **0007:** the registry replaces the switch; shared instances; a throwing factory means "unavailable"; built-ins are reserved; re-registration replaces.
    - **0008:** the contract is specified as rules; the kit is the LSP gate; the base class is a Template Method with namespacing; a separate `/testing` entry keeps test code out of app bundles.

- [ ] **Step 3: Verify**

Run each and read its output:

```bash
pnpm check && pnpm test:coverage && pnpm test:e2e && pnpm size:check && pnpm typecheck:dist
grep -rn "resolve-driver\|resetSharedDrivers" src tests docs README.md CONTRIBUTING.md | grep -v docs/superpowers
```

Expected: every command exits 0, and the grep prints nothing.

- [ ] **Step 4: Commit, push, PR**

```bash
git add -A README.md docs CONTRIBUTING.md examples
git commit -m "docs: add the custom storage guide, ADRs 0007-0008, and update architecture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/storage-extension-api
gh pr create --base fix/v2-minor-findings --head feat/storage-extension-api \
  --title "feat: storage extension API (driver registry, base class, conformance kit)" \
  --body-file "$SCRATCHPAD/pr2-body.md"
```

The PR body follows the template and links the spec and plan. Do not merge.
