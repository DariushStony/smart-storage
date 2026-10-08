# smart-storage v2 — Rewrite Design

**Date:** 2026-10-07 · **Status:** Approved design, pending spec review · **Branch:** `refactor/v2-rewrite`

## 1. Goal

Rewrite `@dariushstony/smart-storage` from scratch on explicit engineering
principles (SOLID, small single-purpose units, ports & adapters) and ship it as
**v2.0.0** (breaking). Same capability set as 1.x — no new features — but the
architecture must let three planned features land later without a rewrite:
async drivers (IndexedDB), change events / cross-tab sync, typed keys.

### Decisions already made

| Topic             | Decision                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| API compatibility | Breaking, v2.0.0, with `docs/MIGRATION.md`.                                                                                 |
| Stored data       | Data written by 1.x **must** still be readable; it is migrated to the v2 format on the next write.                          |
| Sync vs async     | Sync API now. Core stays I/O-free so an async driver/vault can be added later.                                              |
| New features      | None in this PR. Architecture leaves extension points only.                                                                 |
| Instances         | Explicit factory `createVault()`; no global singleton getter. A registry guards against two live vaults on one storage key. |
| Quota             | A write that does not fit throws a typed `StorageQuotaError`; state is never silently dropped. Fixes the 1.x known defect.  |
| Write timing      | Immediate by default. Debouncing is opt-in (`debounceMs > 0`); deferred failures go to `onError`, and `flush()` throws.     |
| Architecture      | Ports & Adapters (hexagonal).                                                                                               |
| Tooling           | Keep tsup / Vitest / Playwright / oxlint / Prettier / semantic-release / CI. Rewrite docs.                                  |

### Non-goals

Async API, IndexedDB, events/subscribe, cross-tab sync, typed keys/schemas,
encryption helpers, framework bindings.

## 2. Problems in 1.x this design removes

1. `StorageVault` is a ~700-line god class (singleton registry, TTL, debounce,
   quota recovery, serialization, item caps, stats accessors).
2. `LocalStorage` and `SessionStorage` are byte-for-byte duplicates.
3. `IStorage.getStorage()` leaks the backing object; the vault branches on
   `instanceof Map` (LSP/DIP violation).
4. Global singletons keyed by `type-key`; options of later calls (logger,
   transforms, limits) are silently ignored.
5. **Known defect:** on quota, the retry re-reads the _old_ persisted state, so
   `setItem` returns `true` while discarding the new value.
6. Reads mutate storage (expired items are deleted and re-saved inside `getItem`).
7. Every read re-parses the whole blob; values handed out alias internal state in
   debounced mode.
8. `maxSizeBytes` only logs; it is not a limit.
9. Transform chain is a hand-rolled doubly linked list of abstract classes for
   what is function composition. Docs advertise Web Crypto, which is async and
   cannot work with a sync chain.
10. `StorageStatistics` needs four internals passed in by hand.
11. Unit tests fail on Node ≥ 25: Node's built-in `localStorage` global shadows
    happy-dom's.

## 3. Architecture

```
            ┌──────────────────────── public API ────────────────────────┐
            │ createVault(options) → Vault        errors, types, drivers │
            └───────────────┬────────────────────────────────────────────┘
                            │ composition root
   ┌────────────────────────▼─────────────────────────┐
   │ vault/      DefaultVault (facade) · VaultRegistry │
   └───────┬──────────────────────┬───────────────────┘
           │                      │
   ┌───────▼────────┐   ┌─────────▼────────────────────────────────┐
   │ core/ (pure)   │   │ persistence/                             │
   │ Entry, TTL     │   │ SnapshotSerializer (pure: envelope+codec)│
   │ Snapshot       │   │ SnapshotRepository (I/O, cache, quota)   │
   │ envelope v1/v2 │   │ WriteStrategy: Immediate | Debounced     │
   │ validation     │   │ PageLifecycle (pagehide port)            │
   └────────────────┘   └─────────┬────────────────────────────────┘
                                  │ port
                       ┌──────────▼───────────┐
                       │ drivers/             │
                       │ StorageDriver (port) │
                       │ WebStorageDriver     │
                       │ MemoryDriver         │
                       │ resolveDriver        │
                       └──────────────────────┘
```

