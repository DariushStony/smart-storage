import { describe, expect, it, vi } from 'vitest';

import {
  getByteSize,
  isCircularReferenceError,
  isExpired,
  isQuotaExceededError,
  isValidDataRecord,
  validateKey,
} from '../../src/vault/helpers.js';

describe('validateKey', () => {
  const storage = new Map<string, string>();

  it('accepts an ordinary key', () => {
    expect(() => validateKey('theme', storage)).not.toThrow();
  });

  it('throws when storage is unavailable', () => {
    expect(() => validateKey('theme', null)).toThrow(/not available/i);
  });

  it.each([
    ['empty string', ''],
    ['single space', ' '],
    ['tabs and newlines', '\t\n '],
  ])('rejects a blank key (%s)', (_label, key) => {
    expect(() => validateKey(key, storage)).toThrow(
      /cannot be empty or whitespace/i
    );
  });

  // The guard exists so a crafted key cannot walk up the prototype chain
  // of the plain object the vault parses storage into.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the dangerous key %s',
    (key) => {
      expect(() => validateKey(key, storage)).toThrow(/prototype pollution/i);
    }
  );

  it('allows keys that merely contain a dangerous substring', () => {
    expect(() => validateKey('my__proto__key', storage)).not.toThrow();
    expect(() => validateKey('constructor:1', storage)).not.toThrow();
  });

  it('checks storage availability before key validity', () => {
    // A blank key AND null storage: the storage error must win, because an
    // unavailable environment is the more fundamental failure.
    expect(() => validateKey('', null)).toThrow(/not available/i);
  });
});

describe('isExpired', () => {
  it('treats null expiry as never expiring', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('reports a past timestamp as expired', () => {
    expect(isExpired(Date.now() - 1000)).toBe(true);
  });

  it('reports a future timestamp as not expired', () => {
    expect(isExpired(Date.now() + 10_000)).toBe(false);
  });

  it('is not expired exactly at the expiry instant', () => {
    // The implementation uses a strict `now > expiry` comparison. Pin the
    // clock: without fake timers, isExpired() reads Date.now() a second time
    // and a millisecond rollover between the two reads would flake the test.
    vi.useFakeTimers();
    try {
      const now = Date.now();
      expect(isExpired(now)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getByteSize', () => {
  it('returns 0 for an empty string', () => {
    expect(getByteSize('')).toBe(0);
  });

  it('counts one byte per ASCII character', () => {
    expect(getByteSize('hello')).toBe(5);
  });

  it('counts UTF-8 bytes, not code units, for multi-byte characters', () => {
    // 'é' is 2 bytes in UTF-8; a 4-byte emoji is 4.
    expect(getByteSize('é')).toBe(2);
    expect(getByteSize('😀')).toBe(4);
  });
});

describe('isQuotaExceededError', () => {
  it('recognises QuotaExceededError', () => {
    expect(
      isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))
    ).toBe(true);
  });

  it('recognises the Firefox-specific name', () => {
    expect(
      isQuotaExceededError(
        new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED')
      )
    ).toBe(true);
  });

  it('rejects unrelated DOMExceptions and plain errors', () => {
    expect(isQuotaExceededError(new DOMException('nope', 'SyntaxError'))).toBe(
      false
    );
    expect(isQuotaExceededError(new Error('QuotaExceededError'))).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
  });
});

describe('isCircularReferenceError', () => {
  it('recognises the TypeError JSON.stringify throws on a cycle', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    let caught: unknown;
    try {
      JSON.stringify(cyclic);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect(isCircularReferenceError(caught)).toBe(true);
  });

  it('rejects a TypeError with an unrelated message', () => {
    expect(isCircularReferenceError(new TypeError('bad argument'))).toBe(false);
  });

  it('rejects non-TypeError values', () => {
    expect(isCircularReferenceError(new Error('circular'))).toBe(false);
  });
});

describe('isValidDataRecord', () => {
  it('accepts a plain object', () => {
    expect(isValidDataRecord({})).toBe(true);
    expect(isValidDataRecord({ a: { value: 1, expiry: null } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'nope'],
    ['a number', 42],
    ['undefined', undefined],
  ])('rejects %s', (_label, input) => {
    expect(isValidDataRecord(input)).toBe(false);
  });
});
