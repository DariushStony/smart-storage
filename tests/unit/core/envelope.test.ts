import { describe, expect, it } from 'vitest';

import type { Entry } from '../../../src/core/entry.js';
import { decodeEnvelope, encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

describe('encodeEnvelope', () => {
  it('encodes an empty snapshot', () => {
    expect(encodeEnvelope(Snapshot.empty)).toBe('{"v":2,"items":[]}');
  });

  it('omits expiresAt for items that never expire', () => {
    const snapshot = Snapshot.empty
      .with('theme', entry('dark'))
      .with('token', entry('x', 1700));

    expect(encodeEnvelope(snapshot)).toBe(
      '{"v":2,"items":[{"key":"theme","value":"dark"},{"key":"token","value":"x","expiresAt":1700}]}'
    );
  });

  it('produces valid JSON for awkward keys and values', () => {
    const snapshot = Snapshot.empty
      .with('quote"key', entry({ nested: ['a', { b: null }] }))
      .with('emoji😀', entry('é€'));

    expect(() => JSON.parse(encodeEnvelope(snapshot)) as unknown).not.toThrow();
  });
});

describe('decodeEnvelope (v2)', () => {
  it('round-trips order, values and expiry, including prototype-like keys', () => {
    const snapshot = Snapshot.empty
      .with('b', entry(2))
      .with('__proto__', entry({ polluted: true }))
      .with('constructor', entry('c', 1234))
      .with('1', entry('one'))
      .with('0', entry('zero'));

    const decoded = decodeEnvelope(encodeEnvelope(snapshot));

    expect(decoded.dropped).toBe(0);
    expect(decoded.snapshot.all()).toEqual(snapshot.all());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops unreadable items and counts them', () => {
    const text = JSON.stringify({
      v: 2,
      items: [
        { key: 'ok', value: 1 },
        'not an item',
        { value: 1 },
        { key: '', value: 1 },
        { key: 'noValue' },
        { key: 'badExpiry', value: 1, expiresAt: 'soon' },
      ],
    });

    const decoded = decodeEnvelope(text);

    expect(decoded.snapshot.all()).toEqual([['ok', entry(1)]]);
    expect(decoded.dropped).toBe(5);
  });

  it('keeps the last of duplicated keys', () => {
    const text = JSON.stringify({
      v: 2,
      items: [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
        { key: 'a', value: 3 },
      ],
    });

    expect(decodeEnvelope(text).snapshot.all()).toEqual([
      ['b', entry(2)],
      ['a', entry(3)],
    ]);
  });
});

describe('decodeEnvelope (1.x format)', () => {
  it('reads a 1.x record', () => {
    const text = JSON.stringify({
      theme: { value: 'dark', expiry: null },
      token: { value: { id: 1 }, expiry: 1700 },
    });

    const decoded = decodeEnvelope(text);

    expect(decoded.dropped).toBe(0);
    expect(decoded.snapshot.all()).toEqual([
      ['theme', entry('dark')],
      ['token', entry({ id: 1 }, 1700)],
    ]);
  });

  it('treats a 1.x key named "v" as data, not a version', () => {
    const text = JSON.stringify({ v: { value: 'x', expiry: null } });
    expect(decodeEnvelope(text).snapshot.all()).toEqual([['v', entry('x')]]);
  });

  it('reads an empty 1.x record', () => {
    expect(decodeEnvelope('{}').snapshot.size).toBe(0);
  });

  it('drops unreadable 1.x items and counts them', () => {
    const text = JSON.stringify({
      ok: { value: 1, expiry: null },
      notAnObject: 5,
      noValue: { expiry: null },
      badExpiry: { value: 1, expiry: 'soon' },
    });

    const decoded = decodeEnvelope(text);

    expect(decoded.snapshot.all()).toEqual([['ok', entry(1)]]);
    expect(decoded.dropped).toBe(3);
  });
});

describe('decodeEnvelope (unreadable)', () => {
  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['a string', '"text"'],
    ['null', 'null'],
    ['an unknown version', '{"v":3,"items":[]}'],
    ['v2 without an items list', '{"v":2,"items":{}}'],
  ])('throws for %s', (_label, text) => {
    expect(() => decodeEnvelope(text)).toThrow();
  });
});