Dependency rule: `core` imports only `errors`; `codec` imports nothing;
`persistence` imports `core`, `codec`, `drivers` (port only), `errors`;
`vault` composes everything. Nothing below `vault` knows which concrete driver
or strategy is in use.

### 3.1 Source layout

```
src/
  index.ts                       public surface only
  errors.ts                      StorageError hierarchy
  core/
    entry.ts                     Entry type, isExpired, remainingTtl
    snapshot.ts                  immutable Snapshot + compaction
    envelope.ts                  encode v2 / decode v1+v2
    validation.ts                key/ttl/option assertions
    byte-size.ts                 utf8ByteLength
  codec/
    codec.ts                     Codec interface, composeCodecs
  drivers/
    storage-driver.ts            StorageDriver port
    memory-driver.ts
    web-storage-driver.ts
    resolve-driver.ts            factory + memory fallback
  persistence/
    snapshot-serializer.ts       Snapshot ↔ string (envelope + codecs)
    snapshot-repository.ts       load/save via driver, raw-string cache
    write-strategy.ts            WriteStrategy, Immediate, Debounced
    page-lifecycle.ts            PageLifecycle port + browser impl
  reporting/
    reporter.ts                  safe onError wrapper
  vault/
    vault.ts                     Vault interface + public option/stat types
    options.ts                   defaults + option validation
    default-vault.ts             Vault implementation
    registry.ts                  one live vault per (driver, key)
    create-vault.ts              composition root
```

### 3.2 Units

**`core/entry.ts`** — `Entry = { readonly json: string; readonly expiresAt: number | null }`.
Values are stored as their JSON text, not as live objects. Consequences:
serializability is checked at `set()` time (even when debounced), `get()` always
returns a fresh copy (no aliasing), and a write only stringifies the changed value.
Helpers: `isExpired(entry, now)`, `remainingTtl(entry, now)`.

**`core/snapshot.ts`** — `Snapshot` wraps a `ReadonlyMap<string, Entry>`;
every operation returns a new snapshot (copy-on-write → rollback is free).
Map order = least-recently-written first (a write deletes then re-inserts).
Operations: `get`, `with(key, entry)`, `without(key)`, `live(now)` (iterator of
non-expired), `compact(now, maxItems)` (drops expired, then evicts
least-recently-written until `size ≤ maxItems`).

**`core/envelope.ts`** — on-disk format v2:

```json
{
  "v": 2,
  "items": [
    { "key": "theme", "value": "dark" },
    { "key": "token", "value": "x", "expiresAt": 1767225600000 }
  ]
}
```

An array of items, not an object keyed by user keys: order survives a round
trip, and keys such as `__proto__` are plain data (the 1.x dangerous-key ban is
dropped). `expiresAt` is omitted when the item never expires. `encodeEnvelope`
builds the string by concatenating each entry's stored JSON (no re-stringify of
values). `decodeEnvelope(text)` returns `{ snapshot, dropped }`:

- `{v: 2, items: [...]}` → v2.
- any other plain object → v1 (`{ [key]: { value, expiry: number|null } }`).
- invalid items are dropped and counted; unparseable text, arrays, primitives
  and unknown versions throw (caller treats as corruption).

**`core/validation.ts`** — key: non-empty string after trim. TTL: finite, `> 0`.
`debounceMs`: finite, `≥ 0`. `maxBytes`: finite, `> 0`. `maxItems`: integer
`≥ 1` or `Infinity`. Violations throw `StorageArgumentError`.

**`core/byte-size.ts`** — UTF-8 byte length without allocation (surrogate-aware loop).

**`codec/codec.ts`** — `interface Codec { encode(text: string): string; decode(text: string): string }`.
`composeCodecs(codecs)` encodes left→right and decodes right→left; empty list =
identity. Replaces `TransformHandler`/`TransformChain`/`InlineTransformHandler`.

**`drivers/storage-driver.ts`** — the port:

```ts
interface StorageDriver {
  readonly name: string;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}
```

No `getStorage()`, no availability flag, no unload hooks (those moved to
`PageLifecycle`). Drivers do raw string I/O only.

**`WebStorageDriver(storage: Storage, name)`** — one class for local and
session. **`MemoryDriver`** — `Map`-backed, name `"memory"`.

