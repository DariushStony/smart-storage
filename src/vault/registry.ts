interface Retirable {
  /** Flushes, detaches and makes later calls throw with `reason`. */
  retire(reason: string): void | Promise<void>;
}

interface ClaimResult {
  replaced: boolean;
  /** Settles once the replaced vault has flushed; never rejects. */
  retired: Promise<void>;
}

const noop = (): void => undefined;

/**
 * Tracks which vault owns each (storage, key) pair. "Storage" is a scope
 * object: a driver instance, or a registered name's identity.
 * A newer vault takes the
 * key over and the older one is retired. Under hot module reloading this
 * cleanly replaces the stale instance; genuine double use still fails loudly,
 * because the retired instance throws on its next call.
 */
class VaultRegistry {
  private readonly owners = new WeakMap<object, Map<string, Retirable>>();

  /** Makes `vault` the owner of the key, retiring any previous owner. */
  claim(
    scope: object,
    key: string,
    vault: Retirable,
    driverName: string
  ): ClaimResult {
    let byKey = this.owners.get(scope);
    if (!byKey) {
      byKey = new Map();
      this.owners.set(scope, byKey);
    }

    const previous = byKey.get(key);
    byKey.set(key, vault);
    if (!previous) return { replaced: false, retired: Promise.resolve() };

    const retired = Promise.resolve(
      previous.retire(
        `Another vault took over "${key}" on ${driverName}; use the newer instance.`
      )
    ).then(noop, noop);
    return { replaced: true, retired };
  }

  release(scope: object, key: string, vault: Retirable): void {
    const byKey = this.owners.get(scope);
    if (byKey?.get(key) === vault) byKey.delete(key);
  }
}

// One per loaded package copy, shared by sync and async vaults, so the two
// kinds detect each other on the same key.
const vaultRegistry = new VaultRegistry();

export { VaultRegistry, vaultRegistry };
export type { Retirable, ClaimResult };
