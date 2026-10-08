import { utf8ByteLength } from '../core/byte-size.js';
import { Snapshot } from '../core/snapshot.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import { isThenable } from '../core/thenable.js';
import { StorageArgumentError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import type { SnapshotFormat, SnapshotStore } from './snapshot-store.js';
import {
  accessFailure,
  assertFits,
  skipped,
  unreadable,
  writeFailure,
} from './store-policy.js';

interface RepositoryDeps {
  driver: StorageDriver;
  key: string;
  serializer: SnapshotFormat;
  maxBytes: number;
  report: Reporter;
}

/**
 * Loads and saves the snapshot under one storage key. Keeps the last raw
 * string it saw: an unchanged string skips decoding, while a changed one
 * (another tab wrote) is decoded again. Never writes on load.
 */
class SnapshotRepository implements SnapshotStore {
  readonly key: string;
  private readonly driver: StorageDriver;
  private readonly serializer: SnapshotFormat;
  private readonly maxBytes: number;
  private readonly report: Reporter;
  private cachedRaw: string | null = null;
  private cached: Snapshot = Snapshot.empty;

  constructor(deps: RepositoryDeps) {
    this.key = deps.key;
    this.driver = deps.driver;
    this.serializer = deps.serializer;
    this.maxBytes = deps.maxBytes;
    this.report = deps.report;
  }

  get driverName(): string {
    return this.driver.name;
  }

  load(): Snapshot {
    const raw = this.readRaw();
    if (raw === this.cachedRaw) return this.cached;

    this.cachedRaw = raw;
    this.cached = raw === null ? Snapshot.empty : this.decode(raw);
    return this.cached;
  }

  /** Throws StorageQuotaError, StorageAccessError or StorageSerializationError; state is unchanged on failure. */
  save(snapshot: Snapshot): void {
    const raw = this.serializer.serialize(snapshot);
    const bytes = utf8ByteLength(raw);
    assertFits(this.key, bytes, this.storedBytes(), this.maxBytes);

    let result: unknown;
    try {
      result = this.driver.write(this.key, raw);
    } catch (error) {
      throw writeFailure(this.key, bytes, error);
    }
    this.assertSync(result);

    this.cachedRaw = raw;
    this.cached = snapshot;
  }

  remove(): void {
    let result: unknown;
    try {
      result = this.driver.remove(this.key);
    } catch (error) {
      throw accessFailure('Removing', this.key, error);
    }
    this.assertSync(result);
    this.cachedRaw = null;
    this.cached = Snapshot.empty;
  }

  measure(snapshot: Snapshot): number {
    return utf8ByteLength(this.serializer.serialize(snapshot));
  }

  /** UTF-8 size of the stored string as last read or written. */
  storedBytes(): number {
    return this.cachedRaw === null ? 0 : utf8ByteLength(this.cachedRaw);
  }

  private readRaw(): string | null {
    let raw: string | null;
    try {
      raw = this.driver.read(this.key);
    } catch (error) {
      throw accessFailure('Reading', this.key, error);
    }
    this.assertSync(raw);
    return raw;
  }

  private assertSync(result: unknown): void {
    if (isThenable(result)) {
      // Settle it so it cannot surface as an unhandled rejection.
      result.then(undefined, () => undefined);
      throw new StorageArgumentError(
        `The "${this.driver.name}" driver is asynchronous; use createAsyncVault() with it.`
      );
    }
  }

  private decode(raw: string): Snapshot {
    try {
      const { snapshot, dropped } = this.serializer.deserialize(raw);
      if (dropped > 0) this.report(skipped(this.key, dropped));
      return snapshot;
    } catch (error) {
      // Misuse (an async codec) is the caller's to fix, not corruption.
      if (error instanceof StorageArgumentError) throw error;
      this.report(unreadable(this.key, error));
      return Snapshot.empty;
    }
  }
}

export { SnapshotRepository };
