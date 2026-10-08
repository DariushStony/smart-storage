import { utf8ByteLength } from '../core/byte-size.js';
import { Snapshot } from '../core/snapshot.js';
import type { AsyncStorageDriver } from '../drivers/async-storage-driver.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import type { Reporter } from '../reporting/reporter.js';
import type {
  AsyncSnapshotFormat,
  AsyncSnapshotStore,
} from './snapshot-store.js';
import {
  accessFailure,
  assertFits,
  skipped,
  unreadable,
  writeFailure,
} from './store-policy.js';

type AnyStorageDriver = StorageDriver | AsyncStorageDriver;

interface AsyncRepositoryDeps {
  driver: AnyStorageDriver;
  key: string;
  serializer: AsyncSnapshotFormat;
  maxBytes: number;
  report: Reporter;
}

/**
 * The async counterpart of SnapshotRepository, with the same rules. It awaits
 * every driver call, so sync drivers work too. The vault's operation queue
 * guarantees calls never overlap.
 */
class AsyncSnapshotRepository implements AsyncSnapshotStore {
  readonly key: string;
  private readonly driver: AnyStorageDriver;
  private readonly serializer: AsyncSnapshotFormat;
  private readonly maxBytes: number;
  private readonly report: Reporter;
  private cachedRaw: string | null = null;
  private cached: Snapshot = Snapshot.empty;

  constructor(deps: AsyncRepositoryDeps) {
    this.key = deps.key;
    this.driver = deps.driver;
    this.serializer = deps.serializer;
    this.maxBytes = deps.maxBytes;
    this.report = deps.report;
  }

  get driverName(): string {
    return this.driver.name;
  }

  async load(): Promise<Snapshot> {
    const raw = await this.readRaw();
    if (raw === this.cachedRaw) return this.cached;

    const snapshot = raw === null ? Snapshot.empty : await this.decode(raw);
    this.cachedRaw = raw;
    this.cached = snapshot;
    return snapshot;
  }

  async save(snapshot: Snapshot): Promise<void> {
    const raw = await this.serializer.serialize(snapshot);
    const bytes = utf8ByteLength(raw);
    assertFits(this.key, bytes, this.storedBytes(), this.maxBytes);

    try {
      await this.driver.write(this.key, raw);
    } catch (error) {
      throw writeFailure(this.key, bytes, error);
    }

    this.cachedRaw = raw;
    this.cached = snapshot;
  }

  async remove(): Promise<void> {
    try {
      await this.driver.remove(this.key);
    } catch (error) {
      throw accessFailure('Removing', this.key, error);
    }
    this.cachedRaw = null;
    this.cached = Snapshot.empty;
  }

  async measure(snapshot: Snapshot): Promise<number> {
    return utf8ByteLength(await this.serializer.serialize(snapshot));
  }

  storedBytes(): number {
    return this.cachedRaw === null ? 0 : utf8ByteLength(this.cachedRaw);
  }

  private async readRaw(): Promise<string | null> {
    try {
      return await this.driver.read(this.key);
    } catch (error) {
      throw accessFailure('Reading', this.key, error);
    }
  }

  private async decode(raw: string): Promise<Snapshot> {
    try {
      const { snapshot, dropped } = await this.serializer.deserialize(raw);
      if (dropped > 0) this.report(skipped(this.key, dropped));
      return snapshot;
    } catch (error) {
      this.report(unreadable(this.key, error));
      return Snapshot.empty;
    }
  }
}

export { AsyncSnapshotRepository };
export type { AnyStorageDriver };
