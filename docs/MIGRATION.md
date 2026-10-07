# Migrating from 1.x to 2.0

**Stored data needs no action, unless you used transforms.** 2.0 reads data
written by 1.x and upgrades it to the 2.0 format on the next write.
Downgrading to 1.x after a 2.0 write is not supported: 1.x cannot read the new
format.

If 1.x stored data through `transforms` (compression, encoding), configure the
same transforms as `codecs`, **in the same order**, before the vault first
reads. Otherwise the data cannot be decoded: the vault reports
`StorageCorruptionError`, reads it as empty, and the next write replaces it.

Data that 1.x stored above `maxSizeBytes` (which it only logged) stays
readable. Writes that would make it larger throw `StorageQuotaError`, but
removing or shrinking items works, so you can bring it under `maxBytes`.

`createVault` throws `StorageArgumentError` if it receives a 1.x option name
(`storageType`, `storageKey`, `maxSizeBytes`, `maxItemsInMemory`, `logger`,
`transforms`, `transformChain`), so a forgotten rename cannot silently send
data to the wrong place.

The code changes are mostly renames. The behaviour changes that matter:

- `getStorageSlice` returned a shared singleton. `createVault` returns a new
  vault, so create it once and export it.
- Writes are **immediate** by default (1.x debounced for 100 ms). Pass
  `debounceMs: 100` to keep the old timing.
- A write that does not fit now **throws** `StorageQuotaError`. In 1.x,
  `setItem` returned `true` while silently dropping the value.
- `maxBytes` is enforced. 1.x's `maxSizeBytes` only logged.

## Before and after

```ts
// 1.x
import { getStorageSlice, StorageType } from '@dariushstony/smart-storage';

const prefs = getStorageSlice('USER_PREFS', {
  storageType: StorageType.Session,
  logger: { log: (message, error) => report(message, error) },
});
prefs.setItem('token', 'abc', 60_000);
prefs.getRemainingTTL('token');
```

```ts
// 2.0
import { createVault } from '@dariushstony/smart-storage';

export const prefs = createVault({
  key: 'USER_PREFS',
  driver: 'session',
  onError: (error) => report(error.message, error),
});
prefs.set('token', 'abc', { ttl: 60_000 });
prefs.ttl('token');
```

## Full mapping

| 1.x                                                                               | 2.0                                                                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `getStorageSlice('K', opts)`                                                      | `createVault({ key: 'K', ...options })` with the options renamed as below. Create once and export the instance. |
| `disposeStorageSlice('K', opts)`                                                  | `vault.dispose()`                                                                                               |
| `StorageVault.getInstance({ storageKey })`                                        | `createVault({ key })`                                                                                          |
| `StorageVault.clearAllInstances()`                                                | Dispose each vault; in tests use `driver: 'memory'` or unique keys.                                             |
| `storageType: StorageType.Local / Session / InMemory`                             | `driver: 'local' / 'session' / 'memory'`                                                                        |
| `storageKey` (default `'APP_DATA'`)                                               | `key` (required)                                                                                                |
| `maxSizeBytes` (only logged)                                                      | `maxBytes` (enforced: throws `StorageQuotaError`)                                                               |
| `maxItemsInMemory` (memory only; soonest-expiring evicted)                        | `maxItems` (any driver; least recently written evicted)                                                         |
| `debounceMs` default `100`                                                        | default `0`; pass `debounceMs: 100` for the old behaviour                                                       |
| `logger: { log(message, error) }`                                                 | `onError(error: StorageError)`                                                                                  |
| `transforms: [...]` / `transformChain`                                            | `codecs: [{ encode, decode }]`                                                                                  |
| `{ serialize, deserialize }` transform                                            | `{ encode: serialize, decode: deserialize }`                                                                    |
| `class X extends TransformHandler { process; reverseProcess }`                    | `class X implements Codec { encode; decode }`                                                                   |
| `LoggingHandler`                                                                  | Removed; write a pass-through codec that logs if needed.                                                        |
| `new StorageStatistics(...).collect(...)`                                         | `vault.stats()`                                                                                                 |
| `setItem(k, v, ttl)` → `true`                                                     | `set(k, v, { ttl })` → `void`; throws on failure                                                                |
| `setItem(k, v, 0)` removed the item                                               | `ttl` must be `> 0`; use `remove(k)`                                                                            |
| `getItem(k)`                                                                      | `get(k)`                                                                                                        |
| `hasItem(k)`                                                                      | `has(k)`                                                                                                        |
| `updateItem(k, v)`                                                                | `update(k, v)`                                                                                                  |
| `extendTTL(k, ms)`; a permanent item became expiring                              | `extend(k, ms)`; a permanent item stays permanent                                                               |
| `getRemainingTTL(k)`; `null` for permanent items                                  | `ttl(k)`; `Infinity` for permanent, `null` for missing                                                          |
| `removeItem(k)`                                                                   | `remove(k)`                                                                                                     |
| `clear()` → `true`                                                                | `clear()` → `void`                                                                                              |
| `cleanupExpiredItems()`                                                           | `purgeExpired()`                                                                                                |
| `getAllKeys()`                                                                    | `keys()`                                                                                                        |
| `getAll()`                                                                        | `toObject()`                                                                                                    |
| `getCurrentSize()`                                                                | `stats().bytes`                                                                                                 |
| `getStorageKey()`                                                                 | `vault.key`                                                                                                     |
| `getStorageAdapter()`, `getTransformChain()`, `getMaxSizeBytes()`, `getAllData()` | Removed (internals).                                                                                            |
| Keys `__proto__`, `constructor`, `prototype` were rejected                        | Allowed and stored safely.                                                                                      |
| Reads deleted expired items from storage                                          | Reads never write; expired items are dropped on the next write.                                                 |
| At quota, `setItem` returned `true` and silently dropped the value                | `set` throws `StorageQuotaError`; stored data is unchanged.                                                     |

## Errors

1.x threw plain `Error`s with messages. 2.0 throws subclasses of
`StorageError`, each with a stable `code`, so you can branch with
`instanceof StorageQuotaError` or `error.code === 'QUOTA_EXCEEDED'`. See the
[Errors section of the README](../README.md#errors).

## Tests

1.x tests often called `StorageVault.clearAllInstances()` between cases.
In 2.0, give each test its own `new MemoryDriver()` (or a unique key) and
`dispose()` the vaults it creates.
