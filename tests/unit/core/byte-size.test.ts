import { describe, expect, it } from 'vitest';

import { utf8ByteLength } from '../../../src/core/byte-size.js';

describe('utf8ByteLength', () => {
  it.each([
    ['empty', ''],
    ['ascii', 'hello'],
    ['two-byte', 'é'],
    ['three-byte', '€'],
    ['surrogate pair', '😀'],
    ['mixed', 'a😀bé€'],
    ['lone high surrogate', '\ud83d'],
    ['lone low surrogate', '\ude00'],
    ['high surrogate before ascii', 'x\ud83dy'],
  ])('matches TextEncoder for %s', (_label, text) => {
    expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
  });
});
