import { describe, expect, it } from 'vitest';

import {
  assertKey,
  assertMaxItems,
  assertNonNegative,
  assertPositive,
} from '../../../src/core/validation.js';
import { StorageArgumentError } from '../../../src/errors.js';

describe('assertKey', () => {
  it.each(['a', 'user:1', '__proto__', '  padded  '])('accepts %j', (key) => {
    expect(() => assertKey(key)).not.toThrow();
  });

  it.each(['', '   ', 42, null, undefined])('rejects %j', (key) => {
    expect(() => assertKey(key)).toThrow(StorageArgumentError);
  });

  it('names the argument in the message', () => {
    expect(() => assertKey('', 'Vault key')).toThrow(/Vault key/);
  });
});

describe('assertPositive', () => {
  it.each([1, 0.5, 1e9])('accepts %j', (value) => {
    expect(() => assertPositive('ttl', value)).not.toThrow();
  });

  it.each([0, -1, NaN, Infinity, '5', undefined])('rejects %j', (value) => {
    expect(() => assertPositive('ttl', value)).toThrow(/ttl/);
  });
});

describe('assertNonNegative', () => {
  it.each([0, 1, 250])('accepts %j', (value) => {
    expect(() => assertNonNegative('debounceMs', value)).not.toThrow();
  });

  it.each([-1, NaN, Infinity, '0'])('rejects %j', (value) => {
    expect(() => assertNonNegative('debounceMs', value)).toThrow(
      StorageArgumentError
    );
  });
});

describe('assertMaxItems', () => {
  it.each([1, 10, Infinity])('accepts %j', (value) => {
    expect(() => assertMaxItems(value)).not.toThrow();
  });

  it.each([0, -1, 1.5, NaN, '3'])('rejects %j', (value) => {
    expect(() => assertMaxItems(value)).toThrow(StorageArgumentError);
  });
});
