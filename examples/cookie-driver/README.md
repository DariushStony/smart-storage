# Cookie driver example

A complete custom storage driver, written only against the package's public
API. It is a worked example of
[docs/CUSTOM_STORAGE.md](../../docs/CUSTOM_STORAGE.md), not a recommendation:
cookies are limited to about 4 KB and are sent to the server with every HTTP
request, so prefer `localStorage` in real apps.

## What it shows

- **Extending `BaseStorageDriver`.** Only `readRaw`, `writeRaw` and
  `removeRaw` are implemented. The base class adds the optional `namespace`
  prefix (`myapp:PREFS`).
- **The contract rules in practice.** `readRaw` returns `null` for a missing
  cookie and the exact string otherwise. `removeRaw` is idempotent. Keys and
  values are URI-encoded so any characters work.
- **Quota mapping.** A cookie over 4,096 characters makes `writeRaw` throw a
  `DOMException` named `QuotaExceededError`, so `vault.set()` throws
  `StorageQuotaError`.
- **Availability.** Without `document` (server rendering) the constructor
  throws. A factory registered with `registerDriver` then falls back to
  memory and reports `StorageUnavailableError`.

## Use it

```ts
import { createVault, registerDriver } from '@dariushstony/smart-storage';
import { CookieDriver } from './cookie-driver';

registerDriver('cookie', () => new CookieDriver({ namespace: 'myapp' }));

export const consent = createVault({ key: 'CONSENT', driver: 'cookie' });
consent.set('analytics', false);
```

## Its tests

[`tests/unit/examples/cookie-driver.test.ts`](../../tests/unit/examples/cookie-driver.test.ts)
runs the conformance kit against it:

```ts
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';

await assertStorageDriver(() => new CookieDriver({ namespace: 'test' }), {
  largeValueLength: 1_000, // cookies cannot hold the default 64 KB
});
```

The kit caught a real bug while this example was being written: some engines
ignore `max-age=0`, so a "removed" cookie still read as `""`. `removeRaw` now
also sets a past `expires` date.
