# 0003: Quota failures throw

Status: Accepted (2026-10-07)

## Context

In 1.x, a write that hit the quota triggered a cleanup and a retry that
re-read the _previously persisted_ data, without the new value. The smaller
payload fit, so `setItem` returned `true` while silently discarding the
caller's data. `maxSizeBytes` only logged.

## Decision

A write that does not fit `maxBytes` or the browser quota throws
`StorageQuotaError` and leaves storage unchanged. There is no cleanup-and-retry:
every write already persists a compacted snapshot (expired items dropped), so a
retry could not free anything more. `maxBytes` is a hard limit.

## Consequences

No silent data loss. Callers that write large or unbounded data must handle
`StorageQuotaError`. Debounced writes cannot throw, so they report it to
`onError` and `flush()` throws it (see 0004).
