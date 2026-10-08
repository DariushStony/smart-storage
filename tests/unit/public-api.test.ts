import { describe, expect, it } from 'vitest';

import * as api from '../../src/index.js';

describe('package exports', () => {
  it('exports exactly the documented runtime values', () => {
    // Guards the README's API section against drift.
    expect(Object.keys(api).sort()).toEqual(
      [
        'AsyncMemoryDriver',
        'BaseAsyncStorageDriver',
        'BaseStorageDriver',
        'IndexedDBDriver',
        'MemoryDriver',
        'StorageAccessError',
        'StorageArgumentError',
        'StorageConflictError',
        'StorageCorruptionError',
        'StorageDisposedError',
        'StorageError',
        'StorageQuotaError',
        'StorageSerializationError',
        'StorageUnavailableError',
        'WebStorageDriver',
        'createAsyncVault',
        'createVault',
        'registerAsyncDriver',
        'registerDriver',
        'unregisterDriver',
      ].sort()
    );
  });

  it('works end to end through the public entry point', () => {
    const vault = api.createVault({ key: 'PUBLIC_API', driver: 'memory' });

    vault.set('k', 'v', { ttl: 60_000 });

    expect(vault.get('k')).toBe('v');
    vault.dispose();
  });

  it('accepts a public MemoryDriver and reports errors as StorageError', () => {
    const driver = new api.MemoryDriver();
    driver.write('BAD', 'not json');
    const errors: unknown[] = [];

    const vault = api.createVault({
      key: 'BAD',
      driver,
      onError: (error) => errors.push(error),
    });
    vault.get('k');

    expect(errors[0]).toBeInstanceOf(api.StorageError);
    vault.dispose();
  });
});

describe('testing entry', () => {
  it('exports exactly the kit', async () => {
    const testing = await import('../../src/testing/index.js');
    expect(Object.keys(testing).sort()).toEqual([
      'assertAsyncStorageDriver',
      'assertStorageDriver',
      'verifyAsyncStorageDriver',
      'verifyStorageDriver',
    ]);
  });
});
