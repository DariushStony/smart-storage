import type { Snapshot } from '../core/snapshot.js';
import { StorageDisposedError, toStorageError } from '../errors.js';
import type { SnapshotStore } from '../persistence/snapshot-store.js';
import type { WriteStrategy } from '../persistence/write-strategy.js';
import type { Reporter } from '../reporting/reporter.js';
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
import type { SetOptions, Vault, VaultStats } from './vault.js';

interface VaultDeps {
  key: string;
  repository: SnapshotStore;
  strategy: WriteStrategy;
  maxItems: number;
  maxBytes: number;
  report: Reporter;
  onDispose: () => void;
}

/**
 * The Vault facade. Every read goes through current() and every change
 * through commit(); that single write point is where change events will
 * be emitted later.
 */
class DefaultVault implements Vault, Retirable {
  readonly key: string;
  private readonly repository: SnapshotStore;
  private readonly strategy: WriteStrategy;
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly report: Reporter;
  private readonly onDispose: () => void;
  private retiredReason: string | null = null;

  constructor(deps: VaultDeps) {
    this.key = deps.key;
    this.repository = deps.repository;
    this.strategy = deps.strategy;
    this.maxItems = deps.maxItems;
    this.maxBytes = deps.maxBytes;
    this.report = deps.report;
    this.onDispose = deps.onDispose;
  }

  get<T>(key: string): T | null {
    return this.run(() => getOp<T>(key));
  }

  set<T>(key: string, value: T, options?: SetOptions): void {
    this.run(() => setOp(key, value, options));
  }

  has(key: string): boolean {
    return this.run(() => hasOp(key));
  }

  update<T>(key: string, value: T): boolean {
    return this.run(() => updateOp(key, value));
  }

  extend(key: string, ms: number): boolean {
    return this.run(() => extendOp(key, ms));
  }

  ttl(key: string): number | null {
    return this.run(() => ttlOp(key));
  }

  remove(key: string): boolean {
    return this.run(() => removeOp(key));
  }

  keys(): string[] {
    return this.run(keysOp);
  }

  toObject(): Record<string, unknown> {
    return this.run(toObjectOp);
  }

  clear(): void {
    this.assertUsable();
    // Remove first: if that throws, the pending change is still there.
    this.repository.remove();
    this.strategy.discard();
  }

  purgeExpired(): number {
    return this.run(purgeExpiredOp);
  }

  flush(): void {
    this.assertUsable();
    this.strategy.flush();
  }

  stats(): VaultStats {
    this.assertUsable();
    const snapshot = this.current();
    const pending = this.strategy.pending();
    // current() has just read storage, so storedBytes() is up to date.
    const bytes = pending
      ? this.repository.measure(pending)
      : this.repository.storedBytes();
    return {
      key: this.key,
      driver: this.repository.driverName,
      itemCount: snapshot.live(Date.now()).length,
      bytes,
      maxBytes: this.maxBytes,
      usage: bytes / this.maxBytes,
    };
  }

  dispose(): void {
    this.retire('This vault was disposed.');
  }

  retire(reason: string): void {
    if (this.retiredReason !== null) return;
    try {
      this.strategy.flush();
    } catch (error) {
      this.report(toStorageError(error, 'Saving on dispose failed.'));
    }
    this.strategy.dispose();
    this.retiredReason = reason;
    this.onDispose();
  }

  /** Checks usability, builds (and so validates) the operation, then applies it. */
  private run<R>(build: () => Operation<R>): R {
    this.assertUsable();
    const operation = build();
    const now = Date.now();
    const { result, next } = operation(this.current(), now);
    if (next) this.commit(next, now);
    return result;
  }

  private current(): Snapshot {
    return this.strategy.pending() ?? this.repository.load();
  }

  private commit(next: Snapshot, now: number): void {
    this.strategy.write(next.compact(now, this.maxItems));
  }

  private assertUsable(): void {
    if (this.retiredReason !== null) {
      throw new StorageDisposedError(this.retiredReason);
    }
  }
}

export { DefaultVault };
