import type { Codec } from '../codec/codec.js';
import { decodeEnvelope, encodeEnvelope } from '../core/envelope.js';
import type { DecodedEnvelope } from '../core/envelope.js';
import type { Snapshot } from '../core/snapshot.js';
import { isThenable } from '../core/thenable.js';
import { StorageArgumentError, StorageSerializationError } from '../errors.js';
import type { SnapshotFormat } from './snapshot-store.js';

/** Snapshot ↔ stored text, through synchronous codecs. */
class SnapshotSerializer implements SnapshotFormat {
  constructor(private readonly codec: Codec) {}

  serialize(snapshot: Snapshot): string {
    const envelope = encodeEnvelope(snapshot);
    let encoded: unknown;
    try {
      encoded = this.codec.encode(envelope);
    } catch (error) {
      throw new StorageSerializationError(
        'A codec failed to encode the stored data.',
        { cause: error }
      );
    }
    return assertSync(encoded);
  }

  /** Throws when the text is unreadable; callers treat that as corruption. */
  deserialize(text: string): DecodedEnvelope {
    return decodeEnvelope(assertSync(this.codec.decode(text)));
  }
}

// JavaScript callers can pass an async codec to the sync vault; storing its
// Promise as "[object Promise]" would destroy the data, so refuse it.
function assertSync(result: unknown): string {
  if (isThenable(result)) {
    result.then(undefined, () => undefined);
    throw new StorageArgumentError(
      'A codec returned a Promise; async codecs need createAsyncVault().'
    );
  }
  return result as string;
}

export { SnapshotSerializer };
