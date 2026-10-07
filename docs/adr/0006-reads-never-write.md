# 0006: Reads never write

Status: Accepted (2026-10-07)

## Context

1.x `getItem`, `hasItem` and `getRemainingTTL` deleted expired items and saved
the result, so a read could trigger a write, a quota error, or a cross-tab
overwrite.

## Decision

Queries are side-effect free (command–query separation). Expired items are
hidden from reads at once and dropped from storage when the next write
compacts the snapshot. Unreadable stored data is reported and read as empty,
but left in place until a write replaces it.

## Consequences

Reads are cheap and safe. Expired bytes stay in storage until the next write;
`purgeExpired()` removes them on demand.
