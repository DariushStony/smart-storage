import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import type { StorageDriver } from '../../../src/drivers/storage-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';

describe.each([
  ['MemoryDriver', (): StorageDriver => new MemoryDriver(), 'memory'],
  [
    'WebStorageDriver',
    (): StorageDriver => new WebStorageDriver(localStorage, 'localStorage'),
    'localStorage',
  ],
] as const)('%s', (_label, build, expectedName) => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports its name', () => {
    expect(build().name).toBe(expectedName);
  });

  it('round-trips a value', () => {
    const driver = build();
    driver.write('k', 'v');
    expect(driver.read('k')).toBe('v');
  });

  it('returns null for a missing key', () => {
    expect(build().read('missing')).toBeNull();
  });

  it('overwrites a value', () => {
    const driver = build();
    driver.write('k', 'one');
    driver.write('k', 'two');
    expect(driver.read('k')).toBe('two');
  });

  it('removes a value and tolerates removing a missing key', () => {
    const driver = build();
    driver.write('k', 'v');
    driver.remove('k');
    driver.remove('never-there');
    expect(driver.read('k')).toBeNull();
  });
});

describe('WebStorageDriver', () => {
  it('writes through to the storage it wraps', () => {
    new WebStorageDriver(sessionStorage, 'sessionStorage').write('k', 'v');
    expect(sessionStorage.getItem('k')).toBe('v');
    sessionStorage.clear();
  });

  it('has a default name', () => {
    expect(new WebStorageDriver(localStorage).name).toBe('webStorage');
  });
});

describe('MemoryDriver', () => {
  it('keeps each instance separate', () => {
    const a = new MemoryDriver();
    a.write('k', 'v');
    expect(new MemoryDriver().read('k')).toBeNull();
  });
});
