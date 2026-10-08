# 0009: Async vault in the main entry

Status: Accepted (2026-10-08)

## Context

IndexedDB, React Native AsyncStorage and remote stores answer
asynchronously, so they cannot sit behind the synchronous `StorageDriver`
port. The async vault must keep the sync vault's semantics without
duplicating its logic, must not lose updates when callers fire several
operations at once, and must not grow the bundle of apps that only use
`createVault`.

## Decision

- **Shared logic.** Each operation's decision moves into pure `Operation`s
  shared by both vaults, and only I/O differs.
- **Ordering.** An `OperationQueue` runs async calls one at a time. Debounced
  flushes go through the same queue.
- **No adapter.** The async repository awaits every driver call, so sync
  drivers plug in without one.
- **One registry.** A single vault registry serves both kinds. A newer async
  vault waits for the retired vault's flush.
- **Main entry.** Everything ships from the main entry, not a separate
  `/async` entry. Two entries would each bundle their own error classes, so
  `instanceof StorageQuotaError` would fail across them, and tsup cannot
  share chunks in the CJS build.
- **Tree-shaking.** `'indexeddb'` is resolved in a module only the async
  vault imports, so sync-only bundles drop it. size-limit checks this.

## Consequences

Both vaults behave identically by construction, and concurrent async calls
cannot interleave. Importing only `createVault` stays under 5 kB. Debounced
flushes on page hide are best-effort for async drivers, because the browser
may end the page first. A sync vault that takes over from a debounced async one cannot wait for the
async flush. That flush may land after the sync vault's first writes and
overwrite them. The conflict is reported; don't use one key from both vault
kinds.
