import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageLogger } from '../../src/logger/storage-logger.js';
import { StorageType } from '../../src/storage/storage-type.js';
import { StorageVault } from '../../src/vault/storage-vault.js';

/**
 * `logger` was a public option up to 1.0.x and 1.1.0 dropped it silently. These
 * tests pin the messages consumers rely on to report storage trouble.
 */
let counter = 0;
function makeVault(
  options: Parameters<typeof StorageVault.getInstance>[0] = {}
): {
  vault: StorageVault;
  log: ReturnType<typeof vi.fn<StorageLogger['log']>>;
} {
  const log = vi.fn<StorageLogger['log']>();
  counter += 1;
  const vault = StorageVault.getInstance({
    storageKey: `LOGGER_${String(counter)}`,
    storageType: StorageType.InMemory,
    debounceMs: 0,
    logger: { log },
    ...options,
  });
  return { vault, log };
}

function quotaError(): DOMException {
  return new DOMException('full', 'QuotaExceededError');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  StorageVault.clearAllInstances();
  vi.useRealTimers();
});

describe('logger option: reading', () => {
  it('logs and clears storage that holds unparseable data', () => {
    const { vault, log } = makeVault({
      storageKey: 'LOG_CORRUPT',
      storageType: StorageType.Local,
    });
    localStorage.setItem('LOG_CORRUPT', 'not json{{{');

    expect(vault.getAll()).toEqual({});

    expect(log).toHaveBeenCalledWith(
      'Storage data corrupted or invalid, clearing storage',
      expect.objectContaining({
        storageKey: 'LOG_CORRUPT',
        error: expect.any(Error) as unknown,
      })
    );
    expect(localStorage.getItem('LOG_CORRUPT')).toBeNull();
  });

  it('logs when the corrupted payload cannot be cleared either', () => {
    const { vault, log } = makeVault();
    const adapter = vault.getStorageAdapter();
    adapter.write(vault.getStorageKey(), '}{');
    vi.spyOn(adapter, 'remove').mockImplementation(() => {
      throw new Error('locked');
    });

    expect(vault.getAll()).toEqual({});

    expect(log).toHaveBeenCalledWith(
      'Failed to clear corrupted storage',
      expect.any(Error)
    );
  });

  it('logs and returns 0 when the size cannot be computed', () => {
    const { vault, log } = makeVault();
    vi.spyOn(vault, 'getAllData').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(vault.getCurrentSize()).toBe(0);

    expect(log).toHaveBeenCalledWith(
      'Error calculating storage size',
      expect.any(Error)
    );
  });
});

describe('logger option: writing', () => {
  it('logs the quota breach, the cleanup and the failed retry', () => {
    const { vault, log } = makeVault();
    vi.spyOn(vault.getStorageAdapter(), 'write').mockImplementation(() => {
      throw quotaError();
    });

    expect(() => vault.setItem('k', 'v')).toThrow(/quota exceeded/i);

    expect(log).toHaveBeenCalledWith(
      'Storage quota exceeded, attempting cleanup',
      expect.any(DOMException)
    );
    expect(log).toHaveBeenCalledWith('Cleanup removed 0 expired items');
    expect(log).toHaveBeenCalledWith(
      'Storage quota exceeded even after cleanup',
      expect.any(DOMException)
    );
  });

  it('logs a circular reference', () => {
    const { vault, log } = makeVault();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => vault.setItem('k', cyclic)).toThrow(/circular references/i);

    expect(log).toHaveBeenCalledWith(
      'Circular reference detected in stored data',
      expect.any(TypeError)
    );
  });

  it('logs any other write failure', () => {
    const { vault, log } = makeVault();
    vi.spyOn(vault.getStorageAdapter(), 'write').mockImplementation(() => {
      throw new Error('disk on fire');
    });

    expect(() => vault.setItem('k', 'v')).toThrow(/failed to save/i);

    expect(log).toHaveBeenCalledWith(
      'Error saving to storage',
      expect.any(Error)
    );
  });

  it('logs a debounced save that fails, and keeps the data for a retry', () => {
    vi.useFakeTimers();
    const { vault, log } = makeVault({ debounceMs: 50 });
    const writeSpy = vi
      .spyOn(vault.getStorageAdapter(), 'write')
      .mockImplementation(() => {
        throw new Error('disk on fire');
      });

    vault.setItem('k', 'v');
    vi.advanceTimersByTime(60);

    expect(log).toHaveBeenCalledWith(
      'Debounced save failed',
      expect.any(Error)
    );
    expect(vault.getItem('k')).toBe('v');

    // The data stays dirty for a retry; let the teardown flush succeed.
    writeSpy.mockRestore();
  });

  it('warns when a payload exceeds maxSizeBytes, but still writes it', () => {
    const { vault, log } = makeVault({ maxSizeBytes: 50 });

    expect(vault.setItem('k', 'x'.repeat(200))).toBe(true);

    expect(log).toHaveBeenCalledWith('Storage approaching quota limit', {
      byteSize: expect.any(Number) as unknown,
      stringLength: expect.any(Number) as unknown,
      maxSizeBytes: 50,
    });
    expect(vault.getItem('k')).toBe('x'.repeat(200));
  });

  it('logs when in-memory storage drops its oldest items', () => {
    const { vault, log } = makeVault({ maxItemsInMemory: 2 });

    vault.setItem('a', 1);
    vault.setItem('b', 2);
    vault.setItem('c', 3);

    expect(log).toHaveBeenCalledWith(
      'In-memory storage item limit exceeded, cleaning up oldest items',
      { itemCount: 3, maxItems: 2 }
    );
  });

  it('logs a failed clear() and still throws', () => {
    const { vault, log } = makeVault();
    vi.spyOn(vault.getStorageAdapter(), 'remove').mockImplementation(() => {
      throw new Error('locked');
    });

    expect(() => vault.clear()).toThrow(/failed to clear storage/i);

    expect(log).toHaveBeenCalledWith('Error clearing storage', {
      error: expect.any(Error) as unknown,
      storageKey: vault.getStorageKey(),
    });
  });
});

describe('logger option: storage backend', () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage'
  );

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
  });

  it('logs when web storage is blocked and the vault falls back to memory', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });

    const { vault, log } = makeVault({ storageType: StorageType.Session });

    expect(log).toHaveBeenCalledWith(
      'Web storage is not accessible. Falling back to in-memory storage.',
      expect.any(DOMException)
    );
    // The vault still works, backed by memory.
    vault.setItem('k', 'v');
    expect(vault.getItem('k')).toBe('v');
    expect(vault.getStorageAdapter().getStorageType()).toBe('memory');
  });
});

describe('logger option: identity and defaults', () => {
  it('is optional: nothing is logged or thrown without it', () => {
    counter += 1;
    const vault = StorageVault.getInstance({
      storageKey: `LOGGER_${String(counter)}`,
      storageType: StorageType.InMemory,
      debounceMs: 0,
    });
    vi.spyOn(vault.getStorageAdapter(), 'write').mockImplementation(() => {
      throw new Error('disk on fire');
    });

    expect(() => vault.setItem('k', 'v')).toThrow(/failed to save/i);
  });

  it('does not change the singleton key: the first logger keeps the slice', () => {
    const first = makeVault({ storageKey: 'LOG_SHARED' });
    const secondLog = vi.fn<StorageLogger['log']>();

    const again = StorageVault.getInstance({
      storageKey: 'LOG_SHARED',
      storageType: StorageType.InMemory,
      logger: { log: secondLog },
    });

    expect(again).toBe(first.vault);
  });
});
