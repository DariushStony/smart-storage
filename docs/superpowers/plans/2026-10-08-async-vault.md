# Async Vault and IndexedDB Implementation Plan (PR 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `createAsyncVault()` with the same semantics as the sync vault, async drivers and codecs, a built-in IndexedDB driver, and async conformance checks. Everything is exported from the main entry, and it tree-shakes away for sync-only users.

**Architecture:**

- **Shared decisions.** Each vault operation's decision becomes a pure `Operation` in `vault/operations.ts`, used by both facades.
- **Async I/O.** The async side mirrors the persistence layer: a repository, a serializer, write strategies, and an `OperationQueue` that serializes calls.
- **Registries.** The name registry gains driver kinds. The vault registry becomes one shared instance whose `claim` returns the previous owner's retirement.
- **IndexedDB.** `'indexeddb'` is resolved inside the async module, so sync bundles never include it.

**Tech Stack:** TypeScript 7, tsup, Vitest 4 + happy-dom + fake-indexeddb, Playwright, size-limit.

**Spec:** `docs/superpowers/specs/2026-10-08-async-vault-design.md`

**Convention:** a code block whose info string is `ts file=<path>` holds the complete file.

## Global Constraints

- Additive only; all existing tests stay green without changes, except where a task says otherwise.
- Async methods never throw synchronously: they reject. `createAsyncVault` validates options synchronously and throws, like `createVault`.
- Error policy is unchanged: an error is either thrown/rejected or reported, never both.
- Importing only `createVault` must stay ≤ 5 KB; the full package must stay ≤ 10 KB.
- The `/testing` bundle never imports the error classes.
- Branch `feat/async-vault`, PR base `feat/storage-extension-api` (#24). Never push to `main`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Many concurrent calls (`Promise.all` of 50 `set`s) must lose nothing and keep their order. Covered in Task 7.
2. A newer async vault on a key must wait for the retired vault's pending flush before its first read. Covered in Task 7.
3. Passing an async driver instance to `createVault` must give a clear `StorageArgumentError`, not stored `[object Promise]` text. Covered in Task 3.
4. Without `indexedDB` in a browser, the vault must fall back to memory and report it; on the server it must do so silently. Covered in Task 7.
5. An existing IndexedDB database that lacks the configured store must be upgraded, not fail. Covered in Task 6.

---

### Task 1: Pure vault operations (shared by both vaults)

**Files:**

- Create: `src/vault/operations.ts`, `tests/unit/vault/operations.test.ts`
- Modify: `src/vault/default-vault.ts` (use operations; behaviour unchanged)

**Interfaces:**

- Produces: `type Operation<R> = (snapshot, now) => Outcome<R>`, `interface Outcome<R> { result: R; next?: Snapshot }`, and the builders `getOp`, `hasOp`, `ttlOp`, `keysOp`, `toObjectOp`, `setOp`, `updateOp`, `extendOp`, `removeOp`, `purgeExpiredOp`. Each builder validates its arguments before returning.

- [ ] **Step 1: Write the failing test**

```ts file=tests/unit/vault/operations.test.ts
import { describe, expect, it } from 'vitest';

import type { Entry } from '../../../src/core/entry.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { StorageArgumentError } from '../../../src/errors.js';
import {
  extendOp,
  getOp,
  hasOp,
  keysOp,
  purgeExpiredOp,
  removeOp,
  setOp,
  toObjectOp,
  ttlOp,
  updateOp,
} from '../../../src/vault/operations.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

const snapshot = Snapshot.empty
  .with('a', entry(1))
  .with('t', entry(2, 1500))
  .with('old', entry(3, 500));

describe('building an operation', () => {
  it('validates the arguments before any snapshot is involved', () => {
    expect(() => getOp('')).toThrow(StorageArgumentError);
    expect(() => setOp('k', undefined)).toThrow(StorageArgumentError);
    expect(() => setOp('k', 1, { ttl: 0 })).toThrow(StorageArgumentError);
    expect(() => setOp('k', 1, null as unknown as { ttl?: number })).toThrow(
      StorageArgumentError
    );
    expect(() => updateOp('k', undefined)).toThrow(StorageArgumentError);
    expect(() => extendOp('k', -1)).toThrow(StorageArgumentError);
    expect(() => removeOp(' ')).toThrow(StorageArgumentError);
  });
});

describe('queries', () => {
  it('return results and never a next snapshot', () => {
    expect(getOp('a')(snapshot, 1000)).toEqual({ result: 1 });
    expect(hasOp('old')(snapshot, 1000)).toEqual({ result: false });
    expect(ttlOp('t')(snapshot, 1000)).toEqual({ result: 500 });
    expect(ttlOp('a')(snapshot, 1000)).toEqual({ result: Infinity });
    expect(keysOp()(snapshot, 1000)).toEqual({ result: ['a', 't'] });
    expect(toObjectOp()(snapshot, 1000)).toEqual({ result: { a: 1, t: 2 } });
  });
});

describe('writes', () => {
  it('setOp stores the value with an absolute expiry', () => {
    const { next } = setOp('k', 'v', { ttl: 100 })(Snapshot.empty, 1000);
    expect(next?.get('k', 1000)).toEqual({ json: '"v"', expiresAt: 1100 });
  });

  it('updateOp keeps the expiry and reports a missing key', () => {
    expect(updateOp('t', 9)(snapshot, 1000).next?.get('t', 1000)).toEqual(
      entry(9, 1500)
    );
    expect(updateOp('missing', 9)(snapshot, 1000)).toEqual({ result: false });
  });

  it('extendOp leaves a non-expiring entry alone without a next snapshot', () => {
    expect(extendOp('a', 100)(snapshot, 1000)).toEqual({ result: true });
    expect(extendOp('t', 100)(snapshot, 1000).next?.get('t', 1000)).toEqual(
      entry(2, 1600)
    );
  });

  it('removeOp and purgeExpiredOp produce a next snapshot only on change', () => {
    expect(removeOp('missing')(snapshot, 1000)).toEqual({ result: false });
    expect(removeOp('a')(snapshot, 1000).next?.get('a', 1000)).toBeUndefined();
    expect(purgeExpiredOp()(snapshot, 1000).result).toBe(1);
    expect(purgeExpiredOp()(Snapshot.empty, 1000)).toEqual({ result: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/vault/operations.test.ts`. Expected: FAIL, because the module does not exist yet.

- [ ] **Step 3: Implement**

```ts file=src/vault/operations.ts
import { expiryAfter, remainingTtl, toJson } from '../core/entry.js';
import type { Entry } from '../core/entry.js';
import type { Snapshot } from '../core/snapshot.js';
import { assertKey, assertPositive } from '../core/validation.js';
import { StorageArgumentError } from '../errors.js';
import type { SetOptions } from './vault.js';

/** What an operation decided: its result, and the snapshot to commit if it changed anything. */
interface Outcome<R> {
  result: R;
  next?: Snapshot;
}

/**
 * One vault operation, already validated, waiting for the current snapshot.
 * Applying it does no I/O, so the sync and async vaults share every
 * decision and differ only in how they load and save.
 */
type Operation<R> = (snapshot: Snapshot, now: number) => Outcome<R>;

function getOp<T>(key: string): Operation<T | null> {
  assertKey(key);
  return (snapshot, now) => {
    const entry = snapshot.get(key, now);
    return { result: entry ? (JSON.parse(entry.json) as T) : null };
  };
}

function hasOp(key: string): Operation<boolean> {
  assertKey(key);
  return (snapshot, now) => ({ result: snapshot.get(key, now) !== undefined });
}

function ttlOp(key: string): Operation<number | null> {
  assertKey(key);
  return (snapshot, now) => {
    const entry = snapshot.get(key, now);
    return { result: entry ? remainingTtl(entry, now) : null };
  };
}

function keysOp(): Operation<string[]> {
  return (snapshot, now) => ({
    result: snapshot.live(now).map(([key]) => key),
  });
}

function toObjectOp(): Operation<Record<string, unknown>> {
  return (snapshot, now) => ({
    result: Object.fromEntries(
      snapshot
        .live(now)
        .map(([key, entry]) => [key, JSON.parse(entry.json) as unknown])
    ),
  });
}

function setOp(
  key: string,
  value: unknown,
  options: SetOptions = {}
): Operation<void> {
  assertKey(key);
  if (typeof (options as unknown) !== 'object' || options === null) {
    throw new StorageArgumentError('set() options must be an object.');
  }
  const { ttl } = options;
  if (ttl !== undefined) assertPositive('ttl', ttl);
  const json = toJson(value);

  return (snapshot, now) => ({
    result: undefined,
    next: snapshot.with(key, {
      json,
      expiresAt: ttl === undefined ? null : expiryAfter(now, ttl),
    }),
  });
}

function updateOp(key: string, value: unknown): Operation<boolean> {
  const json = toJson(value);
  return rewriteOp(key, (entry) => ({ json, expiresAt: entry.expiresAt }));
}

function extendOp(key: string, ms: number): Operation<boolean> {
  assertPositive('ms', ms);
  return rewriteOp(key, (entry) =>
    entry.expiresAt === null
      ? entry
      : { json: entry.json, expiresAt: expiryAfter(entry.expiresAt, ms) }
  );
}

function removeOp(key: string): Operation<boolean> {
  assertKey(key);
  return (snapshot, now) =>
    snapshot.get(key, now)
      ? { result: true, next: snapshot.without(key) }
      : { result: false };
}

function purgeExpiredOp(): Operation<number> {
  return (snapshot, now) => {
    const purged = snapshot.withoutExpired(now);
    return purged === snapshot
      ? { result: 0 }
      : { result: snapshot.size - purged.size, next: purged };
  };
}

function rewriteOp(
  key: string,
  change: (entry: Entry) => Entry
): Operation<boolean> {
  assertKey(key);
  return (snapshot, now) => {
    const entry = snapshot.get(key, now);
    if (!entry) return { result: false };
    const next = change(entry);
    return next === entry
      ? { result: true }
      : { result: true, next: snapshot.with(key, next) };
  };
}

export {
  getOp,
  hasOp,
  ttlOp,
  keysOp,
  toObjectOp,
  setOp,
  updateOp,
  extendOp,
  removeOp,
  purgeExpiredOp,
};
export type { Operation, Outcome };
```

Refactor `src/vault/default-vault.ts` so every key/value method goes through one `run` helper. Delete `find`, `liveEntries` and `rewrite`. Keep `clear`, `flush`, `stats`, `dispose`, `retire`, `current`, `commit` and `assertUsable` as they are, except that `stats` now uses `snapshot.live(now).length`.

```ts
  get<T>(key: string): T | null {
    return this.run(() => getOp<T>(key));
  }

  set<T>(key: string, value: T, options?: SetOptions): void {
    this.run(() => setOp(key, value, options));
  }

  has(key: string): boolean {
    return this.run(() => hasOp(key));
  }

  update<T>(key: string, value: T): boolean {
    return this.run(() => updateOp(key, value));
  }

  extend(key: string, ms: number): boolean {
    return this.run(() => extendOp(key, ms));
  }

  ttl(key: string): number | null {
    return this.run(() => ttlOp(key));
  }

  remove(key: string): boolean {
    return this.run(() => removeOp(key));
  }

  keys(): string[] {
    return this.run(keysOp);
  }

  toObject(): Record<string, unknown> {
    return this.run(toObjectOp);
  }

  purgeExpired(): number {
    return this.run(purgeExpiredOp);
  }

  /** Checks usability, builds (and so validates) the operation, then applies it. */
  private run<R>(build: () => Operation<R>): R {
    this.assertUsable();
    const operation = build();
    const now = Date.now();
    const { result, next } = operation(this.current(), now);
    if (next) this.commit(next, now);
    return result;
  }
```

Remove the imports that are no longer used: `expiryAfter`, `remainingTtl`, `toJson`, `Entry`, `assertKey`, `assertPositive`, `StorageArgumentError`. Add `import { … } from './operations.js'` and `import type { Operation } from './operations.js'`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests`. Expected: all green, and the sync vault suite is unchanged.

- [ ] **Step 5: Commit** with message `refactor(vault): move each operation's decision into shared pure functions`.

---

### Task 2: The async driver contract (interface, base class, memory driver, kit)

**Files:**

- Create: `src/drivers/async-storage-driver.ts`, `src/drivers/base-async-storage-driver.ts`, `src/drivers/async-memory-driver.ts`, `src/core/thenable.ts`, `tests/unit/drivers/async-drivers.test.ts`, `tests/unit/testing/async-conformance.test.ts`
- Modify: `src/drivers/base-storage-driver.ts` (extract `namespacePrefix`), `src/testing/conformance.ts` (`ASYNC_CHECK`, shared `isThenable`), `src/testing/index.ts`, `vitest.config.ts` (exclude the type-only file)

**Interfaces:**

- Produces:
  - `interface AsyncStorageDriver { name; read(): Promise<string|null>; write(): Promise<void>; remove(): Promise<void> }`
  - `abstract class BaseAsyncStorageDriver`, with protected async raw methods and an optional `namespace`
  - `type BaseAsyncStorageDriverOptions = BaseStorageDriverOptions`
  - `class AsyncMemoryDriver`, named `'memory'`
  - `namespacePrefix(namespace?: string): string`
  - `isThenable(value): value is PromiseLike<unknown>`
  - In `/testing`: `verifyAsyncStorageDriver(create, options?)` and `assertAsyncStorageDriver(create, options?)`

- [ ] **Step 1: Write the failing tests**

```ts file=tests/unit/drivers/async-drivers.test.ts
import { describe, expect, it } from 'vitest';

import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { BaseAsyncStorageDriver } from '../../../src/drivers/base-async-storage-driver.js';
import { StorageArgumentError } from '../../../src/errors.js';

class RecordingAsyncDriver extends BaseAsyncStorageDriver {
  override readonly name = 'recording';
  readonly data = new Map<string, string>();

  protected override readRaw(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  protected override writeRaw(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  // Throws synchronously on purpose: the base must still reject.
  protected override removeRaw(): Promise<void> {
    throw new Error('remove failed');
  }
}

describe('BaseAsyncStorageDriver', () => {
  it('prefixes keys with the namespace', async () => {
    const driver = new RecordingAsyncDriver({ namespace: 'app' });

    await driver.write('k', 'v');

    expect([...driver.data.keys()]).toEqual(['app:k']);
    expect(await driver.read('k')).toBe('v');
  });

  it('turns a synchronous throw in a raw method into a rejection', () => {
    const driver = new RecordingAsyncDriver();
    let result: Promise<void> | undefined;

    expect(() => {
      result = driver.remove('k');
    }).not.toThrow();
    return expect(result).rejects.toThrow('remove failed');
  });

  it('validates the namespace like the sync base class', () => {
    expect(() => new RecordingAsyncDriver({ namespace: 'a:b' })).toThrow(
      StorageArgumentError
    );
  });
});

describe('AsyncMemoryDriver', () => {
  it('round-trips through promises and keeps instances separate', async () => {
    const a = new AsyncMemoryDriver();
    await a.write('k', 'v');

    expect(a.name).toBe('memory');
    expect(await a.read('k')).toBe('v');
    expect(await new AsyncMemoryDriver().read('k')).toBeNull();
    await a.remove('k');
    expect(await a.read('k')).toBeNull();
  });
});
```

```ts file=tests/unit/testing/async-conformance.test.ts
import { describe, expect, it } from 'vitest';

import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import type { AsyncStorageDriver } from '../../../src/drivers/async-storage-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  assertAsyncStorageDriver,
  verifyAsyncStorageDriver,
} from '../../../src/testing/index.js';

describe('verifyAsyncStorageDriver', () => {
  it('passes the reference async driver, with and without a namespace', async () => {
    await assertAsyncStorageDriver(() => new AsyncMemoryDriver());
    await assertAsyncStorageDriver(
      () => new AsyncMemoryDriver({ namespace: 'ns' })
    );
  });

  it('checks [async] first, then the shared contract', async () => {
    const report = await verifyAsyncStorageDriver(
      () => new AsyncMemoryDriver()
    );

    expect(report.checks[0]?.rule).toBe('async');
    expect(report.checks).toHaveLength(12);
  });

  it('fails [async] for a sync driver', async () => {
    const report = await verifyAsyncStorageDriver(
      () => new MemoryDriver() as unknown as AsyncStorageDriver
    );

    expect(report.checks.find((check) => check.rule === 'async')?.passed).toBe(
      false
    );
  });

  it('detects a broken async driver', async () => {
    const report = await verifyAsyncStorageDriver(() => {
      const data = new Map<string, string>();
      return {
        name: 'broken',
        read: (key: string) => Promise.resolve(data.get(key) ?? null),
        write: (key: string, value: string) => {
          data.set(key, value.trim());
          return Promise.resolve();
        },
        remove: (key: string) => {
          data.delete(key);
          return Promise.resolve();
        },
      };
    });

    expect(report.checks.find((check) => check.rule === 'exact')?.passed).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/drivers/async-drivers.test.ts tests/unit/testing/async-conformance.test.ts`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

```ts file=src/core/thenable.ts
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export { isThenable };
```

```ts file=src/drivers/async-storage-driver.ts
/**
 * The async port: the StorageDriver contract (docs/CUSTOM_STORAGE.md), except
 * every method returns a Promise and failures reject. createAsyncVault
 * accepts these as well as sync drivers.
 */
interface AsyncStorageDriver {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type { AsyncStorageDriver };
```

In `src/drivers/base-storage-driver.ts`, extract the namespace logic into an exported function, and have the constructor use it:

```ts
/** Validates a namespace and returns the key prefix it stands for. */
function namespacePrefix(namespace: string | undefined): string {
  if (namespace === undefined) return '';
  assertKey(namespace, 'namespace');
  if (namespace.includes(':')) {
    throw new StorageArgumentError(
      'namespace must not contain ":"; "app" with key "x:y" and "app:x" with key "y" would collide.'
    );
  }
  return `${namespace}:`;
}
```

The constructor body becomes `this.#prefix = namespacePrefix(options.namespace);`, and the export line becomes `export { BaseStorageDriver, namespacePrefix };`.

```ts file=src/drivers/base-async-storage-driver.ts
import type { AsyncStorageDriver } from './async-storage-driver.js';
import { namespacePrefix } from './base-storage-driver.js';
import type { BaseStorageDriverOptions } from './base-storage-driver.js';

type BaseAsyncStorageDriverOptions = BaseStorageDriverOptions;

/**
 * The async counterpart of BaseStorageDriver (Template Method): implement
 * the three raw methods. The public methods add the namespace, and are
 * async so even a raw method that throws synchronously ends up rejecting.
 */
abstract class BaseAsyncStorageDriver implements AsyncStorageDriver {
  abstract readonly name: string;
  readonly #prefix: string;

  constructor(options: BaseAsyncStorageDriverOptions = {}) {
    this.#prefix = namespacePrefix(options.namespace);
  }

  async read(key: string): Promise<string | null> {
    return this.readRaw(this.#prefix + key);
  }

  async write(key: string, value: string): Promise<void> {
    return this.writeRaw(this.#prefix + key, value);
  }

  async remove(key: string): Promise<void> {
    return this.removeRaw(this.#prefix + key);
  }

  /** Resolve with the stored string, or null when there is none. */
  protected abstract readRaw(key: string): Promise<string | null>;
  /** Store the string. Reject with an error named 'QuotaExceededError' when full. */
  protected abstract writeRaw(key: string, value: string): Promise<void>;
  /** Delete the key; resolve even if it was not there. */
  protected abstract removeRaw(key: string): Promise<void>;
}

export { BaseAsyncStorageDriver };
export type { BaseAsyncStorageDriverOptions };
```

```ts file=src/drivers/async-memory-driver.ts
import { BaseAsyncStorageDriver } from './base-async-storage-driver.js';

/** The reference async driver: a Map behind promises. Handy in tests. */
class AsyncMemoryDriver extends BaseAsyncStorageDriver {
  override readonly name: string = 'memory';
  private readonly data = new Map<string, string>();

  protected override readRaw(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  protected override writeRaw(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  protected override removeRaw(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

export { AsyncMemoryDriver };
```

In `src/testing/conformance.ts`:

- Delete its local `isThenable` and import it from `'../core/thenable.js'`.
- Add the `ASYNC_CHECK` below, and export it next to `SYNC_CHECK`.

```ts
const ASYNC_CHECK: Check = {
  rule: 'async',
  description: 'read, write and remove return Promises',
  run: async (driver, keys) => {
    const key = keys.key(`${P}async`);
    const calls: Array<[string, () => unknown]> = [
      ['write', () => driver.write(key, 'value')],
      ['read', () => driver.read(key)],
      ['remove', () => driver.remove(key)],
    ];
    for (const [method, call] of calls) {
      const result = call();
      if (!isThenable(result)) {
        throw new ContractViolation(
          `${method} returned ${show(result)}; an async driver must return a Promise.`
        );
      }
      await result;
    }
  },
};
```

In `src/testing/index.ts`, add:

```ts
/** Runs every contract check against async drivers from `create`. */
function verifyAsyncStorageDriver(
  create: () => AsyncStorageDriver,
  options?: VerifyOptions
): Promise<ConformanceReport> {
  return runConformance(create, ASYNC_CHECK, options);
}

/** Like verifyAsyncStorageDriver, but throws an Error listing every broken rule. */
async function assertAsyncStorageDriver(
  create: () => AsyncStorageDriver,
  options?: VerifyOptions
): Promise<void> {
  const report = await verifyAsyncStorageDriver(create, options);
  if (!report.passed) throw new Error(formatFailures(report));
}
```

Export both functions. Import `ASYNC_CHECK` and the `AsyncStorageDriver` type.

In `vitest.config.ts`, add `'src/drivers/async-storage-driver.ts'` to the coverage `exclude` list.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests`. Expected: green. In `public-api.test.ts`, the testing-entry key list now needs the two async names; update that test's expectation in this task.

- [ ] **Step 5: Commit** with message `feat(drivers): add the async driver contract, base class and conformance checks`.

---

### Task 3: Async codecs, shared store policy, async serializer and repository

**Files:**

- Create: `src/codec/async-codec.ts`, `src/persistence/store-policy.ts`, `src/persistence/async-snapshot-serializer.ts`, `src/persistence/async-snapshot-repository.ts`, `tests/unit/codec/async-codec.test.ts`, `tests/unit/persistence/async-snapshot-repository.test.ts`
- Modify: `src/persistence/snapshot-store.ts` (async interfaces), `src/persistence/snapshot-repository.ts` (use the policy, and guard against async drivers), `tests/unit/persistence/snapshot-repository.test.ts` (guard test)

**Interfaces:**

- Produces:
  - `AsyncCodec`, `ComposedAsyncCodec`, `composeAsyncCodecs(codecs)`
  - The policy helpers `assertFits(key, bytes, storedBytes, maxBytes)`, `writeFailure(key, bytes, error)`, `accessFailure(action, key, error)`, `unreadable(key, error)`, `skipped(key, dropped)`
  - `AsyncSnapshotFormat`, `AsyncSnapshotStore`
  - `AsyncSnapshotSerializer(codec)`
  - `AsyncSnapshotRepository({ driver, key, serializer, maxBytes, report })`
  - `type AnyStorageDriver = StorageDriver | AsyncStorageDriver`

- [ ] **Step 1: Write the failing tests**

```ts file=tests/unit/codec/async-codec.test.ts
import { describe, expect, it } from 'vitest';

import { composeAsyncCodecs } from '../../../src/codec/async-codec.js';
import type { AsyncCodec } from '../../../src/codec/async-codec.js';

const tag = (name: string): AsyncCodec => ({
  encode: async (text) => {
    await Promise.resolve();
    return `${name}(${text})`;
  },
  decode: (text) => text.slice(name.length + 1, -1),
});

describe('composeAsyncCodecs', () => {
  it('is the identity with no codecs', async () => {
    const codec = composeAsyncCodecs([]);
    expect(await codec.encode('x')).toBe('x');
    expect(await codec.decode('x')).toBe('x');
  });

  it('encodes left to right and decodes right to left, awaiting each step', async () => {
    const codec = composeAsyncCodecs([tag('a'), tag('b')]);

    expect(await codec.encode('x')).toBe('b(a(x))');
    expect(await codec.decode('b(a(x))')).toBe('x');
  });

  it('accepts plain sync codecs', async () => {
    const codec = composeAsyncCodecs([
      {
        encode: (text) => text.toUpperCase(),
        decode: (text) => text.toLowerCase(),
      },
    ]);
    expect(await codec.decode(await codec.encode('x'))).toBe('x');
  });
});
```

```ts file=tests/unit/persistence/async-snapshot-repository.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { composeAsyncCodecs } from '../../../src/codec/async-codec.js';
import type { AsyncCodec } from '../../../src/codec/async-codec.js';
import { utf8ByteLength } from '../../../src/core/byte-size.js';
import type { Entry } from '../../../src/core/entry.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  StorageAccessError,
  StorageCorruptionError,
  StorageQuotaError,
  StorageSerializationError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { AsyncSnapshotRepository } from '../../../src/persistence/async-snapshot-repository.js';
import { AsyncSnapshotSerializer } from '../../../src/persistence/async-snapshot-serializer.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

interface Setup {
  driver: AsyncMemoryDriver;
  report: Mock<(error: StorageError) => void>;
  repository: AsyncSnapshotRepository;
}

function setup(
  options: { maxBytes?: number; codecs?: AsyncCodec[] } = {}
): Setup {
  const driver = new AsyncMemoryDriver();
  const report = vi.fn<(error: StorageError) => void>();
  const repository = new AsyncSnapshotRepository({
    driver,
    key: 'K',
    serializer: new AsyncSnapshotSerializer(
      composeAsyncCodecs(options.codecs ?? [])
    ),
    maxBytes: options.maxBytes ?? 1_000_000,
    report,
  });
  return { driver, report, repository };
}

describe('AsyncSnapshotRepository', () => {
  it('saves and loads, caching while the stored text is unchanged', async () => {
    const { repository, driver } = setup();
    const snapshot = Snapshot.empty.with('a', entry(1));

    await repository.save(snapshot);

    expect(await driver.read('K')).toBe(encodeEnvelope(snapshot));
    expect(await repository.load()).toBe(snapshot);
  });

  it('sees text written by someone else', async () => {
    const { repository, driver } = setup();
    await driver.write('K', encodeEnvelope(Snapshot.empty.with('b', entry(2))));

    expect((await repository.load()).get('b', 0)).toEqual(entry(2));
  });

  it('reads 1.x data', async () => {
    const { repository, driver } = setup();
    await driver.write(
      'K',
      JSON.stringify({ theme: { value: 'dark', expiry: null } })
    );

    expect((await repository.load()).get('theme', 0)).toEqual(entry('dark'));
  });

  it('reports unreadable text once and leaves it in place', async () => {
    const { repository, driver, report } = setup();
    await driver.write('K', 'not json');

    expect((await repository.load()).size).toBe(0);
    await repository.load();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(StorageCorruptionError));
    expect(await driver.read('K')).toBe('not json');
  });

  it('rejects data over maxBytes, but lets over-limit data shrink', async () => {
    const { repository, driver } = setup({ maxBytes: 80 });
    const big = Snapshot.empty.with('big', entry('x'.repeat(100)));
    await expect(repository.save(big)).rejects.toThrow(StorageQuotaError);

    await driver.write('K', encodeEnvelope(big.with('more', entry(1))));
    await repository.load();
    await expect(repository.save(big)).resolves.toBeUndefined();
  });

  it('maps a quota rejection to StorageQuotaError and keeps the previous state', async () => {
    const { repository, driver } = setup();
    const first = Snapshot.empty.with('a', entry(1));
    await repository.save(first);
    vi.spyOn(driver, 'write').mockRejectedValue(
      new DOMException('full', 'QuotaExceededError')
    );

    const failure = repository.save(first.with('b', entry(2)));

    await expect(failure).rejects.toThrow(StorageQuotaError);
    await expect(failure).rejects.toMatchObject({
      bytes: utf8ByteLength(encodeEnvelope(first.with('b', entry(2)))),
    });
    expect((await repository.load()).get('b', 0)).toBeUndefined();
  });

  it('wraps other driver failures as StorageAccessError', async () => {
    const { repository, driver } = setup();
    vi.spyOn(driver, 'read').mockRejectedValue(new Error('denied'));

    await expect(repository.load()).rejects.toThrow(StorageAccessError);
  });

  it('wraps an async codec failure as StorageSerializationError', async () => {
    const { repository } = setup({
      codecs: [
        { encode: () => Promise.reject(new Error('no key')), decode: (t) => t },
      ],
    });

    await expect(repository.save(Snapshot.empty)).rejects.toThrow(
      StorageSerializationError
    );
  });

  it('works over a sync driver too', async () => {
    const driver = new MemoryDriver();
    const repository = new AsyncSnapshotRepository({
      driver,
      key: 'K',
      serializer: new AsyncSnapshotSerializer(composeAsyncCodecs([])),
      maxBytes: 1000,
      report: vi.fn(),
    });

    await repository.save(Snapshot.empty.with('a', entry(1)));

    expect(driver.read('K')).not.toBeNull();
    expect(await repository.measure(Snapshot.empty)).toBe(
      utf8ByteLength(encodeEnvelope(Snapshot.empty))
    );
    await repository.remove();
    expect(driver.read('K')).toBeNull();
    expect(repository.storedBytes()).toBe(0);
  });
});
```

Append to `tests/unit/persistence/snapshot-repository.test.ts`. It also needs these imports: `StorageArgumentError` from errors, and `AsyncMemoryDriver` from `'../../../src/drivers/async-memory-driver.js'`.

```ts
describe('SnapshotRepository with an async driver', () => {
  it('refuses it with StorageArgumentError instead of storing a Promise', () => {
    const repository = new SnapshotRepository({
      driver: new AsyncMemoryDriver() as unknown as MemoryDriver,
      key: 'K',
      serializer: new SnapshotSerializer(composeCodecs([])),
      maxBytes: 1000,
      report: vi.fn(),
    });

    expect(() => repository.load()).toThrow(StorageArgumentError);
    expect(() => repository.load()).toThrow(/createAsyncVault/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/codec tests/unit/persistence`. Expected: FAIL, because the modules are missing and the guard does not exist yet.

- [ ] **Step 3: Implement**

```ts file=src/codec/async-codec.ts
/**
 * A codec whose steps may be asynchronous, such as Web Crypto encryption.
 * Every Codec is also an AsyncCodec. Used by createAsyncVault.
 */
interface AsyncCodec {
  /** Runs on write, after JSON serialization. */
  encode(text: string): string | Promise<string>;
  /** Runs on read, before JSON parsing. Must invert `encode`. */
  decode(text: string): string | Promise<string>;
}

interface ComposedAsyncCodec {
  encode(text: string): Promise<string>;
  decode(text: string): Promise<string>;
}

/** Encodes left to right and decodes right to left, awaiting each step. */
function composeAsyncCodecs(codecs: readonly AsyncCodec[]): ComposedAsyncCodec {
  const reversed = [...codecs].reverse();
  return {
    encode: async (text) => {
      let result = text;
      for (const codec of codecs) result = await codec.encode(result);
      return result;
    },
    decode: async (text) => {
      let result = text;
      for (const codec of reversed) result = await codec.decode(result);
      return result;
    },
  };
}

export { composeAsyncCodecs };
export type { AsyncCodec, ComposedAsyncCodec };
```

```ts file=src/persistence/store-policy.ts
import {
  StorageAccessError,
  StorageCorruptionError,
  StorageQuotaError,
} from '../errors.js';
import type { StorageError } from '../errors.js';

// Rules both repositories (sync and async) apply, so they cannot drift apart.

/** Throws when `bytes` is over `maxBytes` and would grow what is already stored. */
function assertFits(
  key: string,
  bytes: number,
  storedBytes: number,
  maxBytes: number
): void {
  // Stored data may already be over the limit (written by 1.x, or under a
  // higher limit). Writes that do not grow it must pass, or it could never
  // be shrunk.
  if (bytes > maxBytes && bytes > storedBytes) {
    throw new StorageQuotaError(
      `"${key}" would be ${String(bytes)} bytes, over its ${String(maxBytes)}-byte limit.`,
      { bytes, maxBytes }
    );
  }
}

function writeFailure(
  key: string,
  bytes: number,
  error: unknown
): StorageError {
  if (isQuotaError(error)) {
    return new StorageQuotaError(
      `The browser's storage quota is full; "${key}" was not saved.`,
      { cause: error, bytes }
    );
  }
  return new StorageAccessError(`Writing "${key}" failed.`, { cause: error });
}

function accessFailure(
  action: 'Reading' | 'Removing',
  key: string,
  error: unknown
): StorageAccessError {
  return new StorageAccessError(`${action} "${key}" failed.`, { cause: error });
}

function unreadable(key: string, error: unknown): StorageCorruptionError {
  return new StorageCorruptionError(
    `Stored data for "${key}" is unreadable and was ignored; the next write replaces it.`,
    { cause: error }
  );
}

function skipped(key: string, dropped: number): StorageCorruptionError {
  return new StorageCorruptionError(
    `Skipped ${String(dropped)} unreadable item(s) in "${key}".`
  );
}

// Duck-typed: DOMException may not exist on the server, and browsers differ
// in name and legacy code (22 in most, 1014 in old Firefox).
function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

export { assertFits, writeFailure, accessFailure, unreadable, skipped };
```

Refactor `src/persistence/snapshot-repository.ts` to use these helpers:

- In `save`, call `assertFits(this.key, bytes, this.storedBytes(), this.maxBytes)`, and in the catch `throw writeFailure(this.key, bytes, error)`.
- In `remove`, throw `accessFailure('Removing', …)`.
- In `decode`, report `skipped(…)` and `unreadable(…)`.
- Delete the local `isQuotaError`.

Then add the async guard to `readRaw`:

```ts
  private readRaw(): string | null {
    let raw: string | null;
    try {
      raw = this.driver.read(this.key);
    } catch (error) {
      throw accessFailure('Reading', this.key, error);
    }
    if (isThenable(raw)) {
      // Settle it so it cannot surface as an unhandled rejection.
      raw.then(undefined, () => undefined);
      throw new StorageArgumentError(
        `The "${this.driver.name}" driver is asynchronous; use createAsyncVault() with it.`
      );
    }
    return raw;
  }
```

Add to `src/persistence/snapshot-store.ts`:

```ts
/** Async counterpart of SnapshotFormat (codecs may be asynchronous). */
interface AsyncSnapshotFormat {
  serialize(snapshot: Snapshot): Promise<string>;
  /** Rejects when the text cannot be read; callers treat that as corruption. */
  deserialize(text: string): Promise<DecodedEnvelope>;
}

/** Async counterpart of SnapshotStore. */
interface AsyncSnapshotStore {
  readonly key: string;
  readonly driverName: string;
  load(): Promise<Snapshot>;
  save(snapshot: Snapshot): Promise<void>;
  remove(): Promise<void>;
  measure(snapshot: Snapshot): Promise<number>;
  storedBytes(): number;
}
```

Export them alongside the existing types.

```ts file=src/persistence/async-snapshot-serializer.ts
import type { ComposedAsyncCodec } from '../codec/async-codec.js';
import { decodeEnvelope, encodeEnvelope } from '../core/envelope.js';
import type { DecodedEnvelope } from '../core/envelope.js';
import type { Snapshot } from '../core/snapshot.js';
import { StorageSerializationError } from '../errors.js';
import type { AsyncSnapshotFormat } from './snapshot-store.js';

/** Snapshot ↔ stored text with codecs that may be asynchronous. */
class AsyncSnapshotSerializer implements AsyncSnapshotFormat {
  constructor(private readonly codec: ComposedAsyncCodec) {}

  async serialize(snapshot: Snapshot): Promise<string> {
    const envelope = encodeEnvelope(snapshot);
    try {
      return await this.codec.encode(envelope);
    } catch (error) {
      throw new StorageSerializationError(
        'A codec failed to encode the stored data.',
        { cause: error }
      );
    }
  }

  async deserialize(text: string): Promise<DecodedEnvelope> {
    return decodeEnvelope(await this.codec.decode(text));
  }
}

export { AsyncSnapshotSerializer };
```

```ts file=src/persistence/async-snapshot-repository.ts
import { utf8ByteLength } from '../core/byte-size.js';
import { Snapshot } from '../core/snapshot.js';
import type { AsyncStorageDriver } from '../drivers/async-storage-driver.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import type { Reporter } from '../reporting/reporter.js';
import type {
  AsyncSnapshotFormat,
  AsyncSnapshotStore,
} from './snapshot-store.js';
import {
  accessFailure,
  assertFits,
  skipped,
  unreadable,
  writeFailure,
} from './store-policy.js';

type AnyStorageDriver = StorageDriver | AsyncStorageDriver;

interface AsyncRepositoryDeps {
  driver: AnyStorageDriver;
  key: string;
  serializer: AsyncSnapshotFormat;
  maxBytes: number;
  report: Reporter;
}

/**
 * The async counterpart of SnapshotRepository, with the same rules. It awaits
 * every driver call, so sync drivers work too. The vault's operation queue
 * guarantees calls never overlap.
 */
class AsyncSnapshotRepository implements AsyncSnapshotStore {
  readonly key: string;
  private readonly driver: AnyStorageDriver;
  private readonly serializer: AsyncSnapshotFormat;
  private readonly maxBytes: number;
  private readonly report: Reporter;
  private cachedRaw: string | null = null;
  private cached: Snapshot = Snapshot.empty;

  constructor(deps: AsyncRepositoryDeps) {
    this.key = deps.key;
    this.driver = deps.driver;
    this.serializer = deps.serializer;
    this.maxBytes = deps.maxBytes;
    this.report = deps.report;
  }

  get driverName(): string {
    return this.driver.name;
  }

  async load(): Promise<Snapshot> {
    const raw = await this.readRaw();
    if (raw === this.cachedRaw) return this.cached;

    const snapshot = raw === null ? Snapshot.empty : await this.decode(raw);
    this.cachedRaw = raw;
    this.cached = snapshot;
    return snapshot;
  }

  async save(snapshot: Snapshot): Promise<void> {
    const raw = await this.serializer.serialize(snapshot);
    const bytes = utf8ByteLength(raw);
    assertFits(this.key, bytes, this.storedBytes(), this.maxBytes);

    try {
      await this.driver.write(this.key, raw);
    } catch (error) {
      throw writeFailure(this.key, bytes, error);
    }

    this.cachedRaw = raw;
    this.cached = snapshot;
  }

  async remove(): Promise<void> {
    try {
      await this.driver.remove(this.key);
    } catch (error) {
      throw accessFailure('Removing', this.key, error);
    }
    this.cachedRaw = null;
    this.cached = Snapshot.empty;
  }

  async measure(snapshot: Snapshot): Promise<number> {
    return utf8ByteLength(await this.serializer.serialize(snapshot));
  }

  storedBytes(): number {
    return this.cachedRaw === null ? 0 : utf8ByteLength(this.cachedRaw);
  }

  private async readRaw(): Promise<string | null> {
    try {
      return await this.driver.read(this.key);
    } catch (error) {
      throw accessFailure('Reading', this.key, error);
    }
  }

  private async decode(raw: string): Promise<Snapshot> {
    try {
      const { snapshot, dropped } = await this.serializer.deserialize(raw);
      if (dropped > 0) this.report(skipped(this.key, dropped));
      return snapshot;
    } catch (error) {
      this.report(unreadable(this.key, error));
      return Snapshot.empty;
    }
  }
}

export { AsyncSnapshotRepository };
export type { AnyStorageDriver };
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests`. Expected: green.

- [ ] **Step 5: Commit** with message `feat(persistence): add async codecs, serializer and repository sharing one store policy`.

---

### Task 4: Operation queue and async write strategies

**Files:**

- Create: `src/vault/operation-queue.ts`, `src/persistence/async-write-strategy.ts`, `tests/unit/vault/operation-queue.test.ts`, `tests/unit/persistence/async-write-strategy.test.ts`

**Interfaces:**

- Produces:
  - `class OperationQueue { run<T>(task): Promise<T>; after(gate: Promise<unknown>): void }`
  - `interface TaskRunner { run<T>(task: () => T | Promise<T>): Promise<T> }`
  - `AsyncWriteStrategy`
  - `AsyncImmediateWriteStrategy(store)`
  - `AsyncDebouncedWriteStrategy({ store, delayMs, report, lifecycle, runner })`

- [ ] **Step 1: Write the failing tests**

```ts file=tests/unit/vault/operation-queue.test.ts
import { describe, expect, it } from 'vitest';

import { OperationQueue } from '../../../src/vault/operation-queue.js';

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('OperationQueue', () => {
  it('runs tasks one at a time, in call order', async () => {
    const queue = new OperationQueue();
    const log: string[] = [];

    await Promise.all([
      queue.run(async () => {
        log.push('a:start');
        await tick();
        log.push('a:end');
      }),
      queue.run(() => {
        log.push('b');
      }),
    ]);

    expect(log).toEqual(['a:start', 'a:end', 'b']);
  });

  it('passes results through and keeps going after a failure', async () => {
    const queue = new OperationQueue();
    const failed = queue.run(() => {
      throw new Error('boom');
    });
    const next = queue.run(() => 42);

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);
  });

  it('after() holds later tasks until the gate settles, even if it rejects', async () => {
    const queue = new OperationQueue();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((_, reject) => {
      release = () => reject(new Error('gate failed'));
    });
    queue.after(gate);
    const log: string[] = [];
    const task = queue.run(() => log.push('ran'));

    await tick();
    expect(log).toEqual([]);
    release();
    await task;
    expect(log).toEqual(['ran']);
  });
});
```

```ts file=tests/unit/persistence/async-write-strategy.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { composeAsyncCodecs } from '../../../src/codec/async-codec.js';
import type { Entry } from '../../../src/core/entry.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { StorageQuotaError } from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { AsyncSnapshotRepository } from '../../../src/persistence/async-snapshot-repository.js';
import { AsyncSnapshotSerializer } from '../../../src/persistence/async-snapshot-serializer.js';
import {
  AsyncDebouncedWriteStrategy,
  AsyncImmediateWriteStrategy,
} from '../../../src/persistence/async-write-strategy.js';
import type { PageLifecycle } from '../../../src/persistence/page-lifecycle.js';
import { OperationQueue } from '../../../src/vault/operation-queue.js';

const entry = (value: unknown): Entry => ({
  json: JSON.stringify(value),
  expiresAt: null,
});
const one = Snapshot.empty.with('a', entry(1));
const big = one.with('b', entry('x'.repeat(100)));

interface Setup {
  driver: AsyncMemoryDriver;
  store: AsyncSnapshotRepository;
  report: Mock<(error: StorageError) => void>;
}

function setup(maxBytes = 1_000_000): Setup {
  const driver = new AsyncMemoryDriver();
  const report = vi.fn<(error: StorageError) => void>();
  const store = new AsyncSnapshotRepository({
    driver,
    key: 'K',
    serializer: new AsyncSnapshotSerializer(composeAsyncCodecs([])),
    maxBytes,
    report,
  });
  return { driver, store, report };
}

describe('AsyncImmediateWriteStrategy', () => {
  it('saves on write; flush, discard and dispose do nothing', async () => {
    const { driver, store } = setup();
    const strategy = new AsyncImmediateWriteStrategy(store);

    await strategy.write(one);
    await strategy.flush();
    strategy.discard();
    strategy.dispose();

    expect(await driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
  });
});

describe('AsyncDebouncedWriteStrategy', () => {
  let hide: () => void = () => undefined;
  const detach = vi.fn<() => void>();
  const lifecycle: PageLifecycle = {
    onHide: (callback) => {
      hide = callback;
      return detach;
    },
  };

  function debounced(maxBytes?: number): Setup & {
    strategy: AsyncDebouncedWriteStrategy;
  } {
    const base = setup(maxBytes);
    const strategy = new AsyncDebouncedWriteStrategy({
      store: base.store,
      delayMs: 100,
      report: base.report,
      lifecycle,
      runner: new OperationQueue(),
    });
    return { ...base, strategy };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the write and saves it after the delay', async () => {
    const { strategy, driver } = debounced();

    await strategy.write(one);
    expect(strategy.pending()).toBe(one);
    expect(await driver.read('K')).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(await driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
  });

  it('flush() saves now and rejects on failure, keeping the snapshot', async () => {
    const { strategy } = debounced(80);

    await strategy.write(big);

    await expect(strategy.flush()).rejects.toThrow(StorageQuotaError);
    expect(strategy.pending()).toBe(big);
  });

  it('reports a failed timed save and keeps the snapshot for a retry', async () => {
    const { strategy, report } = debounced(80);

    await strategy.write(big);
    await vi.advanceTimersByTimeAsync(100);

    expect(report).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    expect(strategy.pending()).toBe(big);
  });

  it('flushes on page hide', async () => {
    const { strategy, driver } = debounced();

    await strategy.write(one);
    hide();
    await vi.advanceTimersByTimeAsync(0);

    expect(await driver.read('K')).toBe(encodeEnvelope(one));
  });

  it('discard() drops the snapshot; dispose() detaches', async () => {
    const { strategy, driver } = debounced();

    await strategy.write(one);
    strategy.discard();
    strategy.dispose();
    await vi.advanceTimersByTimeAsync(100);

    expect(await driver.read('K')).toBeNull();
    expect(detach).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

```ts file=src/vault/operation-queue.ts
const noop = (): void => undefined;

/** Anything that can run a task exclusively. */
interface TaskRunner {
  run<T>(task: () => T | Promise<T>): Promise<T>;
}

/**
 * Runs an async vault's operations one at a time, in call order, so
 * concurrent calls can never interleave their read-modify-write steps.
 */
class OperationQueue implements TaskRunner {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(noop, noop);
    return result;
  }

  /** Holds every later task until `gate` settles, whether it resolves or rejects. */
  after(gate: Promise<unknown>): void {
    this.tail = this.tail.then(() => gate).then(noop, noop);
  }
}

export { OperationQueue };
export type { TaskRunner };
```

```ts file=src/persistence/async-write-strategy.ts
import type { Snapshot } from '../core/snapshot.js';
import { toStorageError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import type { TaskRunner } from '../vault/operation-queue.js';
import type { PageLifecycle } from './page-lifecycle.js';
import type { AsyncSnapshotStore } from './snapshot-store.js';

/** Async counterpart of WriteStrategy. */
interface AsyncWriteStrategy {
  write(snapshot: Snapshot): Promise<void>;
  pending(): Snapshot | null;
  flush(): Promise<void>;
  discard(): void;
  dispose(): void;
}

class AsyncImmediateWriteStrategy implements AsyncWriteStrategy {
  constructor(private readonly store: AsyncSnapshotStore) {}

  write(snapshot: Snapshot): Promise<void> {
    return this.store.save(snapshot);
  }

  pending(): Snapshot | null {
    return null;
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  discard(): void {}

  dispose(): void {}
}

interface AsyncDebouncedDeps {
  store: AsyncSnapshotStore;
  delayMs: number;
  report: Reporter;
  lifecycle: PageLifecycle;
  /** The vault's queue: timed and page-hide flushes run in line with its calls. */
  runner: TaskRunner;
}

/**
 * Coalesces writes made within `delayMs`. Timed and page-hide flushes go
 * through the vault's queue, so they never overlap a call. Their failures
 * are reported, and the snapshot is kept for the next attempt.
 */
class AsyncDebouncedWriteStrategy implements AsyncWriteStrategy {
  private readonly store: AsyncSnapshotStore;
  private readonly delayMs: number;
  private readonly report: Reporter;
  private readonly runner: TaskRunner;
  private readonly detach: () => void;
  private queued: Snapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: AsyncDebouncedDeps) {
    this.store = deps.store;
    this.delayMs = deps.delayMs;
    this.report = deps.report;
    this.runner = deps.runner;
    // Best effort: the browser may end the page before an async write lands.
    this.detach = deps.lifecycle.onHide(() => {
      void this.flushInLine();
    });
  }

  write(snapshot: Snapshot): Promise<void> {
    this.queued = snapshot;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushInLine();
    }, this.delayMs);
    return Promise.resolve();
  }

  pending(): Snapshot | null {
    return this.queued;
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    const snapshot = this.queued;
    if (snapshot === null) return;
    await this.store.save(snapshot);
    if (this.queued === snapshot) this.queued = null;
  }

  discard(): void {
    this.cancelTimer();
    this.queued = null;
  }

  dispose(): void {
    this.cancelTimer();
    this.detach();
  }

  private flushInLine(): Promise<void> {
    return this.runner.run(async () => {
      try {
        await this.flush();
      } catch (error) {
        this.report(toStorageError(error, 'A deferred write failed.'));
      }
    });
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export { AsyncImmediateWriteStrategy, AsyncDebouncedWriteStrategy };
export type { AsyncWriteStrategy };
```

- [ ] **Step 4: Run to verify they pass.** Run the same command set as before.
- [ ] **Step 5: Commit** with message `feat(persistence): add an operation queue and async write strategies`.

---

### Task 5: Driver kinds in the name registry; one shared vault registry

**Files:**

- Modify: `src/drivers/driver-registry.ts`, `src/vault/registry.ts`, `src/vault/create-vault.ts`, `tests/unit/drivers/driver-registry.test.ts`

**Interfaces:**

- Produces:
  - `registerAsyncDriver(name, factory: AsyncDriverFactory, options?)`
  - `resolveAnyDriver(spec, report): AnyStorageDriver`
  - `buildDriver(name, factory): Resolution`
  - `type AsyncDriverFactory`, `type Resolution`
  - `'indexeddb'` is reserved, and `resolveDriver` rejects async names with "use createAsyncVault"
  - The shared instance `vaultRegistry`
  - `Retirable.retire` returns `void | Promise<void>`
  - `claim(…)` returns `{ replaced: boolean; retired: Promise<void> }`

- [ ] **Step 1: Write the failing tests.** Append to `driver-registry.test.ts`, importing `registerAsyncDriver` and `resolveAnyDriver` from the registry and `AsyncMemoryDriver` from its module:

```ts
describe('async drivers', () => {
  it('registerAsyncDriver makes an async driver resolvable for async vaults', () => {
    const driver = new AsyncMemoryDriver();
    registerAsyncDriver('remote', () => driver);

    expect(resolveAnyDriver('remote', report)).toBe(driver);
  });

  it('resolveAnyDriver also resolves sync names', () => {
    expect(resolveAnyDriver('memory', report)).toBeInstanceOf(MemoryDriver);
  });

  it('resolveDriver (createVault) refuses async names and indexeddb', () => {
    registerAsyncDriver('remote', () => new AsyncMemoryDriver());

    expect(() => resolveDriver('remote', report)).toThrow(/createAsyncVault/);
    expect(() => resolveDriver('indexeddb', report)).toThrow(
      /createAsyncVault/
    );
  });

  it('reserves indexeddb', () => {
    expect(() =>
      registerAsyncDriver('indexeddb', () => new AsyncMemoryDriver())
    ).toThrow(StorageArgumentError);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL, because the imports are missing.

- [ ] **Step 3: Implement**

Changes to `src/drivers/driver-registry.ts`. Keep the existing JSDoc and comments.

- Import the type `AsyncStorageDriver`.
- Add `type AnyStorageDriver = StorageDriver | AsyncStorageDriver;` and `type AsyncDriverFactory = () => AsyncStorageDriver;`.
- `Resolution.driver` becomes `AnyStorageDriver`.
- `Registration` gains `kind: 'sync' | 'async'` and `factory: () => AnyStorageDriver`. `builtIns()` sets `kind: 'sync'`.
- `BUILT_IN_NAMES` becomes `['local', 'session', 'memory', 'indexeddb']`, with the comment `// indexeddb is resolved by the async vault itself, so sync-only bundles never include the IndexedDB driver; it is reserved here all the same.`
- Add `const ASYNC_BUILT_IN_NAMES: readonly string[] = ['indexeddb'];`.
- `registerDriver` and `registerAsyncDriver` both delegate to a private `register(name, factory: unknown, kind, options, caller)`. That function runs the existing validation, using `caller` in the "needs a factory function" message.
- Rename the old `resolveDriver` body to `resolveAnyDriver(spec: string | AnyStorageDriver, report): AnyStorageDriver`.
- Add the new `resolveDriver`:
  ```ts
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
  ```
- Rename `build` to `buildDriver` and export it.
- `conflictScope` takes `(spec: string | AnyStorageDriver, driver: AnyStorageDriver)`.
- Export `registerAsyncDriver`, `resolveAnyDriver` and `buildDriver`, plus the types `AsyncDriverFactory`, `AnyStorageDriver` and `Resolution`.

Changes to `src/vault/registry.ts`:

- `retire(reason: string): void | Promise<void>;`
- `claim` returns `ClaimResult`:
  ```ts
  interface ClaimResult {
    replaced: boolean;
    /** Settles once the replaced vault has flushed; never rejects. */
    retired: Promise<void>;
  }
  ```
  When there is a previous owner, `retired = Promise.resolve(previous.retire(reason)).then(noop, noop)`. Otherwise it is `Promise.resolve()`.
- Add `const vaultRegistry = new VaultRegistry();` (one per package copy, shared by both vault kinds) and export it.

In `src/vault/create-vault.ts`:

- Use `vaultRegistry` and delete the local registry.
- Replace `if (registry.claim(…))` with `if (vaultRegistry.claim(…).replaced)`.

- [ ] **Step 4: Run to verify they pass.** Run the same command set.
- [ ] **Step 5: Commit** with message `feat(drivers): register async drivers and share one vault registry across vault kinds`.

---

### Task 6: IndexedDB driver

**Files:**

- Create: `src/drivers/indexeddb-driver.ts`, `src/drivers/indexeddb-builtin.ts`, `tests/unit/drivers/indexeddb-driver.test.ts`
- Modify: `package.json` (add the dev dependency `fake-indexeddb@6.2.5`)

**Interfaces:**

- Produces:
  - `class IndexedDBDriver extends BaseAsyncStorageDriver`, with `IndexedDBDriverOptions { databaseName?, storeName?, namespace? }`
  - `resolveIndexedDB(report): AnyStorageDriver`
  - `resetIndexedDBBuiltIn()`, a test hook

- [ ] **Step 1: Install and write the failing tests**

Run: `pnpm add -D fake-indexeddb@6.2.5`

```ts file=tests/unit/drivers/indexeddb-driver.test.ts
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedDBDriver } from '../../../src/drivers/indexeddb-driver.js';
import { assertAsyncStorageDriver } from '../../../src/testing/index.js';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openRaw(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(name)
        : indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDBDriver', () => {
  it('honours the async driver contract', async () => {
    await assertAsyncStorageDriver(
      () => new IndexedDBDriver({ databaseName: 'kit' })
    );
  });

  it('persists across driver instances on the same database', async () => {
    await new IndexedDBDriver({ databaseName: 'shared' }).write('k', 'v');

    expect(
      await new IndexedDBDriver({ databaseName: 'shared' }).read('k')
    ).toBe('v');
  });

  it('opens the database lazily, on first use', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const driver = new IndexedDBDriver({ databaseName: 'lazy' });
    expect(open).not.toHaveBeenCalled();

    await driver.read('k');
    expect(open).toHaveBeenCalled();
  });

  it('adds a missing store to an existing database by upgrading it', async () => {
    await new IndexedDBDriver({ databaseName: 'multi', storeName: 'a' }).write(
      'k',
      'from a'
    );
    const b = new IndexedDBDriver({ databaseName: 'multi', storeName: 'b' });

    await b.write('k', 'from b');

    expect(await b.read('k')).toBe('from b');
    expect(
      await new IndexedDBDriver({ databaseName: 'multi', storeName: 'a' }).read(
        'k'
      )
    ).toBe('from a');
  });

  it('closes on versionchange so another tab can upgrade, then reopens', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'upgrade' });
    await driver.write('k', 'v');

    const other = await openRaw('upgrade', 5);
    other.close();

    expect(await driver.read('k')).toBe('v');
  });

  it('retries opening after a failed open', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'retry' });
    vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    await expect(driver.read('k')).rejects.toThrow('denied');
    expect(await driver.read('k')).toBeNull();
  });

  it('rejects with the original error, keeping a quota error name', async () => {
    const driver = new IndexedDBDriver({ databaseName: 'quota' });
    await driver.read('k');
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    await expect(driver.write('k', 'v')).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  it('throws on construction where IndexedDB does not exist', () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(() => new IndexedDBDriver()).toThrow(/IndexedDB/);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

```ts file=src/drivers/indexeddb-driver.ts
import { assertKey } from '../core/validation.js';
import { BaseAsyncStorageDriver } from './base-async-storage-driver.js';
import type { BaseAsyncStorageDriverOptions } from './base-async-storage-driver.js';

interface IndexedDBDriverOptions extends BaseAsyncStorageDriverOptions {
  /** Default 'smart-storage'. */
  databaseName?: string;
  /** Default 'keyval'. Added to an existing database by upgrading it. */
  storeName?: string;
}

/** Stores each vault as one string in an IndexedDB object store. */
class IndexedDBDriver extends BaseAsyncStorageDriver {
  override readonly name: string = 'indexedDB';
  private readonly databaseName: string;
  private readonly storeName: string;
  private connection: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBDriverOptions = {}) {
    super(options);
    // Throwing makes the registered 'indexeddb' driver fall back to memory.
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available here.');
    }
    this.databaseName = options.databaseName ?? 'smart-storage';
    this.storeName = options.storeName ?? 'keyval';
    assertKey(this.databaseName, 'databaseName');
    assertKey(this.storeName, 'storeName');
  }

  protected override async readRaw(key: string): Promise<string | null> {
    const value: unknown = await this.request('readonly', (store) =>
      store.get(key)
    );
    return typeof value === 'string' ? value : null;
  }

  protected override async writeRaw(key: string, value: string): Promise<void> {
    await this.request('readwrite', (store) => store.put(value, key));
  }

  protected override async removeRaw(key: string): Promise<void> {
    await this.request('readwrite', (store) => store.delete(key));
  }

  private async request<T>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode);
      const request = makeRequest(transaction.objectStore(this.storeName));
      // Settle on the transaction, so a resolved write is durable.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new DOMException('The transaction was aborted.', 'AbortError')
        );
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;

    const connection = openStore(this.databaseName, this.storeName);
    this.connection = connection;
    // Forget a failed or closed connection, so the next call reopens.
    void connection.then(
      (database) => {
        database.onversionchange = () => {
          database.close();
          if (this.connection === connection) this.connection = null;
        };
      },
      () => {
        if (this.connection === connection) this.connection = null;
      }
    );
    return connection;
  }
}

/** Opens the database, creating the store (one version up) if it is missing. */
function openStore(
  databaseName: string,
  storeName: string,
  version?: number
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(databaseName)
        : indexedDB.open(databaseName, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(storeName)) {
        resolve(database);
        return;
      }
      const next = database.version + 1;
      database.close();
      openStore(databaseName, storeName, next).then(resolve, reject);
    };
    request.onerror = () => reject(request.error);
  });
}

export { IndexedDBDriver };
export type { IndexedDBDriverOptions };
```

```ts file=src/drivers/indexeddb-builtin.ts
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
```

- [ ] **Step 4: Run to verify it passes.** Run the same command set.
- [ ] **Step 5: Commit** with message `feat(drivers): add a built-in IndexedDB driver`.

---

### Task 7: The async vault

**Files:**

- Create: `src/vault/async-vault.ts`, `src/vault/default-async-vault.ts`, `src/vault/create-async-vault.ts`, `tests/unit/vault/async-vault.test.ts`
- Modify: `src/vault/options.ts` (generic resolver + `resolveAsyncOptions`), `src/index.ts`, `tests/unit/public-api.test.ts`, `vitest.config.ts` (exclude the type-only `async-vault.ts`)

**Interfaces:**

- Produces: `AsyncVault`, `AsyncVaultOptions`, `AsyncDriverSpec`, `createAsyncVault(options): AsyncVault`, and the new public exports.

- [ ] **Step 1: Write the failing tests**

```ts file=tests/unit/vault/async-vault.test.ts
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { AsyncCodec } from '../../../src/codec/async-codec.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import {
  registerAsyncDriver,
  resetDriverRegistry,
} from '../../../src/drivers/driver-registry.js';
import { resetIndexedDBBuiltIn } from '../../../src/drivers/indexeddb-builtin.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  StorageArgumentError,
  StorageConflictError,
  StorageCorruptionError,
  StorageDisposedError,
  StorageQuotaError,
  StorageUnavailableError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import type {
  AsyncVault,
  AsyncVaultOptions,
} from '../../../src/vault/async-vault.js';
import { createAsyncVault } from '../../../src/vault/create-async-vault.js';
import { createVault } from '../../../src/vault/create-vault.js';
import type { Vault } from '../../../src/vault/vault.js';

