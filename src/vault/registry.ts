import type { StorageDriver } from '../drivers/storage-driver.js';

interface Retirable {
  /** Flushes, detaches and makes later calls throw with `reason`. */
  retire(reason: string): void;
}

/**
 * Tracks which vault owns each (driver, key) pair. A newer vault takes the
 * key over and the older one is retired. Under hot module reloading this
 * cleanly replaces the stale instance; genuine double use still fails loudly,
 * because the retired instance throws on its next call.
 */
class VaultRegistry {
  private readonly owners = new WeakMap<
    StorageDriver,
    Map<string, Retirable>
  >();

  /** Returns true when a previous owner was replaced. */
  claim(driver: StorageDriver, key: string, vault: Retirable): boolean {
    let byKey = this.owners.get(driver);
    if (!byKey) {
      byKey = new Map();
      this.owners.set(driver, byKey);
    }

    const previous = byKey.get(key);
    byKey.set(key, vault);
    previous?.retire(
      `Another vault took over "${key}" on ${driver.name}; use the newer instance.`
    );
    return previous !== undefined;
  }

  release(driver: StorageDriver, key: string, vault: Retirable): void {
    const byKey = this.owners.get(driver);
    if (byKey?.get(key) === vault) byKey.delete(key);
  }
}

export { VaultRegistry };
export type { Retirable };
