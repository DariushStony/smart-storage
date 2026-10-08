import type { DecodedEnvelope } from '../core/envelope.js';
import type { Snapshot } from '../core/snapshot.js';

/** Turns a snapshot into stored text and back. */
interface SnapshotFormat {
  serialize(snapshot: Snapshot): string;
  /** Throws when the text cannot be read; callers treat that as corruption. */
  deserialize(text: string): DecodedEnvelope;
}

/** Loads and saves the snapshot kept under one storage key. */
interface SnapshotStore {
  readonly key: string;
  readonly driverName: string;
  load(): Snapshot;
  /** Throws StorageQuotaError, StorageAccessError or StorageSerializationError. */
  save(snapshot: Snapshot): void;
  remove(): void;
  measure(snapshot: Snapshot): number;
  storedBytes(): number;
}

export type { SnapshotFormat, SnapshotStore };
