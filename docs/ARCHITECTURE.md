# Architecture

For contributors. The README covers usage; the [ADRs](./adr/) record why the
design is what it is.

## Layers

The library is built as ports and adapters: a pure core, a driver port with
adapters for each backend, a persistence layer, and a vault facade that
`createVault()` assembles.

```text
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

**Dependency rule:** `core` imports only `errors`. `codec` imports nothing.
`persistence` imports `core`, `codec`, the driver port and `errors`. `vault`
composes everything. Nothing below `vault` knows which concrete driver or
write strategy is in use.

## Units

| Unit                              | Does                                                                      | Depends on               |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------ |
| `errors.ts`                       | `StorageError` and its subclasses, each with a stable `code`              | —                        |
| `core/entry.ts`                   | `Entry` (value as JSON text + `expiresAt`), expiry math, `toJson`         | errors                   |
| `core/snapshot.ts`                | Immutable map of entries; `with`, `without`, `live`, `compact`            | entry                    |
| `core/envelope.ts`                | Encode format v2; decode v2 and 1.x                                       | snapshot                 |
| `core/validation.ts`              | Key, TTL and option checks                                                | errors                   |
| `core/byte-size.ts`               | UTF-8 length without allocating                                           | —                        |
| `codec/codec.ts`                  | `Codec` interface and `composeCodecs`                                     | —                        |
| `drivers/storage-driver.ts`       | The `StorageDriver` port: `read`, `write`, `remove`                       | —                        |
| `drivers/web-storage-driver.ts`   | Adapter for `localStorage` / `sessionStorage`                             | port                     |
| `drivers/memory-driver.ts`        | `Map` adapter for SSR and tests                                           | port                     |
| `drivers/resolve-driver.ts`       | `'local' \| 'session' \| 'memory'` → driver, with memory fallback         | adapters, errors         |
| `persistence/snapshot-serializer` | Snapshot ↔ stored string (envelope + codecs), pure                        | core, codec              |
| `persistence/snapshot-repository` | Load/save via a driver; raw-string cache; `maxBytes`; quota → typed error | serializer, port, errors |
| `persistence/write-strategy`      | `ImmediateWriteStrategy`, `DebouncedWriteStrategy`                        | repository, lifecycle    |
| `persistence/page-lifecycle`      | `pagehide` / `visibilitychange` subscription; no-op on the server         | —                        |
| `reporting/reporter.ts`           | Calls `onError`, swallowing anything it throws                            | errors                   |
| `vault/default-vault.ts`          | The `Vault` facade: one read path, one write path                         | everything above         |
| `vault/registry.ts`               | One live vault per (driver, key); newer takes over                        | port                     |
| `vault/create-vault.ts`           | Composition root                                                          | everything               |

## Data flow

**Read** (`get`): `current()` returns the pending snapshot of a debounced
vault, or `repository.load()`. `load()` reads the raw string; if it equals the
last string seen it reuses the cached snapshot, otherwise it decodes (so
writes from other tabs are seen). Then `snapshot.get(key, now)` hides expired
entries, and `JSON.parse(entry.json)` returns a fresh copy. Reads never write.

**Write** (`set`): validate → `toJson(value)` (serialization errors surface
here, even when debounced) → `current().with(key, entry)` →
`compact(now, maxItems)` (drop expired, evict least recently written) →
`strategy.write`. The immediate strategy serializes, checks `maxBytes`, and
writes through the driver; a quota `DOMException` becomes `StorageQuotaError`.
Snapshots are immutable, so a failed write leaves the previous state intact.

**1.x data**: `decodeEnvelope` recognises a 1.x record (no numeric `v`) and
converts `expiry` to `expiresAt`; the next write stores format v2.

## Error policy

An error is either thrown to the caller or passed to `onError`, never both.
Thrown: invalid arguments, quota, serialization, access, disposed. Reported:
corrupted data (read as empty), Web Storage unavailable (memory fallback),
registry conflicts, and failures of deferred (debounced) writes. `flush()`
rethrows a pending failure.

## Extension points

Not implemented, but the design leaves room for them:

- **Async drivers (IndexedDB) and async codecs (Web Crypto):** add an
  `AsyncStorageDriver`, an async repository and an `AsyncVault`; `core/*`,
  `codec/*` and `SnapshotSerializer` are reused unchanged.
- **Change events:** emit from `DefaultVault.commit`, diffing the old and new
  snapshots.
- **Cross-tab sync:** an optional `subscribe` capability on drivers (the web
  `storage` event). The repository's raw-string cache already picks up external
  writes on read.
- **Typed keys:** `vault.key<T>(name, { validate })` as a thin wrapper over
  `get` / `set`.

## Where to start reading

1. `src/vault/create-vault.ts`: how the pieces are wired.
2. `src/vault/default-vault.ts`: what each public method does.
3. `src/persistence/snapshot-repository.ts`: everything that touches storage.
4. `src/core/snapshot.ts`: the data model.
