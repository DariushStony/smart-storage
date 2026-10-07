import { describe, expect, it } from 'vitest';

import {
  StorageAccessError,
  StorageArgumentError,
  StorageConflictError,
  StorageCorruptionError,
  StorageDisposedError,
  StorageError,
  StorageQuotaError,
  StorageSerializationError,
  StorageUnavailableError,
  toStorageError,
} from '../../src/errors.js';

describe('StorageError hierarchy', () => {
  it.each([
    ['StorageArgumentError', StorageArgumentError, 'INVALID_ARGUMENT'],
    ['StorageQuotaError', StorageQuotaError, 'QUOTA_EXCEEDED'],
    ['StorageSerializationError', StorageSerializationError, 'SERIALIZATION'],
    ['StorageAccessError', StorageAccessError, 'ACCESS'],
    ['StorageDisposedError', StorageDisposedError, 'DISPOSED'],
    ['StorageCorruptionError', StorageCorruptionError, 'CORRUPTED'],
    ['StorageUnavailableError', StorageUnavailableError, 'UNAVAILABLE'],
    ['StorageConflictError', StorageConflictError, 'CONFLICT'],
  ] as const)('%s has a stable name and code', (name, ErrorClass, code) => {
    const error = new ErrorClass('boom');

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.message).toBe('boom');
  });

  it('keeps the cause it was given', () => {
    const cause = new Error('root');
    expect(new StorageQuotaError('full', { cause }).cause).toBe(cause);
  });

  it('has no cause when none was given', () => {
    expect(new StorageQuotaError('full').cause).toBeUndefined();
  });
});

describe('toStorageError', () => {
  it('returns a StorageError unchanged', () => {
    const error = new StorageQuotaError('full');
    expect(toStorageError(error, 'ignored')).toBe(error);
  });

  it('wraps anything else as a StorageAccessError with the original as cause', () => {
    const cause = new Error('denied');
    const wrapped = toStorageError(cause, 'Write failed.');

    expect(wrapped).toBeInstanceOf(StorageAccessError);
    expect(wrapped.message).toBe('Write failed.');
    expect(wrapped.cause).toBe(cause);
  });
});
