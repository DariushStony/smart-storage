# Documentation

- [README](../README.md): installation, API, options, errors, codecs, drivers
- [Migrating from 1.x](./MIGRATION.md)
- [Adding a new storage backend](./CUSTOM_STORAGE.md): the driver contract (sync and async), base classes, conformance kit and registry
- [Architecture](./ARCHITECTURE.md): layers, units, data flow, extension points
- Decision records:
  - [0001: Ports and adapters](./adr/0001-ports-and-adapters.md)
  - [0002: Explicit factory with registry takeover](./adr/0002-factory-with-registry-takeover.md)
  - [0003: Quota failures throw](./adr/0003-quota-failures-throw.md)
  - [0004: Immediate writes by default](./adr/0004-immediate-writes-by-default.md)
  - [0005: Versioned envelope with JSON-text entries](./adr/0005-versioned-envelope-with-json-entries.md)
  - [0006: Reads never write](./adr/0006-reads-never-write.md)
  - [0007: Driver registry](./adr/0007-driver-registry.md)
  - [0008: Specified driver contract, conformance kit and base driver](./adr/0008-conformance-kit-and-base-driver.md)
  - [0009: Async vault in the main entry](./adr/0009-async-vault.md)
- [Example](../examples/vanilla-js/): a page that drives the built bundle
- [Example driver](../examples/cookie-driver/): a complete custom driver, tested with the kit
