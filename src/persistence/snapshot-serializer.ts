import type { Codec } from '../codec/codec.js';
import { decodeEnvelope, encodeEnvelope } from '../core/envelope.js';
import type { DecodedEnvelope } from '../core/envelope.js';
import type { Snapshot } from '../core/snapshot.js';
import { StorageSerializationError } from '../errors.js';
import type { SnapshotFormat } from './snapshot-store.js';

/** Snapshot ↔ stored text. Pure, so a future async vault can reuse it as-is. */
class SnapshotSerializer implements SnapshotFormat {
  constructor(private readonly codec: Codec) {}

  serialize(snapshot: Snapshot): string {
    const envelope = encodeEnvelope(snapshot);
    try {
      return this.codec.encode(envelope);
    } catch (error) {
      throw new StorageSerializationError(
        'A codec failed to encode the stored data.',
        { cause: error }
      );
    }
  }

  /** Throws when the text is unreadable; callers treat that as corruption. */
  deserialize(text: string): DecodedEnvelope {
    return decodeEnvelope(this.codec.decode(text));
  }
}

export { SnapshotSerializer };
