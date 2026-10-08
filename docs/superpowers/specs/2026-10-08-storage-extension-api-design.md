# Storage Extension API — Design (PR 2 of 3)

**Date:** 2026-10-08 · **Status:** Approved design, pending spec review ·
**Branch:** `feat/storage-extension-api` (stacked on `fix/v2-minor-findings`, PR #23)

## 1. Goal

Make smart-storage open for new storage backends without modifying the
package, and make the SOLID principles visible in its public surface. An
engineer adding a new backend tomorrow should find one documented interface,
a base class to extend, a guide, a test kit that proves their driver honours
the contract, and a way to register it by name like the built-ins.

Releases as a minor version (additive; nothing existing changes shape).

### Decisions already made

| Topic               | Decision                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract level      | Raw driver: `name`, `read`, `write`, `remove` on strings. The vault keeps TTL, JSON, codecs, quota, so every backend stays small and interchangeable. |
| Registration        | Driver registry: `registerDriver(name, factory)`; built-ins register the same way (no hard-coded switch).                                             |
| Implementer support | Guide doc, conformance test kit, worked example driver, abstract base class — all four.                                                               |
| Async               | Not in this PR. PR 3 adds the async vault + IndexedDB; this PR's shapes must not block it.                                                            |

### Non-goals

Item-level storage contracts, optional capability interfaces (`keys()`,
`subscribe()`), async drivers (PR 3).

## 2. SOLID mapping

| Principle | Where it shows                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRP       | Drivers move strings only; the vault, repository, serializer, strategies and registry each own one concern.                                                                           |
| OCP       | New backends are added by implementing `StorageDriver` and calling `registerDriver`; no package code changes. Built-ins use the same path.                                            |
| LSP       | Every driver must honour the written contract (§3.1); the conformance kit (§3.4) verifies it, and every built-in driver is run through it.                                            |
| ISP       | The required contract is three methods and a name. Nothing a backend does not need.                                                                                                   |
| DIP       | The vault and write strategies depend on `SnapshotStore`; the repository depends on `SnapshotFormat`; both are interfaces (§3.5). Concrete classes meet only in the composition root. |

## 3. Design

### 3.1 The driver contract (unchanged shape, now specified)

```ts
interface StorageDriver {
  readonly name: string;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}
```

Rules every implementation must follow. The kit's rule ids are in brackets.

| Rule             | Requirement                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| [name]           | `name` is a non-empty string and does not change.                                                  |
| [sync]           | Methods return their results directly, never a Promise.                                            |
| [missing]        | `read` of a key never written returns `null` (not `undefined`, not `''`).                          |
| [roundtrip]      | `read` after `write` returns exactly the written string.                                           |
| [empty]          | The empty string round-trips as `''`, not `null`.                                                  |
| [exact]          | Unicode (incl. surrogate pairs), quotes, backslashes, newlines and JSON text round-trip unchanged. |
| [large]          | A large value (default 64 KB, configurable for small backends) round-trips.                        |
| [overwrite]      | A second `write` replaces the value.                                                               |
| [remove]         | After `remove`, `read` returns `null`.                                                             |
| [remove-missing] | `remove` of a key never written does not throw.                                                    |
| [independent]    | Keys are independent and exact: removing `a` leaves `b`; `K`, `k` and ` k` are three keys.         |
| [any-key]        | Keys may contain `:`, `/`, spaces, unicode and `__proto__`.                                        |

Documented but not machine-checkable: when out of space, `write` throws an
error whose `name` is `'QuotaExceededError'` (the vault turns it into
`StorageQuotaError`); other failures throw rather than being swallowed.

### 3.2 Driver registry (OCP)

New module `src/drivers/driver-registry.ts`, replacing the switch in
`resolve-driver.ts`.

```ts
type DriverFactory = () => StorageDriver;

interface RegisterDriverOptions {
  /** One instance per name, shared by every vault (default true). */
  shared?: boolean;
}

function registerDriver(
  name: string,
  factory: DriverFactory,
  options?: RegisterDriverOptions
): void;
function unregisterDriver(name: string): boolean;
```

- **Names**: non-empty strings. `local`, `session` and `memory` are built-in
  and cannot be registered over or unregistered (`StorageArgumentError`).
  Registering an existing custom name replaces it (hot module reloading
  re-runs registrations) and drops its shared instance.
- **Resolution** (`resolveDriver(spec, report)`): a `StorageDriver` object is
  used as-is; a string is looked up; an unknown name throws
  `StorageArgumentError` naming `registerDriver`.
- **Shared drivers** are created on first use and reused, so the vault
  registry can detect two vaults on the same key. `memory` is registered with
  `shared: false`, keeping today's "each memory vault has its own store".
- **Availability**: a factory that throws means "not available here": the
  vault uses a `MemoryDriver` instead and reports `StorageUnavailableError`
  with the thrown error as `cause`, to every vault that resolves that name. A
  factory that wants a _silent_ fallback (the built-ins on the server)
  returns a `MemoryDriver` itself.
- `DriverSpec` becomes `'local' | 'session' | 'memory' | (string & {}) | StorageDriver`
  (keeps editor autocompletion for built-ins).
- The registry is per JavaScript realm (module state). A test hook
  `resetDriverRegistry()` restores the built-ins; it is not exported from the
  package entry.

### 3.3 `BaseStorageDriver` (Template Method)

```ts
interface BaseStorageDriverOptions {
  /** Prefix every key with `${namespace}:` — for backends shared with other code. */
  namespace?: string;
}

abstract class BaseStorageDriver implements StorageDriver {
  abstract readonly name: string;
  constructor(options?: BaseStorageDriverOptions);
  read(key: string): string | null; // readRaw(prefix + key)
  write(key: string, value: string): void; // writeRaw(prefix + key, value)
  remove(key: string): void; // removeRaw(prefix + key)
  protected abstract readRaw(key: string): string | null;
  protected abstract writeRaw(key: string, value: string): void;
  protected abstract removeRaw(key: string): void;
}
```

- `namespace` is validated as a non-empty string.
- Subclasses implement only the three raw methods; the public methods are the
  fixed template (documented as "do not override").
- `MemoryDriver` and `WebStorageDriver` extend it. `WebStorageDriver` keeps
  its signature and gains an optional third argument:
  `new WebStorageDriver(storage, name?, options?)`. `MemoryDriver` gains
  optional `options`.

### 3.4 Conformance kit — `@dariushstony/smart-storage/testing`

New subpath entry (`src/testing/index.ts` → `dist/testing.{js,cjs}` +
types), so test code never ships in application bundles.

```ts
interface VerifyOptions {
  /** Characters in the [large] check. Default 65_536. */
  largeValueLength?: number;
}
interface ConformanceCheck {
  rule: string;
  description: string;
  passed: boolean;
  error?: unknown;
}
interface ConformanceReport {
  driver: string;
  passed: boolean;
  checks: ConformanceCheck[];
}

function verifyStorageDriver(
  create: () => StorageDriver,
  options?: VerifyOptions
): Promise<ConformanceReport>;
function assertStorageDriver(
  create: () => StorageDriver,
  options?: VerifyOptions
): Promise<void>;
```

- Runner-agnostic: plain functions, no Vitest/Jest import.
  `assertStorageDriver` throws an `Error` listing every failed rule with its
  description and error.
- Each check gets a fresh driver from `create()`, uses keys under a
  `__conformance__:` prefix, and removes them afterwards. The [any-key] check
  also writes the bare key `__proto__` (a prefixed one would not catch a
  driver built on a plain object), and removes it too.
- Returns a Promise so PR 3 can add `verifyAsyncStorageDriver` with the same
  report type and shared check bodies.
- The kit runs against `MemoryDriver`, `WebStorageDriver` (localStorage and
  sessionStorage, happy-dom), the example cookie driver, and — in e2e — the
  real browser `localStorage`.

### 3.5 Dependency inversion inside the package

Internal interfaces (not exported):

```ts
interface SnapshotFormat {
  // implemented by SnapshotSerializer
  serialize(snapshot: Snapshot): string;
  deserialize(text: string): DecodedEnvelope;
}
interface SnapshotStore {
  // implemented by SnapshotRepository
  readonly key: string;
  readonly driverName: string;
  load(): Snapshot;
  save(snapshot: Snapshot): void;
  remove(): void;
  measure(snapshot: Snapshot): number;
  storedBytes(): number;
}
```

`SnapshotRepository` depends on `SnapshotFormat`; `WriteStrategy`
implementations and `DefaultVault` depend on `SnapshotStore`. Only
`create-vault.ts` names concrete classes. No behaviour change.

### 3.6 Worked example — `examples/cookie-driver/`

`CookieDriver extends BaseStorageDriver`, written only against the public
package API (imports `@dariushstony/smart-storage`), with a README showing
registration (`registerDriver('cookie', () => new CookieDriver({ namespace: 'myapp' }))`)
and use.

- Values are `encodeURIComponent`-ed; cookies are written with `path=/`,
  `SameSite=Lax` and a configurable `maxAgeDays` (default 365).
- A cookie over 4,096 characters makes `writeRaw` throw a
  `DOMException('…', 'QuotaExceededError')`, so the vault reports
  `StorageQuotaError` — demonstrating the quota rule.
- Without `document` (server) the constructor throws, so a registered factory
  falls back to memory and reports it — demonstrating availability.
- README warns that cookies travel with every HTTP request; it is a teaching
  example, not a recommendation.
- Tested in the unit suite: passes `assertStorageDriver` (with
  `largeValueLength: 1_000`) and round-trips a vault through it. Vitest and
  `tsconfig.test.json` alias `@dariushstony/smart-storage` (and `/testing`)
  to `src/`, so the example reads like consumer code but tests the source.

### 3.7 Implementer guide — `docs/CUSTOM_STORAGE.md`

1. When you need a custom driver (and when a codec is enough instead).
2. The contract: interface + rules table from §3.1.
3. Implement it: plain object; class; or `extends BaseStorageDriver` (with
   `namespace`).
4. Errors: quota → throw `QuotaExceededError`; everything else → throw.
5. Verify it with the kit (Vitest and Jest snippets).
6. Register it: `registerDriver`, `shared`, availability by throwing from the
   factory, silent server fallback, hot module reloading.
7. Use it: `createVault({ key, driver: 'name' })` or pass an instance.
8. Checklist before publishing a driver.

README's "Custom drivers" section shrinks to a short example plus a link.
ARCHITECTURE gains the registry, base class, kit and the two internal
interfaces. New ADRs: 0007 driver registry, 0008 conformance kit and base
class.

## 4. Public API changes (all additive)

Main entry — runtime: `registerDriver`, `unregisterDriver`,
`BaseStorageDriver`; types: `DriverFactory`, `RegisterDriverOptions`,
`BaseStorageDriverOptions`.

`/testing` entry — runtime: `verifyStorageDriver`, `assertStorageDriver`;
types: `VerifyOptions`, `ConformanceCheck`, `ConformanceReport`.

`package.json` `exports` gains `"./testing"`; `tsup` gains the `testing`
entry; size-limit still measures the main entry (≤ 5 KB).

## 5. Error handling

| Situation                                                                  | Result                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `registerDriver` with a built-in name, empty name, or non-function factory | `StorageArgumentError`                                                                    |
| `createVault({ driver: 'unknown' })`                                       | `StorageArgumentError` naming `registerDriver`                                            |
| Factory throws                                                             | Memory fallback + `StorageUnavailableError` (cause = thrown error) reported to each vault |
| `BaseStorageDriver` with an empty `namespace`                              | `StorageArgumentError`                                                                    |

## 6. Testing

TDD for every unit:

- registry: register/resolve/replace/unregister, built-in protection, shared
  vs per-vault instances, throwing factory → fallback + report to every
  resolver, unknown name error, conflict detection through a registered name.
- base class: template delegation, namespace prefixing and isolation,
  namespace validation.
- kit: passes for built-ins; for each rule, a deliberately broken driver
  fails exactly that rule (proves the kit detects violations); report shape;
  cleanup of its keys; `assertStorageDriver` message lists failures.
- DIP: existing suites stay green (behaviour unchanged); a fake
  `SnapshotStore` drives `ImmediateWriteStrategy` to show the seam works.
- example: cookie driver passes the kit and works under a vault; oversize
  cookie → `StorageQuotaError`; no `document` → fallback + report.
- public API: export lists for both entries; `typecheck:dist` imports from
  `/testing` too.
- e2e: kit against real `localStorage`/`sessionStorage` in Chromium;
  `registerDriver` round-trip through the built bundle.
