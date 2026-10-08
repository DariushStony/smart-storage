import { utf8ByteLength } from '../core/byte-size.js';
import { Snapshot } from '../core/snapshot.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import {
  StorageAccessError,
  StorageCorruptionError,
  StorageQuotaError,
} from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import type { SnapshotSerializer } from './snapshot-serializer.js';

interface RepositoryDeps {
  driver: StorageDriver;
  key: string;
  serializer: SnapshotSerializer;
  maxBytes: number;
  report: Reporter;
}

/**
 * Loads and saves the snapshot under one storage key. Keeps the last raw
 * string it saw: an unchanged string skips decoding, while a changed one
 * (another tab wrote) is decoded again. Never writes on load.
 */
class SnapshotRepository {
  readonly key: string;
  private readonly driver: StorageDriver;
  private readonly serializer: SnapshotSerializer;
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
    // Stored data may already be over the limit (written by 1.x, or under a
    // higher limit). Writes that do not grow it must pass, or it could
    // never be shrunk.
    if (bytes > this.maxBytes && bytes > this.storedBytes()) {
      throw new StorageQuotaError(
        `"${this.key}" would be ${String(bytes)} bytes, over its ${String(this.maxBytes)}-byte limit.`,
        { bytes, maxBytes: this.maxBytes }
      );
    }

    try {
      this.driver.write(this.key, raw);
    } catch (error) {
      if (isQuotaError(error)) {
        throw new StorageQuotaError(
          `The browser's storage quota is full; "${this.key}" was not saved.`,
          { cause: error, bytes }
        );
      }
      throw new StorageAccessError(`Writing "${this.key}" failed.`, {
        cause: error,
      });
    }

    this.cachedRaw = raw;
    this.cached = snapshot;
  }

  remove(): void {
    try {
      this.driver.remove(this.key);
    } catch (error) {
      throw new StorageAccessError(`Removing "${this.key}" failed.`, {
        cause: error,
      });
    }
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
    try {
      return this.driver.read(this.key);
    } catch (error) {
      throw new StorageAccessError(`Reading "${this.key}" failed.`, {
        cause: error,
      });
    }
  }

  private decode(raw: string): Snapshot {
    try {
      const { snapshot, dropped } = this.serializer.deserialize(raw);
      if (dropped > 0) {
        this.report(
          new StorageCorruptionError(
            `Skipped ${String(dropped)} unreadable item(s) in "${this.key}".`
          )
        );
      }
      return snapshot;
    } catch (error) {
      this.report(
        new StorageCorruptionError(
          `Stored data for "${this.key}" is unreadable and was ignored; the next write replaces it.`,
          { cause: error }
        )
      );
      return Snapshot.empty;
    }
  }
}

// Duck-typed: DOMException may not exist on the server, and browsers differ
// in name and legacy code (22 in most, 1014 in old Firefox).
function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

export { SnapshotRepository };
