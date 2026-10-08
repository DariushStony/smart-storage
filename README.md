# @dariushstony/smart-storage

[![npm version](https://badge.fury.io/js/@dariushstony%2Fsmart-storage.svg)](https://www.npmjs.com/package/@dariushstony/smart-storage)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue.svg)](https://www.typescriptlang.org/)

A small, typed vault over `localStorage`, `sessionStorage` or memory. Each
vault owns one storage key and keeps all its items in it, with per-item
expiry, optional codecs (compression, encoding), optional debounced writes,
and typed errors instead of silent failures. It is SSR-safe and reads data
written by 1.x.

```ts
import { createVault } from '@dariushstony/smart-storage';

export const prefs = createVault({ key: 'USER_PREFS' });

prefs.set('theme', 'dark');
prefs.set('session', { id: 42 }, { ttl: 30 * 60_000 }); // expires in 30 min
prefs.get<string>('theme'); // 'dark'
```

Upgrading from 1.x? See [docs/MIGRATION.md](./docs/MIGRATION.md).

---

## Installation

```bash
npm install @dariushstony/smart-storage
# or
pnpm add @dariushstony/smart-storage
# or
yarn add @dariushstony/smart-storage
```

ESM and CommonJS builds, TypeScript types included, no runtime dependencies,
about 4 kB minified and brotlied. Targets ES2019.

---

## ⚠️ Security Warning (Read This First)

**Web Storage is NOT secure.**

- Data is fully accessible via JavaScript
- Vulnerable to XSS
- Easily inspectable by users

❌ **Do NOT store**:

- Auth tokens
- Passwords
- Sensitive user data

✅ **Use instead**:

- `httpOnly` cookies
- Secure server-side sessions

Treat **all stored data as potentially compromised** and validate on read.

---

## Concepts

- **One vault, one storage key.** `createVault({ key: 'CART' })` stores every
  item of that vault as a single string under `CART`. Use several vaults to keep
  unrelated or frequently changing data apart.
- **Drivers** decide where the string lives: `'local'` (default),
  `'session'`, `'memory'`, or your own `StorageDriver`.
- **Values round-trip through JSON.** A `Date` comes back as its ISO string,
  `NaN` as `null`, and a `Map` as `{}`. `get()` always returns a fresh copy, so
  mutating it never changes what is stored.
- **Expiry is per item.** Expired items are invisible to reads at once and are
  removed from storage on the next write (reads never write).
- **Failures are explicit.** A write that does not fit throws
  `StorageQuotaError` and leaves stored data unchanged.

---

## API

```ts
const vault = createVault(options);
```

| Method                         | Returns                   | Notes                                                                      |
| ------------------------------ | ------------------------- | -------------------------------------------------------------------------- |
| `get<T>(key)`                  | `T \| null`               | Fresh copy. Expired or missing → `null`. Never writes.                     |
| `set<T>(key, value, { ttl? })` | `void`                    | `ttl` in ms (> 0). Throws on invalid input, unserializable value, quota.   |
| `has(key)`                     | `boolean`                 | Tells a stored `null` apart from a missing key.                            |
| `update<T>(key, value)`        | `boolean`                 | Keeps the expiry. `false` when missing or expired.                         |
| `extend(key, ms)`              | `boolean`                 | Adds `ms` to the remaining lifetime; non-expiring items stay non-expiring. |
| `ttl(key)`                     | `number \| null`          | Remaining ms; `Infinity` if it never expires; `null` if missing/expired.   |
| `remove(key)`                  | `boolean`                 |                                                                            |
| `keys()`                       | `string[]`                | Live keys, least recently written first.                                   |
| `toObject()`                   | `Record<string, unknown>` | Live items.                                                                |
| `clear()`                      | `void`                    | Removes the storage key and any pending write.                             |
| `purgeExpired()`               | `number`                  | Removes expired items from storage; returns how many.                      |
| `flush()`                      | `void`                    | Writes a pending debounced change now; throws if that fails.               |
| `stats()`                      | `VaultStats`              | `{ key, driver, itemCount, bytes, maxBytes, usage }`                       |
| `dispose()`                    | `void`                    | Flushes, detaches listeners, frees the key. Idempotent.                    |
| `key`                          | `string`                  | The storage key this vault owns.                                           |

After `dispose()` every other method throws `StorageDisposedError`.

### Options

| Option       | Default     | Description                                                                                                                                           |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`        | (required)  | Storage key the vault owns.                                                                                                                           |
| `driver`     | `'local'`   | `'local'`, `'session'`, `'memory'`, a name added with `registerDriver`, or a `StorageDriver` instance.                                                |
| `codecs`     | `[]`        | `{ encode, decode }` string transforms, applied after JSON and reversed on read.                                                                      |
| `debounceMs` | `0`         | Coalesce writes made within this window. `0` writes every change immediately.                                                                         |
| `maxBytes`   | `4_000_000` | Hard limit on the stored string (UTF-8 bytes). A write that would grow it past the limit throws; writes that shrink data already over it are allowed. |
| `maxItems`   | `Infinity`  | Keep at most this many items; the least recently written are evicted first.                                                                           |
| `onError`    | none        | Receives problems the caller cannot see otherwise (see [Errors](#errors)).                                                                            |

---

## Errors

Every error is a `StorageError` with a `code`. Each one is either **thrown** to
the caller or **reported** to `onError`, never both.

| Class                       | `code`             | When                                                              |
| --------------------------- | ------------------ | ----------------------------------------------------------------- |
| `StorageArgumentError`      | `INVALID_ARGUMENT` | Thrown: bad key, TTL, option, or `undefined` value.               |
| `StorageQuotaError`         | `QUOTA_EXCEEDED`   | Thrown: over `maxBytes` or the browser quota. Nothing is changed. |
| `StorageSerializationError` | `SERIALIZATION`    | Thrown: the value or a codec cannot produce a string.             |
| `StorageAccessError`        | `ACCESS`           | Thrown: the browser refused a read, write or remove.              |
| `StorageDisposedError`      | `DISPOSED`         | Thrown: the vault was disposed or replaced.                       |
| `StorageCorruptionError`    | `CORRUPTED`        | Reported: stored data is unreadable and is treated as empty.      |
| `StorageUnavailableError`   | `UNAVAILABLE`      | Reported: Web Storage is blocked, so the vault uses memory.       |
| `StorageConflictError`      | `CONFLICT`         | Reported: a newer vault took over the same key.                   |

`StorageQuotaError` also carries `bytes` (the size the write tried to store)
and `maxBytes` (the vault's limit, when that was the limit hit; `undefined`
for the browser's own quota).

With `debounceMs > 0`, write failures happen later, on a timer, so they are
**reported**; `flush()` throws them.

```ts
import { createVault, StorageQuotaError } from '@dariushstony/smart-storage';

const drafts = createVault({
  key: 'DRAFTS',
  onError: (error) => console.warn(error.code, error.message),
});

try {
  drafts.set('post-1', longText);
} catch (error) {
  if (error instanceof StorageQuotaError) {
    drafts.purgeExpired(); // or tell the user, or drop old drafts
  } else {
    throw error;
  }
}
```

Messages can contain storage keys; filter them before sending to telemetry.

---

## Debounced writes

For data that changes many times a second (form auto-save, editor state), set
`debounceMs`:

```ts
const editor = createVault({ key: 'EDITOR', debounceMs: 250 });

editor.set('draft', text); // held in memory, written 250 ms after the last change
editor.get('draft'); // reads its own pending write
editor.flush(); // write now, e.g. before navigating
```

Pending writes are also flushed on `pagehide` and when the tab becomes hidden.
While a write is pending, the vault does not see what other tabs write to the
same key: the last writer wins.

---

## Codecs

Codecs transform the whole stored string: compression, encoding, and so on.
They run after `JSON.stringify` on write and in reverse order on read, and they
must be synchronous (async Web Crypto is not supported yet).

```ts
import LZString from 'lz-string';

const cache = createVault({
  key: 'API_CACHE',
  codecs: [
    {
      encode: (text) => LZString.compressToUTF16(text),
      decode: (text) => LZString.decompressFromUTF16(text) ?? '',
    },
  ],
});
```

If a codec cannot decode what is stored (for example after you change it),
the vault reports `CORRUPTED`, reads as empty, and replaces the data on the
next write.

---

## Custom drivers

You can add a new storage backend without changing the package. A driver only
moves strings under a key; the vault does the rest. Extend
`BaseStorageDriver`, register it, and use it by name:

```ts
import {
  BaseStorageDriver,
  createVault,
  registerDriver,
} from '@dariushstony/smart-storage';

class MyDriver extends BaseStorageDriver {
  readonly name = 'my-backend';
  protected readRaw(key: string) {
    return backend.get(key) ?? null;
  }
  protected writeRaw(key: string, value: string) {
    backend.set(key, value);
  }
  protected removeRaw(key: string) {
    backend.delete(key);
  }
}

registerDriver('my-backend', () => new MyDriver({ namespace: 'myapp' }));
const vault = createVault({ key: 'DATA', driver: 'my-backend' });
```

Prove your driver honours the contract with the conformance kit, which works
with any test runner:

```ts
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';

await assertStorageDriver(() => new MyDriver());
```

The built-in drivers are exported too: `WebStorageDriver` wraps anything with
`getItem` / `setItem` / `removeItem`, and `MemoryDriver` keeps data in a
`Map`. Both accept `{ namespace }`, so several apps can share one backend.

[docs/CUSTOM_STORAGE.md](./docs/CUSTOM_STORAGE.md) covers the full contract,
errors, registration and a checklist.
[examples/cookie-driver](./examples/cookie-driver/) is a complete, tested
driver.

---

## SSR

Without `window` (server rendering), `'local'` and `'session'` fall back to an
in-memory driver, silently. That memory is shared by the whole server
process, so do not store per-user data while rendering on the server. If Web
Storage exists but is blocked (privacy settings, sandboxed iframes), the vault
also uses memory and reports `StorageUnavailableError`.

---

## One vault per key

Create each vault once and share the instance, for example by exporting it
from a module. If another vault is created for the same key on the same
storage, the newer one takes over: the older one flushes its pending write, is
disposed, and throws `StorageDisposedError` from then on. The newer vault
reports `StorageConflictError`. This keeps hot module reloading working, and
makes accidental double use fail loudly instead of corrupting data.

`'memory'` vaults each get their own store, so they never conflict.

Detection works per driver **instance**: `'local'` and `'session'` always
resolve to one shared driver each, so two vaults on the same key are caught.
If you construct drivers yourself, reuse one instance per backend, because
`new WebStorageDriver(localStorage)` is a different instance from `'local'`
and a vault on each would not be detected.

---

## Documentation

- [Migrating from 1.x](./docs/MIGRATION.md)
- [Architecture](./docs/ARCHITECTURE.md) and [decision records](./docs/adr/)
- [Interactive example](./examples/vanilla-js/)

## Tests

```bash
pnpm test           # unit tests (Vitest + happy-dom)
pnpm test:coverage  # with coverage thresholds
pnpm test:e2e       # Playwright against the built bundle in real Chromium
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions and which test
layer to use.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). By
participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](./LICENSE).

## Author

**Dariush Hadipour**: [@DariushStony](https://github.com/DariushStony) ·
[@dariushstony/smart-storage](https://www.npmjs.com/package/@dariushstony/smart-storage)
