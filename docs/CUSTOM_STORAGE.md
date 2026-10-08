# Adding a new storage backend

smart-storage is open for new storage backends: you add one without changing
the package. A backend is a **driver**, a small object that moves strings
under a key. The vault does everything else (TTL, JSON, codecs, size limits,
quota errors, debouncing), so a driver is usually 15–30 lines.

This guide walks through the contract, three ways to implement it, how to
prove your driver honours the contract, and how to plug it in.

## 1. Do you need a driver?

| You want to…                                                                                 | Use                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Store data somewhere new (cookies, a native bridge, a remote key-value API, a shared worker) | **A driver** (this guide)                                                  |
| Change _how_ data is stored: compress it, encode it, encrypt it                              | A **codec** (see the README's Codecs section). It works with every driver. |
| Keep data in memory for tests or SSR                                                         | The built-in `'memory'` driver                                             |

## 2. The contract

```ts
interface StorageDriver {
  readonly name: string;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}
```

Each driver must follow the rules below. The conformance kit checks every one
of them and reports failures by these rule ids.

| Rule             | Requirement                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `sync`           | `read`, `write` and `remove` return their results directly, never a Promise.                                                               |
| `name`           | `name` is a non-empty string and does not change. It shows up in `vault.stats().driver` and in error messages.                             |
| `missing`        | `read` of a key that was never written returns `null` (not `undefined`, not `''`).                                                         |
| `roundtrip`      | `read` after `write` returns exactly the written string.                                                                                   |
| `empty`          | The empty string round-trips as `''`, not `null`.                                                                                          |
| `exact`          | Unicode (including emoji), quotes, backslashes, newlines and JSON text round-trip unchanged. Don't trim and don't re-encode.               |
| `large`          | Large values round-trip. The kit uses 64 KB by default; small backends can lower it.                                                       |
| `overwrite`      | A second `write` to a key replaces its value.                                                                                              |
| `remove`         | After `remove`, `read` returns `null`.                                                                                                     |
| `remove-missing` | `remove` of a key that was never written does nothing. It must not throw.                                                                  |
| `independent`    | Keys are independent and exact: removing `a` leaves `b`, and `K`, `k`, `" k"` and `"k "` are four different keys. Don't trim or fold case. |
| `any-key`        | Keys may contain `:`, `/`, spaces, unicode and `__proto__`. A driver backed by a plain object usually fails this; use a `Map`.             |

Two more rules can't be checked automatically:

- **Out of space:** throw an error whose `name` is `'QuotaExceededError'`
  (`new DOMException(message, 'QuotaExceededError')` in browsers). The vault
  turns it into `StorageQuotaError` and keeps the previously stored data.
- **Other failures:** throw. Never swallow an error or return a placeholder.
  The vault reports thrown errors as `StorageAccessError`.

Why so small? A driver that also did TTL or JSON would have to get all of it
right, the same way as every other driver. Keeping drivers to string I/O
means any two drivers are interchangeable under the same vault (Liskov
substitution).

## 3. Implement it

### A plain object

Fine for a quick adapter:

```ts
import type { StorageDriver } from '@dariushstony/smart-storage';

const bridge: StorageDriver = {
  name: 'native-bridge',
  read: (key) => nativeBridge.get(key) ?? null,
  write: (key, value) => nativeBridge.set(key, value),
  remove: (key) => nativeBridge.delete(key),
};
```

### A class implementing `StorageDriver`

```ts
import type { StorageDriver } from '@dariushstony/smart-storage';

class SharedWorkerDriver implements StorageDriver {
  readonly name = 'shared-worker';
  private readonly data = new Map<string, string>();

  read(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}
```

### Extending `BaseStorageDriver` (recommended)

The base class is a template: you implement three protected methods, and it
supplies `read`, `write` and `remove`, plus an optional `namespace` that
prefixes every key (it must not contain `:`, so two namespaces can never
overlap). A namespace keeps several apps (or several drivers) on
one backend from colliding.

```ts
import { BaseStorageDriver } from '@dariushstony/smart-storage';
import type { BaseStorageDriverOptions } from '@dariushstony/smart-storage';

class RemoteKeyValueDriver extends BaseStorageDriver {
  readonly name = 'remote-kv';

  constructor(
    private readonly client: SyncKeyValueClient,
    options?: BaseStorageDriverOptions
  ) {
    super(options);
  }

  protected readRaw(key: string): string | null {
    return this.client.get(key) ?? null;
  }
  protected writeRaw(key: string, value: string): void {
    this.client.put(key, value);
  }
  protected removeRaw(key: string): void {
    this.client.delete(key);
  }
}

new RemoteKeyValueDriver(client, { namespace: 'myapp' }); // stores "myapp:<key>"
```

Don't override `read`, `write` or `remove`; they apply the namespace.

## 4. Errors

| Situation                                            | What your driver does                       | What the caller sees                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The backend is full                                  | Throw an error named `'QuotaExceededError'` | `StorageQuotaError`; earlier data is intact                                                                                                                                                                                |
| The backend refuses or fails                         | Throw anything                              | `StorageAccessError` with your error as `cause`                                                                                                                                                                            |
| The backend does not exist here (e.g. on the server) | Throw from the constructor                  | Through `registerDriver`: the vault uses memory and reports `StorageUnavailableError`. If you construct the driver yourself (`driver: new X()`), the throw reaches your code, so register drivers that may be unavailable. |

## 5. Verify it with the conformance kit

`@dariushstony/smart-storage/testing` runs every rule against fresh instances
of your driver. It uses plain async functions, so it works with any test
runner, and it removes every key it writes.

```ts
// Vitest or Jest: the same code.
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';

test('RemoteKeyValueDriver honours the driver contract', async () => {
  await assertStorageDriver(() => new RemoteKeyValueDriver(testClient()));
});
```

`assertStorageDriver` throws one error that lists every broken rule:

```text
Driver "remote-kv" breaks 2 contract rule(s):
- [empty] the empty string round-trips as "", not null: read after writing "": expected "", got null.
- [any-key] keys may contain ":", "/", spaces, unicode and "__proto__": read of "__proto__": expected "value of __proto__", got an object.
```

To inspect results yourself, use `verifyStorageDriver`, which returns
`{ driver, passed, checks: [{ rule, description, passed, error }] }`.

For small backends, lower the large-value size:

```ts
await assertStorageDriver(() => new CookieDriver(), {
  largeValueLength: 1_000,
});
```

The kit has already caught two real bugs: happy-dom's `localStorage` breaks
`any-key`, and an early version of the example cookie driver broke `remove`.

## 6. Register it

Registering gives your driver a name, the same way the built-ins
(`'local'`, `'session'`, `'memory'`) are provided:

```ts
import { registerDriver } from '@dariushstony/smart-storage';

registerDriver(
  'remote-kv',
  () => new RemoteKeyValueDriver(client, { namespace: 'myapp' })
);
```

- **Shared by default.** The factory runs once, and every vault on that name
  uses the same instance. That lets smart-storage notice two vaults on the
  same key. Pass `{ shared: false }` to build an instance per vault (the
  built-in `'memory'` does this).
- **"Not available here".** If the factory throws, vaults fall back to memory
  and report `StorageUnavailableError` with your error as `cause`. To fall
  back _silently_ (e.g. the expected server-side case), return a
  `new MemoryDriver()` from the factory yourself.
- **Hot module reloading.** Registering a name again replaces the old
  registration.
- **Removing.** `unregisterDriver(name)` removes a custom driver.
- **Reserved names.** `local`, `session` and `memory` can't be replaced or
  removed.
- **The fallback is permanent.** Once a shared name has fallen back to memory,
  every vault using it stays in memory for the life of the page. You only see
  it through `onError` (`StorageUnavailableError`) or
  `vault.stats().driver === 'memory'`.
- **Scope.** There is one registry per loaded copy of the package. An app that
  loads both the ESM and CommonJS builds, or two installed versions, has two
  registries. Register before creating vaults that use the name; an unknown
  name makes `createVault` throw a `StorageArgumentError` that tells you to
  register it.

## 7. Use it

```ts
import { createVault } from '@dariushstony/smart-storage';

// By name (after registerDriver):
export const settings = createVault({ key: 'SETTINGS', driver: 'remote-kv' });

// Or by instance, without registering:
export const cache = createVault({
  key: 'CACHE',
  driver: new RemoteKeyValueDriver(client),
});
```

When you pass instances yourself, reuse one instance per backend. Conflict
detection works per driver instance.

## 8. Checklist before you ship a driver

- [ ] `assertStorageDriver` passes, with the real backend if you can, not only
      a mock.
- [ ] A full backend throws `QuotaExceededError`, and other failures throw.
- [ ] The driver uses a `Map` (or the backend's own API), not a plain object,
      for keys.
- [ ] Server-side behaviour is decided: a constructor that throws (reported
      fallback) or a factory that returns `MemoryDriver` (silent fallback).
- [ ] `name` is meaningful in `stats()` and logs.
- [ ] If the backend is shared with other code, you pass a `namespace`.

## Async backends

Some backends can only answer asynchronously: IndexedDB, React Native's
AsyncStorage, a remote key-value API. They implement `AsyncStorageDriver`,
the same contract with Promises, and are used through `createAsyncVault`.

```ts
interface AsyncStorageDriver {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

- **Contract.** Every rule in §2 applies. Rule `sync` is replaced by
  **`async`**: `read`, `write` and `remove` return Promises. Failures reject,
  and a full backend rejects with an error named `'QuotaExceededError'`.
- **Base class.** `BaseAsyncStorageDriver` is the async template:
  implement `readRaw`, `writeRaw` and `removeRaw` returning Promises, and get
  `namespace` for free. Its public methods are `async`, so even a raw method
  that throws synchronously ends up as a rejection.
- **Registration.** `registerAsyncDriver(name, factory, options?)` has the
  same rules as `registerDriver`. `createAsyncVault` accepts those names,
  while `createVault` refuses them with a message pointing at
  `createAsyncVault`.
- **Verification.** Use `verifyAsyncStorageDriver` /
  `assertAsyncStorageDriver` from `@dariushstony/smart-storage/testing`.
- **Sync drivers work too.** `createAsyncVault` awaits every driver call, so
  any sync driver (`'local'`, your `StorageDriver`) works with it unchanged.

```ts
import {
  BaseAsyncStorageDriver,
  createAsyncVault,
  registerAsyncDriver,
} from '@dariushstony/smart-storage';
import { assertAsyncStorageDriver } from '@dariushstony/smart-storage/testing';

class NativeStorageDriver extends BaseAsyncStorageDriver {
  readonly name = 'native';
  protected async readRaw(key: string) {
    return (await NativeStorage.getItem(key)) ?? null;
  }
  protected async writeRaw(key: string, value: string) {
    await NativeStorage.setItem(key, value);
  }
  protected async removeRaw(key: string) {
    await NativeStorage.removeItem(key);
  }
}

await assertAsyncStorageDriver(() => new NativeStorageDriver()); // in a test

registerAsyncDriver(
  'native',
  () => new NativeStorageDriver({ namespace: 'myapp' })
);
export const settings = createAsyncVault({ key: 'SETTINGS', driver: 'native' });
```

The built-in `IndexedDBDriver` (`src/drivers/indexeddb-driver.ts`) is the
reference async driver. It opens lazily, upgrades a database that lacks its
store, and closes when another tab needs to upgrade.

## A complete example

[`examples/cookie-driver`](../examples/cookie-driver/) is a full driver built
with this guide. It covers `BaseStorageDriver`, namespacing, quota mapping and
server fallback, and it is tested with the kit.
