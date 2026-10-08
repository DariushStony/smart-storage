import { describe, expect, it } from 'vitest';

import {
  expiryAfter,
  isExpired,
  remainingTtl,
  toJson,
} from '../../../src/core/entry.js';
import type { Entry } from '../../../src/core/entry.js';
import {
  StorageArgumentError,
  StorageSerializationError,
} from '../../../src/errors.js';

const expiring: Entry = { json: '1', expiresAt: 100 };
const permanent: Entry = { json: '1', expiresAt: null };

describe('isExpired', () => {
  it('never expires an entry without expiresAt', () => {
    expect(isExpired(permanent, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  // Same boundary as 1.x: expired only once now is past expiresAt.
  it('is live up to and including expiresAt, and expired after it', () => {
    expect(isExpired(expiring, 99)).toBe(false);
    expect(isExpired(expiring, 100)).toBe(false);
    expect(isExpired(expiring, 101)).toBe(true);
  });
});

describe('remainingTtl', () => {
  it('counts down to expiresAt', () => {
    expect(remainingTtl(expiring, 40)).toBe(60);
  });

  it('is Infinity for an entry that never expires', () => {
    expect(remainingTtl(permanent, 40)).toBe(Infinity);
  });
});

describe('toJson', () => {
  it.each([
    ['string', 'dark', '"dark"'],
    ['number', 42, '42'],
    ['boolean', false, 'false'],
    ['null', null, 'null'],
    ['object', { a: [1, 2] }, '{"a":[1,2]}'],
  ])('serializes a %s', (_label, value, expected) => {
    expect(toJson(value)).toBe(expected);
  });

  it('rejects undefined and points at remove()', () => {
    expect(() => toJson(undefined)).toThrow(StorageArgumentError);
    expect(() => toJson(undefined)).toThrow(/remove\(\)/);
  });

  it.each([
    ['function', () => 1],
    ['symbol', Symbol('s')],
  ])('rejects a %s', (_label, value) => {
    expect(() => toJson(value)).toThrow(StorageSerializationError);
  });

  it('rejects a circular structure and keeps the cause', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    let caught: unknown;
    try {
      toJson(circular);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StorageSerializationError);
    expect((caught as StorageSerializationError).cause).toBeInstanceOf(
      TypeError
    );
  });
});

describe('expiryAfter', () => {
  it('adds a duration to a timestamp', () => {
    expect(expiryAfter(1000, 500)).toBe(1500);
  });

  it('rejects a result past the largest safe timestamp', () => {
    expect(() => expiryAfter(1000, Number.MAX_SAFE_INTEGER)).toThrow(
      StorageArgumentError
    );
    expect(() => expiryAfter(0, Number.MAX_VALUE)).toThrow(
      StorageArgumentError
    );
  });
});
