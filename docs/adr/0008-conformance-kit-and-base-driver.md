# 0008: Specified driver contract, conformance kit and base driver

Status: Accepted (2026-10-08)

## Context

The `StorageDriver` interface said _what_ methods exist but not how they must
behave. A driver could return `undefined` for a missing key, drop empty
strings, or break on `__proto__`, and the vault would misbehave in ways that
are hard to trace back to the driver (a Liskov substitution failure).

## Decision

The contract is written down as twelve rules with ids. A runner-agnostic kit,
`verifyStorageDriver` / `assertStorageDriver`, checks each rule against fresh
driver instances and is published as a separate `/testing` entry, so test
code never ships in app bundles. `BaseStorageDriver` is a Template Method:
subclasses implement three protected raw methods, and the base adds an
optional key namespace. The built-in drivers extend it.

## Consequences

Implementers get a definition of "correct" and a one-line test that proves
it. The kit caught two real defects while it was being built: happy-dom's
object-backed `localStorage` and the example cookie driver's `remove`. Two
rules (quota error name, throwing on failure) remain documented only, because
no generic check can force a backend to run out of space.
