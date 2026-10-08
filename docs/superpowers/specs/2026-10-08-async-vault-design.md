# Async Vault and IndexedDB — Design (PR 3 of 3)

**Date:** 2026-10-08 · **Status:** Approved design, pending spec review ·
**Branch:** `feat/async-vault` (stacked on `feat/storage-extension-api`, PR 2)

## 1. Goal

Add an asynchronous vault so smart-storage can use backends that cannot
answer synchronously — IndexedDB first, and any async backend an engineer
writes later (React Native AsyncStorage, a remote key-value API) — with the
same features, rules and error policy as the sync vault. Ship a built-in
IndexedDB driver.

Releases as a minor version (additive).

### Decisions already made

| Topic               | Decision                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Scope               | Async driver interface + async vault + async codecs + built-in `'indexeddb'` driver.                                                |
| Contract            | Same raw-driver shape as sync, returning Promises.                                                                                  |
| Implementer support | Same four pieces as PR 2: guide section, kit (`verifyAsyncStorageDriver`), base class (`BaseAsyncStorageDriver`), reference driver. |
| Tests               | Unit tests with the `fake-indexeddb` dev dependency; e2e in real Chromium.                                                          |

### Non-goals

Migrating data between drivers (e.g. localStorage → IndexedDB), storing
values natively without JSON (IndexedDB structured clone), cross-tab change
events, a maximum debounce wait.

## 2. Decisions changed during spec writing

1. **One entry point, not `@dariushstony/smart-storage/async`.** A second
   entry point bundles its own copy of the error classes, so
   `error instanceof StorageQuotaError` fails when the class came from the
   other entry — and tsup cannot share chunks between entries in the CJS
   build. Everything is exported from the main entry instead, written so
   bundlers tree-shake the async code away when only `createVault` is
   imported. size-limit checks both the tree-shaken sync import (≤ 5 KB) and
   the full package (≤ 10 KB).
2. **No `toAsyncDriver()` adapter.** The async vault `await`s every driver
   call, and awaiting a plain value works, so sync drivers (`'local'`,
   `'memory'`, any `StorageDriver`) plug into `createAsyncVault` directly.
   One less public concept; sync throws become rejections automatically.

## 3. Architecture

```text
            createVault ──► DefaultVault ─────────┐        createAsyncVault ──► DefaultAsyncVault
                              │                    │                              │   (operation queue)
                              ▼                    ▼                              ▼
                      SnapshotStore        vault/operations.ts  ◄────────  AsyncSnapshotStore
                     (SnapshotRepository)  (pure: plan each op)          (AsyncSnapshotRepository)
                              │                                                   │
                              ▼                                                   ▼
                       StorageDriver                                  StorageDriver | AsyncStorageDriver
                                                                        (IndexedDBDriver, AsyncMemoryDriver, …)
           shared by both: core/*, errors, reporter, SnapshotFormat envelope logic,
           VaultRegistry (conflicts), driver-name registry, quota/size policy
```

### 3.1 Async driver contract

