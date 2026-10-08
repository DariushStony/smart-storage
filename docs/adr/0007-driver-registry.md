# 0007: Driver registry

Status: Accepted (2026-10-08)

## Context

Version 2.0 resolved `'local'`, `'session'` and `'memory'` with a hard-coded
switch. A new backend could be passed as an instance, but not named the way
the built-ins are, and every new built-in meant editing that switch (an
Open/Closed violation).

## Decision

Drivers are looked up in a registry: `registerDriver(name, factory, { shared })`.
The built-ins register the same way. Shared drivers (the default) are built
once per name, so the vault registry can detect two vaults on one key; the
built-in `memory` opts out. A factory that throws means "not available here":
vaults fall back to memory and report `StorageUnavailableError` to every
vault that resolves the name. Built-in names are reserved. Registering a
custom name again replaces it.

## Consequences

A new backend is added without touching package code. Re-registering a name
replaces it rather than failing, so hot module reloading works. The registry
is module state, shared per JavaScript realm; tests reset it with an internal
hook. Unknown names fail at `createVault` with an error that points at
`registerDriver`.
