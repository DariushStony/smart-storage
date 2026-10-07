# 0005: Versioned envelope with JSON-text entries

Status: Accepted (2026-10-07)

## Context

1.x stored `{ [key]: { value, expiry } }` with no version field, so the format
could not evolve. User keys became object properties, so `__proto__` and
friends had to be banned. Values were held as live objects, which let callers
mutate stored state through returned references.

## Decision

Store `{"v":2,"items":[{"key","value","expiresAt"?}]}`. Keys are data in an
array, so they are prototype-safe and keep their order. Each entry keeps its
value as JSON text: serializability is checked at `set()`, `get()` parses a
fresh copy, and a write splices existing JSON instead of re-stringifying it.
A decoder for 1.x records stays in `core/envelope.ts`.

## Consequences

1.x data is read and upgraded on the next write. 1.x cannot read v2, so
downgrading after a 2.0 write is not supported. Loading a blob costs one
re-stringify per item.
