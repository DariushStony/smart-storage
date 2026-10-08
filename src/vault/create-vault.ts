import { composeCodecs } from '../codec/codec.js';
import { conflictScope, resolveDriver } from '../drivers/driver-registry.js';
import { StorageConflictError } from '../errors.js';
import { browserLifecycle } from '../persistence/page-lifecycle.js';
import { SnapshotRepository } from '../persistence/snapshot-repository.js';
import { SnapshotSerializer } from '../persistence/snapshot-serializer.js';
import {
  DebouncedWriteStrategy,
  ImmediateWriteStrategy,
} from '../persistence/write-strategy.js';
import type { WriteStrategy } from '../persistence/write-strategy.js';
import { createReporter } from '../reporting/reporter.js';
import { DefaultVault } from './default-vault.js';
import { resolveOptions } from './options.js';
import { VaultRegistry } from './registry.js';
import type { Vault, VaultOptions } from './vault.js';

const registry = new VaultRegistry();

/**
 * Creates a vault over one storage key. Create it once and share the
 * instance; creating another vault for the same key retires this one.
 *
 * @example
 * const prefs = createVault({ key: 'USER_PREFS' });
 * prefs.set('theme', 'dark', { ttl: 86_400_000 });
 */
function createVault(options: VaultOptions): Vault {
  const config = resolveOptions(options);
  const report = createReporter(config.onError);
  const driver = resolveDriver(config.driver, report);

  const scope = conflictScope(config.driver, driver);

  const repository = new SnapshotRepository({
    driver,
    key: config.key,
    serializer: new SnapshotSerializer(composeCodecs(config.codecs)),
    maxBytes: config.maxBytes,
    report,
  });

  const strategy: WriteStrategy =
    config.debounceMs > 0
      ? new DebouncedWriteStrategy({
          repository,
          delayMs: config.debounceMs,
          report,
          lifecycle: browserLifecycle,
        })
      : new ImmediateWriteStrategy(repository);

  const vault: DefaultVault = new DefaultVault({
    key: config.key,
    repository,
    strategy,
    maxItems: config.maxItems,
    maxBytes: config.maxBytes,
    report,
    onDispose: () => registry.release(scope, config.key, vault),
  });

  if (registry.claim(scope, config.key, vault, driver.name)) {
    report(
      new StorageConflictError(
        `A vault for "${config.key}" on ${driver.name} already existed; it was disposed and this one replaces it.`
      )
    );
  }

  return vault;
}

export { createVault };