**`resolveDriver(spec, report)`** — `'local' | 'session' | 'memory' | StorageDriver`.

- `'local'`/`'session'`: one shared driver per kind per realm (so the registry
  can see conflicts). If `typeof window === 'undefined'` (SSR) → shared
  `MemoryDriver`, silently. If accessing `window.localStorage` throws or yields
  nothing → shared `MemoryDriver` and report `StorageUnavailableError`.
  `window` is checked, not `globalThis`, so Node ≥ 25's built-in `localStorage`
  is never picked up on the server.
- `'memory'`: a new `MemoryDriver` per vault.
- object: used as-is.

**`persistence/snapshot-serializer.ts`** — pure: `serialize(snapshot)` =
`codec.encode(encodeEnvelope(snapshot))`; `deserialize(text)` =
`decodeEnvelope(codec.decode(text))`. Codec exceptions on serialize become
`StorageSerializationError`. This, plus `core`, is everything a future async
vault reuses unchanged.

**`persistence/snapshot-repository.ts`** — owns `(driver, key, serializer, maxBytes, report)`.

- `load()`: read raw; if `raw === lastRaw` return the cached snapshot
  (no decode, no parse); else deserialize and cache. Failure to decode →
  report `StorageCorruptionError` once for that raw string, return empty.
  Dropped items → report once. Storage is **not** modified on read.
  Because the raw string is compared on every load, writes from other tabs are
  still seen.
- `save(snapshot)`: serialize; if `utf8ByteLength > maxBytes` throw
  `StorageQuotaError` (with `bytes`, `maxBytes`); `driver.write`; a quota
  `DOMException` (name `QuotaExceededError` / `NS_ERROR_DOM_QUOTA_REACHED`,
  duck-typed) → `StorageQuotaError`; other driver errors → `StorageAccessError`.
  On success update the cache. On failure nothing is cached, so the previous
  state stands.
- `remove()`: delete key, reset cache.
- `measure(snapshot)`: byte size for stats.

There is no "cleanup and retry" on quota: every save already writes a compacted
snapshot (expired items dropped), so a retry could never free more. That removes
the 1.x defect at its root.

**`persistence/write-strategy.ts`** — Strategy:

```ts
interface WriteStrategy {
  write(snapshot: Snapshot): void;
  pending(): Snapshot | null; // read-your-writes
  flush(): void;
  discard(): void; // drop pending without writing (clear())
  dispose(): void;
}
```

- `ImmediateWriteStrategy`: `write` = `repository.save`; errors propagate.
- `DebouncedWriteStrategy(repository, ms, lifecycle, report)`: holds the
  latest snapshot, (re)arms a timer; timer failures → `report(error)` and keep
  the snapshot for the next attempt; `flush()` saves now and throws; registers
  `lifecycle.onHide(flush-and-report)`.

**`persistence/page-lifecycle.ts`** — `interface PageLifecycle { onHide(cb): () => void }`.
Browser impl listens to `pagehide` and `visibilitychange` → `hidden`
(the latter is the reliable signal on mobile Safari). SSR impl is a no-op.

**`reporting/reporter.ts`** — `createReporter(onError)` returns a function that
calls `onError` and swallows anything it throws. Default: no-op.

**`vault/default-vault.ts`** — implements `Vault`; holds `key`, repository,
strategy, `maxItems`, report, disposed flag. Single read path
`current() = strategy.pending() ?? repository.load()`; single write path
`commit(next) = strategy.write(next.compact(Date.now(), maxItems))`. The commit
point is where change events will be emitted later.

**`vault/registry.ts`** — `WeakMap<StorageDriver, Map<string, DefaultVault>>`.
`claim(driver, key, vault)`: if a live vault already holds that key, the
**newcomer takes over**: the old one is flushed (errors reported) and disposed
with reason "replaced", and the new vault reports `StorageConflictError`.
`release` on dispose. Rationale below (§6).

**`vault/create-vault.ts`** — composition root: validate options → reporter →
driver → serializer → repository → strategy → vault → registry claim.

## 4. Public API