```ts
interface AsyncStorageDriver {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

Same rules as the sync contract (PR 2 §3.1), with **[async]** replacing
[sync]: every method returns a Promise. Failures reject; quota failures
reject with an error named `'QuotaExceededError'`.

`BaseAsyncStorageDriver` mirrors `BaseStorageDriver`: protected
`readRaw` / `writeRaw` / `removeRaw` returning Promises, optional `namespace`.

`AsyncMemoryDriver extends BaseAsyncStorageDriver` is the reference
implementation (and is handy in consumers' tests).

### 3.2 IndexedDB driver

```ts
interface IndexedDBDriverOptions extends BaseAsyncStorageDriverOptions {
  databaseName?: string; // default 'smart-storage'
  storeName?: string; // default 'keyval'
}
class IndexedDBDriver extends BaseAsyncStorageDriver {
  readonly name = 'indexedDB';
}
```

- Opens the database lazily on first use (version 1; `onupgradeneeded`
  creates the store) and caches the connection promise. On `versionchange`
  it closes and forgets the connection, so another tab can upgrade; the next
  call reopens. A failed open is not cached, so the next call retries.
- `readRaw`: readonly `get`; non-string or missing → `null`.
  `writeRaw`: readwrite `put`, resolved on `complete`, rejected with the
  transaction's error on `error`/`abort` (quota keeps its
  `QuotaExceededError` name). `removeRaw`: `delete`.
- Registered under the reserved name `'indexeddb'` (shared instance).
  Without `window` (server) it silently resolves to an `AsyncMemoryDriver`;
  with `window` but no `indexedDB`, the factory throws → memory fallback and
  `StorageUnavailableError` reported.
- A database that fails to open at runtime (rare: some privacy modes) makes
  each operation reject with `StorageAccessError`; there is no silent
  mid-session fallback.

### 3.3 Async codecs

```ts
interface AsyncCodec {
  encode(text: string): string | Promise<string>;
  decode(text: string): string | Promise<string>;
}
```

Every `Codec` is an `AsyncCodec`. Composition encodes left → right and
decodes right → left, awaiting each step. This enables Web Crypto
(AES-GCM) codecs; the README shows one.

### 3.4 Async vault

```ts
interface AsyncVaultOptions extends Omit<VaultOptions, 'driver' | 'codecs'> {
  driver?: AsyncDriverSpec; // default 'indexeddb'
  codecs?: readonly AsyncCodec[];
}
type AsyncDriverSpec =
  | 'indexeddb'
  | 'local'
  | 'session'
  | 'memory'
  | (string & {})
  | StorageDriver
  | AsyncStorageDriver;

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
function createAsyncVault(options: AsyncVaultOptions): AsyncVault;
```

- **Same semantics** as the sync vault for every method (TTL, JSON copies,
  `maxBytes`, `maxItems`, reads never write, 1.x data, error classes, thrown
  vs reported). `createAsyncVault` itself validates options synchronously and
  throws `StorageArgumentError`, like `createVault`; every method reports
  failures by **rejecting**, never by throwing synchronously.
- **Operation queue**: each call is queued and runs after the previous one
  settles, so concurrent calls (`Promise.all([set(a), set(b)])`) never lose
  an update. A failed call rejects its own promise and the queue continues.
  `Date.now()` is read when the operation runs.
- **Debounced writes**: same as sync — read-your-writes from the pending
  snapshot, a timer that queues a flush, failures reported and kept for
  retry, `flush()` rejects on failure. Flushing on `pagehide` /
  `visibilitychange` is best-effort for async drivers (the browser may end
  the page before the write completes); documented.
- **Registry**: the existing `VaultRegistry` is shared by sync and async
  vaults (keyed by driver instance), so a sync and an async vault on the same
  key and driver conflict like two sync vaults. A newer vault takes over; the
  retired one finishes its queued work and flushes, and the newer vault's
  first operation waits for that.
- **Driver names**: one name registry for both kinds.
  `registerAsyncDriver(name, factory, options?)` registers an async factory;
  `createVault` rejects an async name with `StorageArgumentError` ("use
  createAsyncVault"); `createAsyncVault` accepts both kinds. `indexeddb` joins
  the reserved built-in names.

### 3.5 Shared vault logic (DRY, SRP)

The decisions each operation makes move out of `DefaultVault` into pure
functions in `src/vault/operations.ts`: given a snapshot, arguments and
`now`, return the result and, for writes, the next snapshot. Example:

```ts
interface Outcome<R> {
  result: R;
  next?: Snapshot;
}
function planSet(
  snapshot: Snapshot,
  key: string,
  value: unknown,
  options: SetOptions,
  now: number
): Outcome<void>;
function planUpdate(
  snapshot: Snapshot,
  key: string,
  value: unknown,
  now: number
): Outcome<boolean>;
```

`DefaultVault` and `DefaultAsyncVault` become thin I/O shells: get the
current snapshot, call the plan, commit `next` if present, return `result`.
The quota/size policy and quota-error detection shared by both repositories
move to `src/persistence/write-policy.ts`.

### 3.6 Conformance kit

`/testing` gains `verifyAsyncStorageDriver(create, options?)` and
`assertAsyncStorageDriver(create, options?)`, sharing the check bodies and
report type with the sync kit; the [async] rule replaces [sync]. Run against
`AsyncMemoryDriver` and `IndexedDBDriver` (fake-indexeddb in unit tests, real
Chromium in e2e).

## 4. Public API changes (all additive, main entry)

Runtime: `createAsyncVault`, `registerAsyncDriver`, `IndexedDBDriver`,
`AsyncMemoryDriver`, `BaseAsyncStorageDriver`.
Types: `AsyncVault`, `AsyncVaultOptions`, `AsyncStorageDriver`,
`AsyncDriverSpec`, `AsyncDriverFactory`, `AsyncCodec`,
`IndexedDBDriverOptions`, `BaseAsyncStorageDriverOptions`.
`/testing`: `verifyAsyncStorageDriver`, `assertAsyncStorageDriver`.
`unregisterDriver` works for names of either kind.

## 5. Error handling

Identical classes and policy to the sync vault. Additions:

| Situation                                                  | Result                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `createVault({ driver: 'indexeddb' })` (or any async name) | `StorageArgumentError`: use `createAsyncVault`                           |
| IndexedDB missing in a browser                             | Memory fallback + `StorageUnavailableError` reported                     |
| IndexedDB open/transaction failure                         | Operation rejects with `StorageAccessError` (cause = DOM error)          |
| IndexedDB quota                                            | Operation rejects with `StorageQuotaError` (deferred: reported)          |
| Async codec rejects on write                               | `StorageSerializationError`; on read → `StorageCorruptionError` reported |

## 6. Testing

TDD for every unit:

- operations: pure-function tests for every plan, then the full existing sync
  vault suite must stay green unchanged (refactor safety net).
- async codecs: ordering, awaiting, sync codecs accepted.
- async repository: the sync repository's cases, awaited (cache, external
  change, corruption once, maxBytes incl. shrink-over-limit, quota mapping,
  access errors).
- async strategies: immediate, debounced (fake timers), pending reads,
  deferred failure report + retry, page-hide flush.
- async vault: the sync vault's behaviour suite ported to async; concurrency
  (`Promise.all` of 50 mixed writes loses nothing; order preserved); method
  rejections are never synchronous throws; takeover waits for the retired
  vault; sync/async conflict on one key; async codec (Web Crypto shape)
  round-trip; sync driver objects and names work.
- IndexedDB driver (fake-indexeddb): kit passes, lazy open, versionchange
  close + reopen, failed open retried, quota error name preserved,
  namespace and custom database/store names.
- registry: async names, reserved `indexeddb`, `createVault` rejects async
  names, SSR silent fallback, missing `indexedDB` → report.
- tree-shaking: size-limit `import { createVault }` ≤ 5 KB proves the async
  code is dropped.
- e2e (Chromium, built bundle): IndexedDB persistence across reload, two
  tabs, kit against the real `IndexedDBDriver`, async vault on `'local'`.
