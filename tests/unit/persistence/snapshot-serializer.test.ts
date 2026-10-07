import { describe, expect, it } from 'vitest';

import { composeCodecs } from '../../../src/codec/codec.js';
import type { Codec } from '../../../src/codec/codec.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { StorageSerializationError } from '../../../src/errors.js';
import { SnapshotSerializer } from '../../../src/persistence/snapshot-serializer.js';

const snapshot = Snapshot.empty.with('a', { json: '1', expiresAt: null });
const reverse: Codec = {
  encode: (text) => text.split('').reverse().join(''),
  decode: (text) => text.split('').reverse().join(''),
};

describe('SnapshotSerializer', () => {
  it('writes the plain envelope when there are no codecs', () => {
    const serializer = new SnapshotSerializer(composeCodecs([]));
    expect(serializer.serialize(snapshot)).toBe(encodeEnvelope(snapshot));
  });

  it('applies codecs on serialize and inverts them on deserialize', () => {
    const serializer = new SnapshotSerializer(composeCodecs([reverse]));
    const text = serializer.serialize(snapshot);

    expect(text).not.toBe(encodeEnvelope(snapshot));
    expect(serializer.deserialize(text).snapshot.all()).toEqual(snapshot.all());
  });

  it('wraps a failing codec as StorageSerializationError', () => {
    const failing: Codec = {
      encode: () => {
        throw new Error('nope');
      },
      decode: (text) => text,
    };

    expect(() => new SnapshotSerializer(failing).serialize(snapshot)).toThrow(
      StorageSerializationError
    );
  });

  it('throws on text it cannot decode', () => {
    const serializer = new SnapshotSerializer(composeCodecs([]));
    expect(() => serializer.deserialize('garbage')).toThrow();
  });
});
