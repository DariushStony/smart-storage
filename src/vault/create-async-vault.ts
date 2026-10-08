import { composeAsyncCodecs } from '../codec/async-codec.js';
import { conflictScope, resolveAnyDriver } from '../drivers/driver-registry.js';
import type { AnyStorageDriver } from '../drivers/driver-registry.js';
import { resolveIndexedDB } from '../drivers/indexeddb-builtin.js';
import { StorageConflictError } from '../errors.js';
import { AsyncSnapshotRepository } from '../persistence/async-snapshot-repository.js';
import { AsyncSnapshotSerializer } from '../persistence/async-snapshot-serializer.js';
import {
  AsyncDebouncedWriteStrategy,
  AsyncImmediateWriteStrategy,
} from '../persistence/async-write-strategy.js';
import type { AsyncWriteStrategy } from '../persistence/async-write-strategy.js';
import { browserLifecycle } from '../persistence/page-lifecycle.js';
import { createReporter } from '../reporting/reporter.js';
import type { Reporter } from '../reporting/reporter.js';
import type {
  AsyncDriverSpec,
  AsyncVault,
  AsyncVaultOptions,
} from './async-vault.js';
import { DefaultAsyncVault } from './default-async-vault.js';
import { OperationQueue } from './operation-queue.js';
import { resolveAsyncOptions } from './options.js';
import { vaultRegistry } from './registry.js';

function resolveForAsyncVault(
  spec: AsyncDriverSpec,
  report: Reporter
): AnyStorageDriver {
  return spec === 'indexeddb'
    ? resolveIndexedDB(report)
    : resolveAnyDriver(spec, report);
}

/**
 * Creates an async vault over one storage key: IndexedDB by default, or any
 * sync or async driver. Options are validated now (throws); every method
 * returns a Promise.
 *
 * @example
 * const cache = createAsyncVault({ key: 'API_CACHE' });
 * await cache.set('user:1', user, { ttl: 60_000 });
 */
function createAsyncVault(options: AsyncVaultOptions): AsyncVault {
  const config = resolveAsyncOptions(options);
  const report = createReporter(config.onError);
  const driver = resolveForAsyncVault(config.driver, report);
  const scope = conflictScope(config.driver, driver);

  const store = new AsyncSnapshotRepository({
    driver,
    key: config.key,
    serializer: new AsyncSnapshotSerializer(composeAsyncCodecs(config.codecs)),
    maxBytes: config.maxBytes,
    report,
  });
  const queue = new OperationQueue();
  const strategy: AsyncWriteStrategy =
    config.debounceMs > 0
      ? new AsyncDebouncedWriteStrategy({
          store,
          delayMs: config.debounceMs,
          report,
          lifecycle: browserLifecycle,
          runner: queue,
        })
      : new AsyncImmediateWriteStrategy(store);

  const vault: DefaultAsyncVault = new DefaultAsyncVault({
    key: config.key,
    store,
    strategy,
    queue,
    maxItems: config.maxItems,
    maxBytes: config.maxBytes,
    report,
    onDispose: () => vaultRegistry.release(scope, config.key, vault),
  });

  const { replaced, retired } = vaultRegistry.claim(
    scope,
    config.key,
    vault,
    driver.name
  );
  if (replaced) {
    // The newer vault's first call waits until the old one has flushed.
    queue.after(retired);
    report(
      new StorageConflictError(
        `A vault for "${config.key}" on ${driver.name} already existed; it was disposed and this one replaces it.`
      )
    );
  }

  return vault;
}

export { createAsyncVault };
