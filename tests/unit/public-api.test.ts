import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as api from '../../src/index.js';
import {
  InlineTransformHandler,
  LoggingHandler,
  StorageStatistics,
  StorageType,
  StorageVault,
  TransformChain,
  TransformHandler,
  disposeStorageSlice,
  getStorageSlice,
} from '../../src/index.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  StorageVault.clearAllInstances();
});

describe('package exports', () => {
  it('exports every documented runtime value', () => {
    // Guards the README's Exports section against drift.
    expect(Object.keys(api).sort()).toEqual(
      [
        'InlineTransformHandler',
        'LoggingHandler',
        'StorageStatistics',
        'StorageType',
        'StorageVault',
        'TransformChain',
        'TransformHandler',
        'disposeStorageSlice',
        'getStorageSlice',
      ].sort()
    );
  });

  it('exports StorageType as a usable runtime value, not just a type', () => {
    // The README previously documented this as a type-only import, which
    // would break `StorageType.Local` at runtime.
    expect(StorageType.Local).toBe('local');
    expect(StorageType.Session).toBe('session');
    expect(StorageType.InMemory).toBe('in-memory');
  });

  it('exports the transform primitives as constructible classes', () => {
    expect(typeof TransformHandler).toBe('function');
    expect(typeof InlineTransformHandler).toBe('function');
    expect(typeof TransformChain.from).toBe('function');
    expect(typeof LoggingHandler).toBe('function');
    expect(typeof StorageStatistics).toBe('function');
  });
});

describe('getStorageSlice', () => {
  it('returns a StorageVault', () => {
    expect(
      getStorageSlice('API_BASIC', { storageType: StorageType.InMemory })
    ).toBeInstanceOf(StorageVault);
  });

  it('stores the slice under the key it was given', () => {
    const slice = getStorageSlice('API_KEYED', {
      storageType: StorageType.Local,
      debounceMs: 0,
    });

    slice.setItem('k', 'v');

    expect(slice.getStorageKey()).toBe('API_KEYED');
    expect(localStorage.getItem('API_KEYED')).not.toBeNull();
  });

  it('defaults to localStorage', () => {
    const slice = getStorageSlice('API_DEFAULT');
    expect(slice.getStorageAdapter().getStorageType()).toBe('localStorage');
  });

  it('is a singleton per slice key', () => {
    expect(getStorageSlice('API_SAME')).toBe(getStorageSlice('API_SAME'));
  });

  it('honours the storageType option', () => {
    const session = getStorageSlice('API_SESSION', {
      storageType: StorageType.Session,
    });
    expect(session.getStorageAdapter().getStorageType()).toBe('sessionStorage');
  });

  it('accepts transforms and applies them', () => {
    const slice = getStorageSlice('API_TRANSFORMS', {
      storageType: StorageType.Local,
      debounceMs: 0,
      transforms: [{ serialize: btoa, deserialize: atob }],
    });

    slice.setItem('secret', 'value');

    expect(localStorage.getItem('API_TRANSFORMS')).not.toContain('value');
    expect(slice.getItem('secret')).toBe('value');
  });

  it('accepts a prebuilt transformChain', () => {
    const chain = TransformChain.from([{ serialize: btoa, deserialize: atob }]);
    const slice = getStorageSlice('API_CHAIN', {
      storageType: StorageType.InMemory,
      transformChain: chain,
    });

    expect(slice.getTransformChain()).toBe(chain);
  });

  it('supports the documented LoggingHandler wiring', () => {
    const messages: string[] = [];
    const slice = getStorageSlice('API_LOGGING', {
      storageType: StorageType.InMemory,
      debounceMs: 0,
      transforms: [new LoggingHandler({ log: (m) => messages.push(m) })],
    });

    slice.setItem('k', 'v');

    // Logging must not corrupt the payload.
    expect(slice.getItem('k')).toBe('v');
  });

  it('supports the documented StorageStatistics wiring', () => {
    const slice = getStorageSlice('API_STATS', {
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });
    slice.setItem('a', 1);

    const statistics = new StorageStatistics(
      slice.getStorageAdapter(),
      slice.getStorageKey(),
      slice.getTransformChain(),
      slice.getMaxSizeBytes()
    );

    expect(statistics.collect(() => slice.getAllData()).itemCount).toBe(1);
  });
});

describe('disposeStorageSlice', () => {
  it('disposes a slice and reports true', () => {
    getStorageSlice('API_DISPOSE', { storageType: StorageType.InMemory });

    expect(
      disposeStorageSlice('API_DISPOSE', {
        storageType: StorageType.InMemory,
      })
    ).toBe(true);
  });

  it('reports false for a slice that was never created', () => {
    expect(disposeStorageSlice('API_NEVER')).toBe(false);
  });

  it('hands out a new instance after disposal', () => {
    const first = getStorageSlice('API_REBUILD', {
      storageType: StorageType.InMemory,
    });

    disposeStorageSlice('API_REBUILD', {
      storageType: StorageType.InMemory,
    });

    expect(
      getStorageSlice('API_REBUILD', { storageType: StorageType.InMemory })
    ).not.toBe(first);
  });

  it('requires the storageType used at creation', () => {
    getStorageSlice('API_TYPED', { storageType: StorageType.Session });

    // Identity is storageType + key, so the default 'local' misses.
    expect(disposeStorageSlice('API_TYPED')).toBe(false);
    expect(
      disposeStorageSlice('API_TYPED', { storageType: StorageType.Session })
    ).toBe(true);
  });

  it('leaves persisted data in place, only dropping the instance', () => {
    const slice = getStorageSlice('API_PERSIST', {
      storageType: StorageType.Local,
      debounceMs: 0,
    });
    slice.setItem('k', 'v');

    disposeStorageSlice('API_PERSIST', { storageType: StorageType.Local });

    // A fresh instance re-reads whatever is still under the key.
    const rebuilt = getStorageSlice('API_PERSIST', {
      storageType: StorageType.Local,
      debounceMs: 0,
    });
    expect(rebuilt.getItem('k')).toBe('v');
  });
});

describe('README example fidelity', () => {
  it('runs the Quick Start snippet', () => {
    const storage = getStorageSlice('MY_APP', {
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });

    storage.setItem('theme', 'dark');

    expect(storage.getItem<string>('theme')).toBe('dark');
  });

  it('runs the TTL snippet', () => {
    const storage = getStorageSlice('TTL_DOC', {
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });

    storage.setItem('token', 'abc123', 60 * 60 * 1000);
    storage.setItem('config', { theme: 'dark' });
    storage.setItem('temp', 'data', 0);

    expect(storage.getItem('token')).toBe('abc123');
    expect(storage.getItem('config')).toEqual({ theme: 'dark' });
    expect(storage.getItem('temp')).toBeNull();
  });

  it('runs the feature-flag pattern', () => {
    const featureFlags = getStorageSlice('FEATURE_FLAGS', {
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });

    featureFlags.setItem('feature:new-checkout', true, 7 * 24 * 3600 * 1000);

    expect(featureFlags.hasItem('feature:new-checkout')).toBe(true);
    expect(featureFlags.hasItem('feature:absent')).toBe(false);
  });
});