```ts
import { createVault, StorageQuotaError } from '@dariushstony/smart-storage';

const prefs = createVault({
  key: 'USER_PREFS', // required: the storage key this vault owns
  driver: 'local', // 'local' | 'session' | 'memory' | StorageDriver  (default 'local')
  codecs: [], // Codec[]: applied after JSON, reversed on read
  debounceMs: 0, // 0 = write immediately (default)
  maxBytes: 4_000_000, // hard limit on the stored string (default 4 MB)
  maxItems: Infinity, // evict least-recently-written beyond this
  onError: (error) => {}, // problems the caller cannot otherwise see
});
```

| Method                         | Returns                   | Notes                                                                    |
| ------------------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `get<T>(key)`                  | `T \| null`               | Fresh copy. Expired → `null`. Never writes.                              |
| `set<T>(key, value, { ttl? })` | `void`                    | Throws on invalid args, unserializable value, quota.                     |
| `has(key)`                     | `boolean`                 |                                                                          |
| `update<T>(key, value)`        | `boolean`                 | Keeps expiry. `false` if missing/expired.                                |
| `extend(key, ms)`              | `boolean`                 | Adds `ms` to remaining TTL; a non-expiring item stays non-expiring.      |
| `ttl(key)`                     | `number \| null`          | Remaining ms; `Infinity` if it never expires; `null` if missing/expired. |
| `remove(key)`                  | `boolean`                 |                                                                          |
| `keys()`                       | `string[]`                | Live keys, least-recently-written first.                                 |
| `toObject()`                   | `Record<string, unknown>` | Live items; built with `Object.fromEntries` (prototype-safe).            |
| `clear()`                      | `void`                    | Removes the storage key; drops pending writes.                           |
| `purgeExpired()`               | `number`                  | Persists a compacted snapshot; returns removed count.                    |
| `flush()`                      | `void`                    | Throws if the pending write fails.                                       |
| `stats()`                      | `VaultStats`              | `{ key, driver, itemCount, bytes, maxBytes, usage }` (`usage` 0..1).     |
| `dispose()`                    | `void`                    | Flush (errors reported), detach listeners, release key. Idempotent.      |
| `key` (readonly)               | `string`                  |                                                                          |

Every method on a disposed vault throws `StorageDisposedError` (except `dispose`).

`set(key, undefined)` throws `StorageArgumentError` (JSON would drop it);
values JSON cannot represent (functions, symbols, `BigInt`, cycles) throw
`StorageSerializationError` at `set()` time.

### Errors

`StorageError extends Error` with a `code` and optional `cause`, and explicit
`name` strings (minification-safe).

| Class                       | `code`             | Thrown or reported                               |
| --------------------------- | ------------------ | ------------------------------------------------ |
| `StorageArgumentError`      | `INVALID_ARGUMENT` | thrown                                           |
| `StorageQuotaError`         | `QUOTA_EXCEEDED`   | thrown (reported when the write was deferred)    |
| `StorageSerializationError` | `SERIALIZATION`    | thrown (reported when the write was deferred)    |
| `StorageAccessError`        | `ACCESS`           | thrown (reported when the write was deferred)    |
| `StorageDisposedError`      | `DISPOSED`         | thrown                                           |
| `StorageCorruptionError`    | `CORRUPTED`        | reported; data treated as empty                  |
| `StorageUnavailableError`   | `UNAVAILABLE`      | reported; vault falls back to memory             |
| `StorageConflictError`      | `CONFLICT`         | reported; previous vault on the key was replaced |

Rule: an error is either thrown to the caller or passed to `onError`, never both.

### Exports

Runtime: `createVault`, the nine error classes, `MemoryDriver`, `WebStorageDriver`.
Types: `Vault`, `VaultOptions`, `VaultStats`, `SetOptions`, `Codec`,
`StorageDriver`, `DriverSpec`, `StorageErrorCode`, plus the constructor
parameter types `WebStorageLike`, `StorageErrorOptions` and
`StorageQuotaErrorOptions`.

Removed: `getStorageSlice`, `disposeStorageSlice`, `StorageVault`,
`StorageType`, `TransformChain`, `TransformHandler`, `InlineTransformHandler`,
`LoggingHandler`, `StorageStatistics`, `StorageLogger`, `IStorage`, and the
1.x option names. Each gets a mapping in `docs/MIGRATION.md`.

## 5. Data flow