interface Harness {
  vault: AsyncVault;
  driver: AsyncMemoryDriver;
  onError: Mock<(error: StorageError) => void>;
  raw: () => Promise<string | null>;
}

const created: Array<AsyncVault | Vault> = [];
let counter = 0;

function makeVault(
  options: Partial<AsyncVaultOptions> = {},
  driver = new AsyncMemoryDriver()
): Harness {
  counter += 1;
  const onError = vi.fn<(error: StorageError) => void>();
  const vault = createAsyncVault({
    key: `ASYNC_${String(counter)}`,
    driver,
    onError,
    ...options,
  });
  created.push(vault);
  return { vault, driver, onError, raw: () => driver.read(vault.key) };
}

beforeEach(() => {
  resetDriverRegistry();
  resetIndexedDBBuiltIn();
  vi.useFakeTimers({
    now: 1_000,
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
});

afterEach(async () => {
  await Promise.all(created.splice(0).map((vault) => vault.dispose()));
  vi.useRealTimers();
  resetDriverRegistry();
  resetIndexedDBBuiltIn();
});

describe('createAsyncVault', () => {
  it('validates its options synchronously', () => {
    expect(() => createAsyncVault({ key: '' })).toThrow(StorageArgumentError);
  });

  it('stores values as the v2 envelope and returns fresh copies', async () => {
    const { vault, raw } = makeVault();
    await vault.set('a', { n: 1 });

    const read = await vault.get<{ n: number }>('a');
    if (read) read.n = 2;

    expect(await vault.get('a')).toEqual({ n: 1 });
    expect(await raw()).toBe('{"v":2,"items":[{"key":"a","value":{"n":1}}]}');
  });

  it('rejects bad arguments instead of throwing synchronously', async () => {
    const { vault } = makeVault();
    let pending: Promise<void> | undefined;

    expect(() => {
      pending = vault.set('', 1);
    }).not.toThrow();
    await expect(pending).rejects.toThrow(StorageArgumentError);
    await expect(vault.set('k', undefined)).rejects.toThrow(
      StorageArgumentError
    );
    await expect(vault.extend('k', 0)).rejects.toThrow(StorageArgumentError);
  });
});

describe('ordering', () => {
  it('runs 50 concurrent writes in order without losing any', async () => {
    const { vault } = makeVault();
    const names = Array.from({ length: 50 }, (_, i) => `k${String(i)}`);

    await Promise.all(names.map((name, i) => vault.set(name, i)));

    expect(await vault.keys()).toEqual(names);
  });

  it('a read queued after a write sees it', async () => {
    const { vault } = makeVault();

    const [, value] = await Promise.all([vault.set('a', 1), vault.get('a')]);

    expect(value).toBe(1);
  });

  it('a failed call does not block the calls after it', async () => {
    const { vault } = makeVault();
    const failing = vault.set('', 1);
    const next = vault.set('ok', 1);

    await expect(failing).rejects.toThrow(StorageArgumentError);
    await next;
    expect(await vault.get('ok')).toBe(1);
  });
});

describe('same semantics as the sync vault', () => {
  it('expiry, update, extend, ttl and remove', async () => {
    const { vault } = makeVault();
    await vault.set('t', 'x', { ttl: 500 });
    vi.advanceTimersByTime(200);

    expect(await vault.ttl('t')).toBe(300);
    expect(await vault.update('t', 'y')).toBe(true);
    expect(await vault.ttl('t')).toBe(300);
    expect(await vault.extend('t', 100)).toBe(true);
    expect(await vault.ttl('t')).toBe(400);

    vi.advanceTimersByTime(401);
    expect(await vault.get('t')).toBeNull();
    expect(await vault.has('t')).toBe(false);
    expect(await vault.update('t', 'z')).toBe(false);
    expect(await vault.remove('t')).toBe(false);
  });

  it('keys, toObject, purgeExpired and clear', async () => {
    const { vault, raw } = makeVault();
    await vault.set('a', 1);
    await vault.set('gone', 2, { ttl: 10 });
    vi.advanceTimersByTime(11);

    expect(await vault.toObject()).toEqual({ a: 1 });
    expect(await vault.purgeExpired()).toBe(1);
    await vault.clear();
    expect(await raw()).toBeNull();
  });

  it('rejects a write over maxBytes and keeps what was stored', async () => {
    const { vault, raw } = makeVault({ maxBytes: 100 });
    await vault.set('a', 1);
    const before = await raw();

    await expect(vault.set('big', 'x'.repeat(200))).rejects.toThrow(
      StorageQuotaError
    );
    expect(await raw()).toBe(before);
  });

  it('reports corrupted data, and reads 1.x data', async () => {
    const driver = new AsyncMemoryDriver();
    await driver.write('BROKEN', 'not json');
    await driver.write(
      'LEGACY',
      JSON.stringify({ theme: { value: 'dark', expiry: null } })
    );
    const broken = makeVault({ key: 'BROKEN' }, driver);
    const legacy = makeVault({ key: 'LEGACY' }, driver);

    expect(await broken.vault.get('a')).toBeNull();
    expect(broken.onError).toHaveBeenCalledWith(
      expect.any(StorageCorruptionError)
    );
    expect(await legacy.vault.get('theme')).toBe('dark');
  });

  it('stats() describes the stored data', async () => {
    const { vault, raw } = makeVault({ maxBytes: 1000 });
    await vault.set('a', 1);

    const stats = await vault.stats();

    expect(stats).toMatchObject({
      driver: 'memory',
      itemCount: 1,
      maxBytes: 1000,
    });
    expect(stats.bytes).toBe((await raw())?.length);
  });
});

describe('debounced async vault', () => {
  it('reads its own pending write and saves after the delay', async () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    await vault.set('a', 1);
    expect(await vault.get('a')).toBe(1);
    expect(await raw()).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(await raw()).toBe(
      encodeEnvelope(Snapshot.empty.with('a', { json: '1', expiresAt: null }))
    );
  });

  it('reports a failed deferred write, and flush() rejects with it', async () => {
    const { vault, onError } = makeVault({ debounceMs: 100, maxBytes: 60 });

    await vault.set('big', 'x'.repeat(100));
    await vi.advanceTimersByTimeAsync(100);

    expect(onError).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    await expect(vault.flush()).rejects.toThrow(StorageQuotaError);
  });

  it('dispose() saves the pending write', async () => {
    const { vault, raw } = makeVault({ debounceMs: 100 });

    await vault.set('a', 1);
    await vault.dispose();

    expect(await raw()).not.toBeNull();
  });
});

describe('dispose and takeover', () => {
  it('rejects every call after dispose', async () => {
    const { vault } = makeVault();
    await vault.dispose();

    await expect(vault.get('a')).rejects.toThrow(StorageDisposedError);
    await expect(vault.set('a', 1)).rejects.toThrow(StorageDisposedError);
    await expect(vault.stats()).rejects.toThrow(StorageDisposedError);
    await expect(vault.dispose()).resolves.toBeUndefined();
  });

  it('a newer vault waits for the retired one to save its pending write', async () => {
    const driver = new AsyncMemoryDriver();
    const first = createAsyncVault({ key: 'K', driver, debounceMs: 1000 });
    created.push(first);
    await first.set('a', 1);

    const onError = vi.fn<(error: StorageError) => void>();
    const second = createAsyncVault({ key: 'K', driver, onError });
    created.push(second);

    expect(await second.get('a')).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
    await expect(first.get('a')).rejects.toThrow(StorageDisposedError);
  });

  it('a sync and an async vault on one driver conflict', () => {
    const driver = new MemoryDriver();
    created.push(createVault({ key: 'K', driver }));
    const onError = vi.fn<(error: StorageError) => void>();

    created.push(createAsyncVault({ key: 'K', driver, onError }));

    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
  });
});

describe('drivers and codecs', () => {
  it('uses sync driver names such as local', async () => {
    localStorage.clear();
    const vault = createAsyncVault({ key: 'ASYNC_LOCAL', driver: 'local' });
    created.push(vault);

    await vault.set('a', 1);

    expect(localStorage.getItem('ASYNC_LOCAL')).not.toBeNull();
  });

  it('round-trips through an async codec', async () => {
    const reverse: AsyncCodec = {
      encode: async (text) => {
        await Promise.resolve();
        return [...text].reverse().join('');
      },
      decode: (text) => [...text].reverse().join(''),
    };
    const { vault, raw } = makeVault({ codecs: [reverse] });

    await vault.set('a', 1);

    expect(await raw()).not.toContain('"v":2');
    expect(await vault.get('a')).toBe(1);
  });

  it('uses a registered async driver by name', async () => {
    const driver = new AsyncMemoryDriver();
    registerAsyncDriver('remote', () => driver);
    const vault = createAsyncVault({ key: 'REMOTE', driver: 'remote' });
    created.push(vault);

    await vault.set('a', 1);

    expect(await driver.read('REMOTE')).not.toBeNull();
  });

  it('createVault refuses async drivers', () => {
    registerAsyncDriver('remote', () => new AsyncMemoryDriver());

    expect(() => createVault({ key: 'K', driver: 'indexeddb' })).toThrow(
      /createAsyncVault/
    );
    expect(() => createVault({ key: 'K2', driver: 'remote' })).toThrow(
      /createAsyncVault/
    );
    const vault = createVault({
      key: 'K3',
      driver: new AsyncMemoryDriver() as unknown as MemoryDriver,
    });
    created.push(vault);
    expect(() => vault.get('a')).toThrow(StorageArgumentError);
  });
});

describe('the default IndexedDB driver', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('defaults to IndexedDB', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const vault = createAsyncVault({ key: 'IDB_DEFAULT' });
    created.push(vault);

    await vault.set('a', 1);

    expect((await vault.stats()).driver).toBe('indexedDB');
    expect(await vault.get('a')).toBe(1);
  });

  it('falls back to memory and reports it when a browser has no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const onError = vi.fn<(error: StorageError) => void>();
    const vault = createAsyncVault({ key: 'NO_IDB', onError });
    created.push(vault);

    await vault.set('a', 1);

    expect(await vault.get('a')).toBe(1);
    expect((await vault.stats()).driver).toBe('memory');
    expect(onError).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });

  it('uses memory silently on the server', async () => {
    vi.stubGlobal('window', undefined);
    const onError = vi.fn<(error: StorageError) => void>();
    const vault = createAsyncVault({ key: 'SSR', onError });
    created.push(vault);

    await vault.set('a', 1);

    expect(await vault.get('a')).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
```

Update `tests/unit/public-api.test.ts`.

- Add these runtime names: `'AsyncMemoryDriver'`, `'BaseAsyncStorageDriver'`, `'IndexedDBDriver'`, `'createAsyncVault'` and `'registerAsyncDriver'`.
- The testing entry list should also include `'assertAsyncStorageDriver'` and `'verifyAsyncStorageDriver'`, if Task 2 did not already add them.

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

```ts file=src/vault/async-vault.ts
import type { AsyncCodec } from '../codec/async-codec.js';
import type { AsyncStorageDriver } from '../drivers/async-storage-driver.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import type { SetOptions, VaultOptions, VaultStats } from './vault.js';

/** 'indexeddb', any sync or async registered name, or a driver of either kind. */
type AsyncDriverSpec =
  | 'indexeddb'
  | 'local'
  | 'session'
  | 'memory'
  | (string & Record<never, never>)
  | StorageDriver
  | AsyncStorageDriver;

interface AsyncVaultOptions extends Omit<VaultOptions, 'driver' | 'codecs'> {
  /** Where data is kept. Default 'indexeddb'. Sync drivers work too. */
  driver?: AsyncDriverSpec;
  /** String transforms that may be asynchronous (e.g. Web Crypto). */
  codecs?: readonly AsyncCodec[];
}

/**
 * The async counterpart of Vault: the same methods and rules, but each
 * returns a Promise. Calls run one at a time, in call order. Failures
 * reject; nothing throws synchronously.
 */
interface AsyncVault {
  readonly key: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  has(key: string): Promise<boolean>;
  update<T>(key: string, value: T): Promise<boolean>;
  extend(key: string, ms: number): Promise<boolean>;
  ttl(key: string): Promise<number | null>;
  remove(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  toObject(): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
  purgeExpired(): Promise<number>;
  flush(): Promise<void>;
  stats(): Promise<VaultStats>;
  dispose(): Promise<void>;
}

export type { AsyncVault, AsyncVaultOptions, AsyncDriverSpec };
```

Changes to `src/vault/options.ts`:

- Rename the body of `resolveOptions` to a generic function:
  ```ts
  function resolveCommon<D, C>(
    options: OptionsShape<D, C>,
    defaultDriver: D
  ): ResolvedOptions<D, C>;
  ```
- Define the shapes it uses:
  ```ts
  interface OptionsShape<D, C> {
    key: string;
    driver?: D;
    codecs?: readonly C[];
    debounceMs?: number;
    maxBytes?: number;
    maxItems?: number;
    onError?: (error: StorageError) => void;
  }
  ```
  `ResolvedOptions<D = DriverSpec, C = Codec>` has `driver: D` and `codecs: readonly C[]`.
- Inside `resolveCommon`, the default for `driver` is `defaultDriver`, and the non-object message becomes `'Vault options must be an object, e.g. { key: "APP" }.'`.
- Add the two entry points:
  ```ts
  function resolveOptions(options: VaultOptions): ResolvedOptions {
    return resolveCommon(options, 'local');
  }

  function resolveAsyncOptions(
    options: AsyncVaultOptions
  ): ResolvedOptions<AsyncDriverSpec, AsyncCodec> {
    return resolveCommon(options, 'indexeddb');
  }
  ```
- Export `resolveAsyncOptions`.

```ts file=src/vault/default-async-vault.ts
import type { Snapshot } from '../core/snapshot.js';
import { StorageDisposedError, toStorageError } from '../errors.js';
import type { AsyncWriteStrategy } from '../persistence/async-write-strategy.js';
import type { AsyncSnapshotStore } from '../persistence/snapshot-store.js';
import type { Reporter } from '../reporting/reporter.js';
import type { AsyncVault } from './async-vault.js';
import type { OperationQueue } from './operation-queue.js';
import {
  extendOp,
  getOp,
  hasOp,
  keysOp,
  purgeExpiredOp,
  removeOp,
  setOp,
  toObjectOp,
  ttlOp,
  updateOp,
} from './operations.js';
import type { Operation } from './operations.js';
import type { Retirable } from './registry.js';
import type { SetOptions, VaultStats } from './vault.js';

interface AsyncVaultDeps {
  key: string;
  store: AsyncSnapshotStore;
  strategy: AsyncWriteStrategy;
  queue: OperationQueue;
  maxItems: number;
  maxBytes: number;
  report: Reporter;
  onDispose: () => void;
}

/**
 * The AsyncVault facade. Every call runs through the queue, so calls never
 * interleave; decisions come from the same operations as the sync vault.
 */
class DefaultAsyncVault implements AsyncVault, Retirable {
  readonly key: string;
  private readonly store: AsyncSnapshotStore;
  private readonly strategy: AsyncWriteStrategy;
  private readonly queue: OperationQueue;
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly report: Reporter;
  private readonly onDispose: () => void;
  private retiredReason: string | null = null;

  constructor(deps: AsyncVaultDeps) {
    this.key = deps.key;
    this.store = deps.store;
    this.strategy = deps.strategy;
    this.queue = deps.queue;
    this.maxItems = deps.maxItems;
    this.maxBytes = deps.maxBytes;
    this.report = deps.report;
    this.onDispose = deps.onDispose;
  }

  get<T>(key: string): Promise<T | null> {
    return this.perform(() => getOp<T>(key));
  }

  set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    return this.perform(() => setOp(key, value, options));
  }

  has(key: string): Promise<boolean> {
    return this.perform(() => hasOp(key));
  }

  update<T>(key: string, value: T): Promise<boolean> {
    return this.perform(() => updateOp(key, value));
  }

  extend(key: string, ms: number): Promise<boolean> {
    return this.perform(() => extendOp(key, ms));
  }

  ttl(key: string): Promise<number | null> {
    return this.perform(() => ttlOp(key));
  }

  remove(key: string): Promise<boolean> {
    return this.perform(() => removeOp(key));
  }

  keys(): Promise<string[]> {
    return this.perform(keysOp);
  }

  toObject(): Promise<Record<string, unknown>> {
    return this.perform(toObjectOp);
  }

  purgeExpired(): Promise<number> {
    return this.perform(purgeExpiredOp);
  }

  clear(): Promise<void> {
    return this.queue.run(async () => {
      this.assertUsable();
      // Remove first: if that fails, the pending change is still there.
      await this.store.remove();
      this.strategy.discard();
    });
  }

  flush(): Promise<void> {
    return this.queue.run(async () => {
      this.assertUsable();
      await this.strategy.flush();
    });
  }

  stats(): Promise<VaultStats> {
    return this.queue.run(async () => {
      this.assertUsable();
      const snapshot = await this.current();
      const pending = this.strategy.pending();
      const bytes = pending
        ? await this.store.measure(pending)
        : this.store.storedBytes();
      return {
        key: this.key,
        driver: this.store.driverName,
        itemCount: snapshot.live(Date.now()).length,
        bytes,
        maxBytes: this.maxBytes,
        usage: bytes / this.maxBytes,
      };
    });
  }

  dispose(): Promise<void> {
    return this.retire('This vault was disposed.');
  }

  retire(reason: string): Promise<void> {
    return this.queue.run(async () => {
      if (this.retiredReason !== null) return;
      try {
        await this.strategy.flush();
      } catch (error) {
        this.report(toStorageError(error, 'Saving on dispose failed.'));
      }
      this.strategy.dispose();
      this.retiredReason = reason;
      this.onDispose();
    });
  }

  private perform<R>(build: () => Operation<R>): Promise<R> {
    return this.queue.run(async () => {
      this.assertUsable();
      const operation = build();
      const now = Date.now();
      const { result, next } = operation(await this.current(), now);
      if (next) await this.strategy.write(next.compact(now, this.maxItems));
      return result;
    });
  }

  private async current(): Promise<Snapshot> {
    return this.strategy.pending() ?? (await this.store.load());
  }

  private assertUsable(): void {
    if (this.retiredReason !== null) {
      throw new StorageDisposedError(this.retiredReason);
    }
  }
}

export { DefaultAsyncVault };
```

```ts file=src/vault/create-async-vault.ts
import { composeAsyncCodecs } from '../codec/async-codec.js';
import { conflictScope, resolveAnyDriver } from '../drivers/driver-registry.js';
import type { AnyStorageDriver } from '../drivers/driver-registry.js';
import { resolveIndexedDB } from '../drivers/indexeddb-builtin.js';
import { StorageConflictError } from '../errors.js';
import { AsyncSnapshotRepository } from '../persistence/async-snapshot-repository.js';
import { AsyncSnapshotSerializer } from '../persistence/async-snapshot-serializer.js';
import {
  AsyncDebouncedWriteStrategy,
  AsyncImmediateWriteStrategy,
} from '../persistence/async-write-strategy.js';
import type { AsyncWriteStrategy } from '../persistence/async-write-strategy.js';
import { browserLifecycle } from '../persistence/page-lifecycle.js';
import { createReporter } from '../reporting/reporter.js';
import type { Reporter } from '../reporting/reporter.js';
import type {
  AsyncDriverSpec,
  AsyncVault,
  AsyncVaultOptions,
} from './async-vault.js';
import { DefaultAsyncVault } from './default-async-vault.js';
import { OperationQueue } from './operation-queue.js';
import { resolveAsyncOptions } from './options.js';
import { vaultRegistry } from './registry.js';

function resolveForAsyncVault(
  spec: AsyncDriverSpec,
  report: Reporter
): AnyStorageDriver {
  return spec === 'indexeddb'
    ? resolveIndexedDB(report)
    : resolveAnyDriver(spec, report);
}

/**
 * Creates an async vault over one storage key: IndexedDB by default, or any
 * sync or async driver. Options are validated now (throws); every method
 * returns a Promise.
 *
 * @example
 * const cache = createAsyncVault({ key: 'API_CACHE' });
 * await cache.set('user:1', user, { ttl: 60_000 });
 */
function createAsyncVault(options: AsyncVaultOptions): AsyncVault {
  const config = resolveAsyncOptions(options);
  const report = createReporter(config.onError);
  const driver = resolveForAsyncVault(config.driver, report);
  const scope = conflictScope(config.driver, driver);

  const store = new AsyncSnapshotRepository({
    driver,
    key: config.key,
    serializer: new AsyncSnapshotSerializer(composeAsyncCodecs(config.codecs)),
    maxBytes: config.maxBytes,
    report,
  });
  const queue = new OperationQueue();
  const strategy: AsyncWriteStrategy =
    config.debounceMs > 0
      ? new AsyncDebouncedWriteStrategy({
          store,
          delayMs: config.debounceMs,
          report,
          lifecycle: browserLifecycle,
          runner: queue,
        })
      : new AsyncImmediateWriteStrategy(store);

  const vault: DefaultAsyncVault = new DefaultAsyncVault({
    key: config.key,
    store,
    strategy,
    queue,
    maxItems: config.maxItems,
    maxBytes: config.maxBytes,
    report,
    onDispose: () => vaultRegistry.release(scope, config.key, vault),
  });

  const { replaced, retired } = vaultRegistry.claim(
    scope,
    config.key,
    vault,
    driver.name
  );
  if (replaced) {
    // The newer vault's first call waits until the old one has flushed.
    queue.after(retired);
    report(
      new StorageConflictError(
        `A vault for "${config.key}" on ${driver.name} already existed; it was disposed and this one replaces it.`
      )
    );
  }

  return vault;
}

export { createAsyncVault };
```

Add to `src/index.ts`:

- Runtime exports: `createAsyncVault`, `registerAsyncDriver`, `IndexedDBDriver`, `AsyncMemoryDriver`, `BaseAsyncStorageDriver`.
- Types: `AsyncVault`, `AsyncVaultOptions`, `AsyncDriverSpec`, `AsyncStorageDriver`, `AsyncDriverFactory`, `AsyncCodec`, `IndexedDBDriverOptions`, `BaseAsyncStorageDriverOptions`.

Add `'src/vault/async-vault.ts'` to the coverage `exclude` list.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm test && pnpm typecheck && ./node_modules/.bin/oxlint --type-aware --deny-warnings src tests && pnpm build && pnpm typecheck:dist`.
- [ ] **Step 5: Commit** with message `feat(vault): add createAsyncVault with an operation queue and IndexedDB by default`.

---

### Task 8: Tree-shaking budget and E2E

**Files:**

- Modify: `.size-limit.json`, `tests/e2e/storage.e2e.ts`

- [ ] **Step 1: Size budgets.** Replace `.size-limit.json` with:

```json
[
  {
    "name": "createVault only (sync, tree-shaken)",
    "path": "dist/index.js",
    "import": "{ createVault }",
    "limit": "5 KB"
  },
  {
    "name": "Full package (ESM)",
    "path": "dist/index.js",
    "limit": "10 KB"
  }
]
```

Run: `pnpm size:check`. Expected: both pass.

- **If the tree-shaken entry includes IndexedDB code**, check by running `pnpm size --why`, or by searching the generated chunk for `objectStoreNames`. Then find the module-level side effect that keeps it alive, and remove it.

- [ ] **Step 2: E2E specs.** Add the five new runtime names to the export list. Then append:

```ts
test.describe('async vault in a real browser', () => {
  test('IndexedDB data survives a reload', async ({ page }) => {
    await page.evaluate(async () => {
      await window.smartStorage
        .createAsyncVault({ key: 'E2E_IDB' })
        .set('theme', 'dark');
    });

    await reload(page);

    const result = await page.evaluate(async () => {
      const vault = window.smartStorage.createAsyncVault({ key: 'E2E_IDB' });
      return {
        theme: await vault.get('theme'),
        driver: (await vault.stats()).driver,
      };
    });
    expect(result).toEqual({ theme: 'dark', driver: 'indexedDB' });
  });

  test('the real IndexedDBDriver honours the async driver contract', async ({
    page,
  }) => {
    const failures = await page.evaluate(async () => {
      const { IndexedDBDriver } = window.smartStorage;
      const { verifyAsyncStorageDriver } = window.smartStorageTesting;
      const report = await verifyAsyncStorageDriver(
        () => new IndexedDBDriver({ databaseName: 'e2e-kit' })
      );
      return report.checks
        .filter((check) => !check.passed)
        .map((check) => `${check.rule}: ${String(check.error)}`);
    });

    expect(failures).toEqual([]);
  });

  test('an open async vault sees what another tab wrote', async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await open(first);
    await open(second);

    await second.evaluate(async () => {
      const vault = window.smartStorage.createAsyncVault({
        key: 'E2E_IDB_TABS',
      });
      await vault.get('shared');
      (window as unknown as { __asyncVault: unknown }).__asyncVault = vault;
    });
    await first.evaluate(async () => {
      await window.smartStorage
        .createAsyncVault({ key: 'E2E_IDB_TABS' })
        .set('shared', 'from-tab-1');
    });

    const seen = await second.evaluate(() =>
      (
        window as unknown as {
          __asyncVault: { get: (key: string) => Promise<unknown> };
        }
      ).__asyncVault.get('shared')
    );
    expect(seen).toBe('from-tab-1');
  });

  test('an async vault works on localStorage too', async ({ page }) => {
    const raw = await page.evaluate(async () => {
      await window.smartStorage
        .createAsyncVault({ key: 'E2E_ASYNC_LOCAL', driver: 'local' })
        .set('a', 1);
      return localStorage.getItem('E2E_ASYNC_LOCAL');
    });

    expect(JSON.parse(raw ?? 'null')).toEqual({
      v: 2,
      items: [{ key: 'a', value: 1 }],
    });
  });
});
```

Run: `pnpm test:e2e`. Expected: all pass.

- [ ] **Step 3: Commit** with message `test: budget the tree-shaken sync import and cover the async vault in Chromium`.

---

### Task 9: Docs, verification, review, PR

- **README:** add a section titled "Async vault and IndexedDB". It should cover:
  - `createAsyncVault`: the default driver, sync drivers working with it, every method returning a Promise, calls running in order, and failures rejecting
  - an AES-GCM Web Crypto codec example
  - that a debounced flush on page hide is best-effort
  - that importing only `createVault` keeps the async code out of the bundle
- **CUSTOM_STORAGE.md:** add a section titled "Async backends". It should cover:
  - the `AsyncStorageDriver` contract (the `[async]` rule)
  - `BaseAsyncStorageDriver`
  - `registerAsyncDriver`
  - `verifyAsyncStorageDriver` / `assertAsyncStorageDriver`
  - `IndexedDBDriver` as the reference implementation
- **ARCHITECTURE:**
  - In the units table: operations, the operation queue, the async repository/serializer/strategies, the store policy, IndexedDB, and `indexeddb-builtin`.
  - A short "Sync and async vaults" section explaining the shared operations, the queue, and how the shared registry handles takeover.
- **ADR 0009:** async vault. Cover the single entry point (the error-class identity problem), awaiting any driver (so no adapter is needed), the operation queue, IndexedDB resolved outside the registry (for tree-shaking), and best-effort flush on page hide.
- **Other docs:** update `docs/README.md` and the CONTRIBUTING tree.

Then run the full verification (check, coverage, e2e, size:check, typecheck:dist). Do the whole-branch review, then make one fix pass. Push `feat/async-vault`, and open a PR against `feat/storage-extension-api`.
