import { expiryAfter, remainingTtl, toJson } from '../core/entry.js';
import type { Entry } from '../core/entry.js';
import type { Snapshot } from '../core/snapshot.js';
import { assertKey, assertPositive } from '../core/validation.js';
import {
  StorageArgumentError,
  StorageDisposedError,
  toStorageError,
} from '../errors.js';
import type { SnapshotRepository } from '../persistence/snapshot-repository.js';
import type { WriteStrategy } from '../persistence/write-strategy.js';
import type { Reporter } from '../reporting/reporter.js';
import type { Retirable } from './registry.js';
import type { SetOptions, Vault, VaultStats } from './vault.js';

interface VaultDeps {
  key: string;
  repository: SnapshotRepository;
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
  private readonly repository: SnapshotRepository;
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
    const entry = this.find(key, Date.now());
    return entry ? (JSON.parse(entry.json) as T) : null;
  }

  set<T>(key: string, value: T, options: SetOptions = {}): void {
    this.assertUsable();
    assertKey(key);
    if (typeof (options as unknown) !== 'object' || options === null) {
      throw new StorageArgumentError('set() options must be an object.');
    }
    const { ttl } = options;
    if (ttl !== undefined) assertPositive('ttl', ttl);
    const json = toJson(value);

    const now = Date.now();
    const expiresAt = ttl === undefined ? null : expiryAfter(now, ttl);
    this.commit(this.current().with(key, { json, expiresAt }), now);
  }

  has(key: string): boolean {
    return this.find(key, Date.now()) !== undefined;
  }

  update<T>(key: string, value: T): boolean {
    this.assertUsable();
    const json = toJson(value);
    return this.rewrite(key, (entry) => ({ json, expiresAt: entry.expiresAt }));
  }

  extend(key: string, ms: number): boolean {
    this.assertUsable();
    assertPositive('ms', ms);
    return this.rewrite(key, (entry) =>
      entry.expiresAt === null
        ? entry
        : { json: entry.json, expiresAt: expiryAfter(entry.expiresAt, ms) }
    );
  }

  ttl(key: string): number | null {
    const now = Date.now();
    const entry = this.find(key, now);
    return entry ? remainingTtl(entry, now) : null;
  }

  remove(key: string): boolean {
    this.assertUsable();
    assertKey(key);
    const now = Date.now();
    const snapshot = this.current();
    if (!snapshot.get(key, now)) return false;
    this.commit(snapshot.without(key), now);
    return true;
  }

  keys(): string[] {
    return this.liveEntries().map(([key]) => key);
  }

  toObject(): Record<string, unknown> {
    return Object.fromEntries(
      this.liveEntries().map(([key, entry]) => [
        key,
        JSON.parse(entry.json) as unknown,
      ])
    );
  }

  clear(): void {
    this.assertUsable();
    // Remove first: if that throws, the pending change is still there.
    this.repository.remove();
    this.strategy.discard();
  }

  purgeExpired(): number {
    this.assertUsable();
    const now = Date.now();
    const snapshot = this.current();
    const purged = snapshot.withoutExpired(now);
    if (purged === snapshot) return 0;
    this.commit(purged, now);
    return snapshot.size - purged.size;
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

  private current(): Snapshot {
    return this.strategy.pending() ?? this.repository.load();
  }

  private commit(next: Snapshot, now: number): void {
    this.strategy.write(next.compact(now, this.maxItems));
  }

  private find(key: string, now: number): Entry | undefined {
    this.assertUsable();
    assertKey(key);
    return this.current().get(key, now);
  }

  private liveEntries(): Array<[string, Entry]> {
    this.assertUsable();
    return this.current().live(Date.now());
  }

  private rewrite(key: string, change: (entry: Entry) => Entry): boolean {
    this.assertUsable();
    assertKey(key);
    const now = Date.now();
    const snapshot = this.current();
    const entry = snapshot.get(key, now);
    if (!entry) return false;

    const next = change(entry);
    if (next !== entry) this.commit(snapshot.with(key, next), now);
    return true;
  }

  private assertUsable(): void {
    if (this.retiredReason !== null) {
      throw new StorageDisposedError(this.retiredReason);
    }
  }
}

export { DefaultVault };
