import type { Snapshot } from '../core/snapshot.js';
import { StorageDisposedError, toStorageError } from '../errors.js';
import type { AsyncWriteStrategy } from '../persistence/async-write-strategy.js';
import type { AsyncSnapshotStore } from '../persistence/snapshot-store.js';
import type { Reporter } from '../reporting/reporter.js';
import type { AsyncVault } from './async-vault.js';
import type { OperationQueue } from './operation-queue.js';
import {
  extendOp,
  getOp,
  hasOp,
  keysOp,
  purgeExpiredOp,
  removeOp,
  setOp,
  toObjectOp,
  ttlOp,
  updateOp,
} from './operations.js';
import type { Operation } from './operations.js';
import type { Retirable } from './registry.js';
import type { SetOptions, VaultStats } from './vault.js';

interface AsyncVaultDeps {
  key: string;
  store: AsyncSnapshotStore;
  strategy: AsyncWriteStrategy;
  queue: OperationQueue;
  maxItems: number;
  maxBytes: number;
  report: Reporter;
  onDispose: () => void;
}

/**
 * The AsyncVault facade. Every call runs through the queue, so calls never
 * interleave; decisions come from the same operations as the sync vault.
 */
class DefaultAsyncVault implements AsyncVault, Retirable {
  readonly key: string;
  private readonly store: AsyncSnapshotStore;
  private readonly strategy: AsyncWriteStrategy;
  private readonly queue: OperationQueue;
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly report: Reporter;
  private readonly onDispose: () => void;
  private retiredReason: string | null = null;

  constructor(deps: AsyncVaultDeps) {
    this.key = deps.key;
    this.store = deps.store;
    this.strategy = deps.strategy;
    this.queue = deps.queue;
    this.maxItems = deps.maxItems;
    this.maxBytes = deps.maxBytes;
    this.report = deps.report;
    this.onDispose = deps.onDispose;
  }

  get<T>(key: string): Promise<T | null> {
    return this.perform(() => getOp<T>(key));
  }

  set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    return this.perform(() => setOp(key, value, options));
  }

  has(key: string): Promise<boolean> {
    return this.perform(() => hasOp(key));
  }

  update<T>(key: string, value: T): Promise<boolean> {
    return this.perform(() => updateOp(key, value));
  }

  extend(key: string, ms: number): Promise<boolean> {
    return this.perform(() => extendOp(key, ms));
  }

  ttl(key: string): Promise<number | null> {
    return this.perform(() => ttlOp(key));
  }

  remove(key: string): Promise<boolean> {
    return this.perform(() => removeOp(key));
  }

  keys(): Promise<string[]> {
    return this.perform(keysOp);
  }

  toObject(): Promise<Record<string, unknown>> {
    return this.perform(toObjectOp);
  }

  purgeExpired(): Promise<number> {
    return this.perform(purgeExpiredOp);
  }

  clear(): Promise<void> {
    return this.queue.run(async () => {
      this.assertUsable();
      // Remove first: if that fails, the pending change is still there.
      await this.store.remove();
      this.strategy.discard();
    });
  }

  flush(): Promise<void> {
    return this.queue.run(async () => {
      this.assertUsable();
      await this.strategy.flush();
    });
  }

  stats(): Promise<VaultStats> {
    return this.queue.run(async () => {
      this.assertUsable();
      const snapshot = await this.current();
      const pending = this.strategy.pending();
      const bytes = pending
        ? await this.store.measure(pending)
        : this.store.storedBytes();
      return {
        key: this.key,
        driver: this.store.driverName,
        itemCount: snapshot.live(Date.now()).length,
        bytes,
        maxBytes: this.maxBytes,
        usage: bytes / this.maxBytes,
      };
    });
  }

  dispose(): Promise<void> {
    return this.retire('This vault was disposed.');
  }

  retire(reason: string): Promise<void> {
    return this.queue.run(async () => {
      if (this.retiredReason !== null) return;
      try {
        await this.strategy.flush();
      } catch (error) {
        this.report(toStorageError(error, 'Saving on dispose failed.'));
      }
      this.strategy.dispose();
      this.retiredReason = reason;
      this.onDispose();
    });
  }

  private perform<R>(build: () => Operation<R>): Promise<R> {
    return this.queue.run(async () => {
      this.assertUsable();
      const operation = build();
      const now = Date.now();
      const { result, next } = operation(await this.current(), now);
      if (next) await this.strategy.write(next.compact(now, this.maxItems));
      return result;
    });
  }

  private async current(): Promise<Snapshot> {
    return this.strategy.pending() ?? (await this.store.load());
  }

  private assertUsable(): void {
    if (this.retiredReason !== null) {
      throw new StorageDisposedError(this.retiredReason);
    }
  }
}

export { DefaultAsyncVault };
