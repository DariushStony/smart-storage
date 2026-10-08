import { describe, expect, it } from 'vitest';

import { composeAsyncCodecs } from '../../../src/codec/async-codec.js';
import type { AsyncCodec } from '../../../src/codec/async-codec.js';

const tag = (name: string): AsyncCodec => ({
  encode: async (text) => {
    await Promise.resolve();
    return `${name}(${text})`;
  },
  decode: (text) => text.slice(name.length + 1, -1),
});

describe('composeAsyncCodecs', () => {
  it('is the identity with no codecs', async () => {
    const codec = composeAsyncCodecs([]);
    expect(await codec.encode('x')).toBe('x');
    expect(await codec.decode('x')).toBe('x');
  });

  it('encodes left to right and decodes right to left, awaiting each step', async () => {
    const codec = composeAsyncCodecs([tag('a'), tag('b')]);

    expect(await codec.encode('x')).toBe('b(a(x))');
    expect(await codec.decode('b(a(x))')).toBe('x');
  });

  it('accepts plain sync codecs', async () => {
    const codec = composeAsyncCodecs([
      {
        encode: (text) => text.toUpperCase(),
        decode: (text) => text.toLowerCase(),
      },
    ]);
    expect(await codec.decode(await codec.encode('x'))).toBe('x');
  });
});
