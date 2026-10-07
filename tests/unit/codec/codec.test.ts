import { describe, expect, it } from 'vitest';

import { composeCodecs } from '../../../src/codec/codec.js';
import type { Codec } from '../../../src/codec/codec.js';

const tag = (name: string): Codec => ({
  encode: (text) => `${name}(${text})`,
  decode: (text) => text.slice(name.length + 1, -1),
});

describe('composeCodecs', () => {
  it('is the identity with no codecs', () => {
    const codec = composeCodecs([]);
    expect(codec.encode('x')).toBe('x');
    expect(codec.decode('x')).toBe('x');
  });

  it('encodes left to right and decodes right to left', () => {
    const codec = composeCodecs([tag('a'), tag('b')]);

    expect(codec.encode('x')).toBe('b(a(x))');
    expect(codec.decode('b(a(x))')).toBe('x');
  });

  it('keeps `this` for class-based codecs', () => {
    class Prefix implements Codec {
      constructor(private readonly prefix: string) {}
      encode(text: string): string {
        return this.prefix + text;
      }
      decode(text: string): string {
        return text.slice(this.prefix.length);
      }
    }

    const codec = composeCodecs([new Prefix('>>')]);
    expect(codec.decode(codec.encode('x'))).toBe('x');
  });
});
