interface Retirable {
  /** Flushes, detaches and makes later calls throw with `reason`. */
  retire(reason: string): void;
}

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

  /** Returns true when a previous owner was replaced. */
  claim(
    scope: object,
    key: string,
    vault: Retirable,
    driverName: string
  ): boolean {
    let byKey = this.owners.get(scope);
    if (!byKey) {
      byKey = new Map();
      this.owners.set(scope, byKey);
    }

    const previous = byKey.get(key);
    byKey.set(key, vault);
    previous?.retire(
      `Another vault took over "${key}" on ${driverName}; use the newer instance.`
    );
    return previous !== undefined;
  }

  release(scope: object, key: string, vault: Retirable): void {
    const byKey = this.owners.get(scope);
    if (byKey?.get(key) === vault) byKey.delete(key);
  }
}

export { VaultRegistry };
export type { Retirable };