**Read** (`get`): `current()` → pending snapshot, else `repository.load()`
(raw read → cache hit, or decode) → `snapshot.get(key)` → expired? `null` :
`JSON.parse(entry.json)`.

**Write** (`set`): validate → `JSON.stringify(value)` (serialization error
here) → `current().with(key, entry)` → `compact(now, maxItems)` →
`strategy.write`. Immediate: serialize → size check → driver write → cache.
Any failure throws and the committed state is unchanged.

**Migration**: first `load()` of a 1.x blob decodes it as v1; the next write
persists v2. Expiry semantics are identical (`expiry` → `expiresAt`, epoch ms).

## 6. Decisions changed during spec writing

1. **Registry takeover instead of "throw on incompatible options".** Comparing
   options cannot work for codecs: under HMR, inline codec objects are new on
   every module evaluation, so identical configs would look incompatible and
   break dev reloads. Takeover is simpler and handles HMR correctly: the new
   vault wins, the stale one is flushed and disposed, and a conflict is
   reported. Genuine double use still fails loudly: the old instance throws
   `StorageDisposedError` on its next call.
2. **Reads never write** (command–query separation). Expired items are filtered
   on read and physically removed on the next write.
3. **`maxItems` evicts least-recently-written** (1.x evicted soonest-expiring
   and applied only to memory). Soonest-expiring could evict the item being
   written by that same call — a silent loss.

## 7. Extension points (not implemented)

- **Async drivers / IndexedDB:** add `AsyncStorageDriver`, `AsyncSnapshotRepository`,
  `AsyncVault`; reuse `core/*`, `codec/*`, `SnapshotSerializer` unchanged.
  Async codecs (Web Crypto) become possible there.
- **Events:** emit from `DefaultVault.commit`; diff old vs new snapshot.
- **Cross-tab:** optional `subscribe` capability on drivers (web `storage` event);
  the repository's raw-string cache already handles external writes on read.
- **Typed keys:** `vault.item<T>(name, { validate })` (not `key`, which is
  already the vault's storage key) as a thin wrapper over
  `get`/`set`.

## 8. Testing

TDD per unit. Unit tests (Vitest + happy-dom) mirror `src/`:

- core: TTL math, snapshot immutability/compaction/eviction order, envelope
  round-trips (unicode, quotes, `__proto__`, ordering), v1 decoding incl.
  invalid entries, unknown version, byte size.
- codec: order of encode/decode, identity.
- drivers: memory/web round-trips; `resolveDriver` SSR, throwing getter →
  fallback + report, shared instance per kind.
- persistence: cache hit avoids decode; external change detected; corruption
  reported once and storage untouched; maxBytes and DOMException quota →
  `StorageQuotaError` with previous state intact (the 1.x known defect as a
  normal passing test); debounced timer, read-your-writes, deferred failure
  reported and retried, pagehide flush, `flush()` throws.
- vault: every public method, disposed behaviour, registry takeover.
- public API: exact export list.

Fix Node ≥ 25 by passing `--no-experimental-webstorage` to Vitest workers.
Coverage thresholds set to the achieved level (≥ 95% lines) and enforced.

E2E (Playwright, real Chromium, built bundle): persistence across reload,
session vs local, debounced flush on real navigation (`pagehide`), real quota
→ `StorageQuotaError` with prior data intact, 1.x blob migrated in a real
browser.

## 9. Docs, tooling, release

- `README.md` rewritten. `docs/` reduced to `ARCHITECTURE.md`, `MIGRATION.md`,
  and `docs/adr/` (one ADR per decision in §1/§6). Removed:
  `HOW_TO_USE_STORAGE.md`, `SINGLETON_PATTERN_VISUAL.md`,
  `STORAGE_ARCHITECTURE.md`, `STRUCTURE.md`. `examples/vanilla-js` updated.
- Tooling unchanged; size limit stays 5 KB (1.x: 3.13 KB).
- Branch `refactor/v2-rewrite`, small conventional commits, one PR to `main`
  titled `feat!: …` with a `BREAKING CHANGE:` footer. Merging triggers
  semantic-release → 2.0.0. Note: npm publishing under `@dariushstony` is
  currently blocked (open npm ticket), so the release job may fail after merge.
- Nothing is pushed to `main`.
