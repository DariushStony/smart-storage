# 0001: Ports and adapters

Status: Accepted (2026-10-07)

## Context

1.x concentrated singleton management, TTL, debouncing, quota recovery,
serialization and item caps in one ~700-line `StorageVault` class. Its
`LocalStorage` and `SessionStorage` adapters were byte-for-byte copies, and the
storage interface leaked its backing object, so the vault branched on
`instanceof Map`. Planned features (IndexedDB, events, cross-tab sync) would
all have landed in that one class.

## Decision

Split the library into a pure `core` (entries, snapshots, envelope), a
`StorageDriver` port with small adapters, a `persistence` layer (serializer,
repository, write strategies) and a `Vault` facade assembled by
`createVault()`. Dependencies point inward; nothing below the vault knows the
concrete driver or strategy.

## Consequences

Each unit is small and tested on its own. An async driver becomes an addition
(async repository and vault) rather than a rewrite, because the core and the
serializer are I/O-free. The cost is more files and a composition root to
read.
