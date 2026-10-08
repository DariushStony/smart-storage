import { beforeEach, describe, expect, it } from 'vitest';

import { BaseStorageDriver } from '../../../src/drivers/base-storage-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import { StorageArgumentError } from '../../../src/errors.js';

class RecordingDriver extends BaseStorageDriver {
  override readonly name = 'recording';
  readonly data = new Map<string, string>();

  protected override readRaw(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  protected override writeRaw(key: string, value: string): void {
    this.data.set(key, value);
  }

  protected override removeRaw(key: string): void {
    this.data.delete(key);
  }
}

beforeEach(() => {
  localStorage.clear();
});

describe('BaseStorageDriver', () => {
  it('delegates to the raw methods with the key unchanged by default', () => {
    const driver = new RecordingDriver();

    driver.write('k', 'v');

    expect([...driver.data.keys()]).toEqual(['k']);
    expect(driver.read('k')).toBe('v');
    driver.remove('k');
    expect(driver.data.size).toBe(0);
  });

  it('prefixes every key with the namespace', () => {
    const driver = new RecordingDriver({ namespace: 'app' });

    driver.write('k', 'v');

    expect([...driver.data.keys()]).toEqual(['app:k']);
    expect(driver.read('k')).toBe('v');
    driver.remove('k');
    expect(driver.data.size).toBe(0);
  });

  it('keeps two namespaces on one backend apart', () => {
    const a = new WebStorageDriver(localStorage, 'localStorage', {
      namespace: 'a',
    });
    const b = new WebStorageDriver(localStorage, 'localStorage', {
      namespace: 'b',
    });

    a.write('k', 'from a');
    b.write('k', 'from b');

    expect(a.read('k')).toBe('from a');
    expect(b.read('k')).toBe('from b');
    expect(localStorage.getItem('a:k')).toBe('from a');
  });

  it.each(['', '   ', 5])('rejects the namespace %j', (namespace) => {
    expect(
      () => new RecordingDriver({ namespace: namespace as string })
    ).toThrow(StorageArgumentError);
  });

  it('is the base of the built-in drivers', () => {
    expect(new MemoryDriver()).toBeInstanceOf(BaseStorageDriver);
    expect(new WebStorageDriver(localStorage)).toBeInstanceOf(
      BaseStorageDriver
    );
  });

  it('gives MemoryDriver a namespace option too', () => {
    const driver = new MemoryDriver({ namespace: 'ns' });
    driver.write('k', 'v');
    expect(driver.read('k')).toBe('v');
  });
});
