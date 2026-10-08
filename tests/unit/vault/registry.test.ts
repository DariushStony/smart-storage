import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  registerDriver,
  resetDriverRegistry,
} from '../../../src/drivers/driver-registry.js';
import {
  StorageArgumentError,
  StorageConflictError,
  StorageDisposedError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { createVault } from '../../../src/vault/create-vault.js';
import type { Vault } from '../../../src/vault/vault.js';

const created: Vault[] = [];
const track = (vault: Vault): Vault => {
  created.push(vault);
  return vault;
};
const conflictSpy = (): Mock<(error: StorageError) => void> =>
  vi.fn<(error: StorageError) => void>();

beforeEach(() => {
  resetDriverRegistry();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  created.splice(0).forEach((vault) => vault.dispose());
  resetDriverRegistry();
  vi.useRealTimers();
});

describe('one live vault per storage key', () => {
  it('a newer vault takes over and the older one is retired', () => {
    const driver = new MemoryDriver();
    const first = track(createVault({ key: 'K', driver }));
    const onError = conflictSpy();
    const second = track(createVault({ key: 'K', driver, onError }));

    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
    expect(() => first.get('a')).toThrow(StorageDisposedError);
    expect(() => first.get('a')).toThrow(/took over/);

    second.set('a', 1);
    expect(second.get('a')).toBe(1);
  });

  it('the retired vault saves its pending write first', () => {
    vi.useFakeTimers();
    const driver = new MemoryDriver();
    const first = track(createVault({ key: 'K', driver, debounceMs: 1000 }));
    first.set('a', 1);

    const second = track(createVault({ key: 'K', driver }));

    expect(second.get('a')).toBe(1);
  });

  it('vaults on different keys do not conflict', () => {
    const driver = new MemoryDriver();
    const onError = conflictSpy();
    track(createVault({ key: 'A', driver }));
    track(createVault({ key: 'B', driver, onError }));

    expect(onError).not.toHaveBeenCalled();
  });

  // Review focus: localStorage and sessionStorage are separate stores.
  it('the same key on local and session storage does not conflict', () => {
    const onError = conflictSpy();
    const local = track(createVault({ key: 'K', driver: 'local', onError }));
    const session = track(
      createVault({ key: 'K', driver: 'session', onError })
    );

    local.set('where', 'local');
    session.set('where', 'session');

    expect(onError).not.toHaveBeenCalled();
    expect(local.get('where')).toBe('local');
    expect(session.get('where')).toBe('session');
  });

  it("two 'memory' vaults never conflict, since each has its own store", () => {
    const onError = conflictSpy();
    track(createVault({ key: 'K', driver: 'memory' }));
    track(createVault({ key: 'K', driver: 'memory', onError }));

    expect(onError).not.toHaveBeenCalled();
  });

  it('two vaults on the default local driver conflict', () => {
    const onError = conflictSpy();
    track(createVault({ key: 'K' }));
    track(createVault({ key: 'K', onError }));

    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
  });

  it('detects two vaults on one key through a registered driver name', () => {
    registerDriver('custom', () => new MemoryDriver());
    const onError = conflictSpy();
    track(createVault({ key: 'K', driver: 'custom' }));
    track(createVault({ key: 'K', driver: 'custom', onError }));

    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
  });

  it('rejects a driver name nobody registered', () => {
    expect(() => createVault({ key: 'K', driver: 'nope' })).toThrow(
      StorageArgumentError
    );
  });

  it('a disposed vault frees its key', () => {
    const driver = new MemoryDriver();
    createVault({ key: 'K', driver }).dispose();
    const onError = conflictSpy();
    track(createVault({ key: 'K', driver, onError }));

    expect(onError).not.toHaveBeenCalled();
  });

  it('disposing a retired vault does not free the key held by its successor', () => {
    const driver = new MemoryDriver();
    const first = createVault({ key: 'K', driver });
    track(createVault({ key: 'K', driver }));
    first.dispose();

    const onError = conflictSpy();
    track(createVault({ key: 'K', driver, onError }));

    expect(onError).toHaveBeenCalledWith(expect.any(StorageConflictError));
  });
});
