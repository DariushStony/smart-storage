# 0004: Immediate writes by default

Status: Accepted (2026-10-07)

## Context

1.x debounced every write by 100 ms. A deferred write cannot throw to the
caller, so with throwing quota errors (0003) a default debounce would turn
every quota failure into a background report that is easy to miss.

## Decision

`debounceMs` defaults to `0`: each change is written at once and failures
throw from the call that caused them. Debouncing is opt-in. Its failures go to
`onError`, the snapshot is kept for a retry, `flush()` throws, and pending
writes are flushed on `pagehide` and `visibilitychange`.

## Consequences

Chatty callers do more writes unless they opt in. In exchange, the default
is predictable: when `set()` returns, the data is stored.
