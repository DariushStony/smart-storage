# 0002: Explicit factory with registry takeover

Status: Accepted (2026-10-07)

## Context

1.x handed out global singletons per `type-key` pair. Options passed on later
calls (logger, transforms, limits) were silently ignored. Comparing options
instead does not work: under hot module reloading, inline codec objects are
new on every evaluation, so identical configurations would look different.

## Decision

`createVault(options)` always builds a new vault. A registry tracks one live
vault per (driver, key). When a second vault claims a key, the newer one takes
over: the older one flushes, is disposed, and throws `StorageDisposedError` on
later calls, and the newer one reports `StorageConflictError`.

## Consequences

Callers create a vault once and share it. Hot module reloading keeps working.
Genuine double use fails loudly on the retired instance instead of corrupting
data. `'memory'` vaults each have their own store and never conflict.
