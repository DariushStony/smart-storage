import type { ComposedAsyncCodec } from '../codec/async-codec.js';
import { decodeEnvelope, encodeEnvelope } from '../core/envelope.js';
import type { DecodedEnvelope } from '../core/envelope.js';
import type { Snapshot } from '../core/snapshot.js';
import { StorageSerializationError } from '../errors.js';
import type { AsyncSnapshotFormat } from './snapshot-store.js';

/** Snapshot ↔ stored text with codecs that may be asynchronous. */
class AsyncSnapshotSerializer implements AsyncSnapshotFormat {
  constructor(private readonly codec: ComposedAsyncCodec) {}

  async serialize(snapshot: Snapshot): Promise<string> {
    const envelope = encodeEnvelope(snapshot);
    try {
      return await this.codec.encode(envelope);
    } catch (error) {
      throw new StorageSerializationError(
        'A codec failed to encode the stored data.',
        { cause: error }
      );
    }
  }

  async deserialize(text: string): Promise<DecodedEnvelope> {
    return decodeEnvelope(await this.codec.decode(text));
  }
}

export { AsyncSnapshotSerializer };
