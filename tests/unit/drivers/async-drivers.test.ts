import { describe, expect, it } from 'vitest';

import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { BaseAsyncStorageDriver } from '../../../src/drivers/base-async-storage-driver.js';
import { StorageArgumentError } from '../../../src/errors.js';

class RecordingAsyncDriver extends BaseAsyncStorageDriver {
  override readonly name = 'recording';
  readonly data = new Map<string, string>();

  protected override readRaw(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  protected override writeRaw(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  // Throws synchronously on purpose: the base must still reject.
  protected override removeRaw(): Promise<void> {
    throw new Error('remove failed');
  }
}

describe('BaseAsyncStorageDriver', () => {
  it('prefixes keys with the namespace', async () => {
    const driver = new RecordingAsyncDriver({ namespace: 'app' });

    await driver.write('k', 'v');

    expect([...driver.data.keys()]).toEqual(['app:k']);
    expect(await driver.read('k')).toBe('v');
  });

  it('turns a synchronous throw in a raw method into a rejection', () => {
    const driver = new RecordingAsyncDriver();
    let result: Promise<void> | undefined;

    expect(() => {
      result = driver.remove('k');
    }).not.toThrow();
    return expect(result).rejects.toThrow('remove failed');
  });

  it('validates the namespace like the sync base class', () => {
    expect(() => new RecordingAsyncDriver({ namespace: 'a:b' })).toThrow(
      StorageArgumentError
    );
  });
});

describe('AsyncMemoryDriver', () => {
  it('round-trips through promises and keeps instances separate', async () => {
    const a = new AsyncMemoryDriver();
    await a.write('k', 'v');

    expect(a.name).toBe('memory');
    expect(await a.read('k')).toBe('v');
    expect(await new AsyncMemoryDriver().read('k')).toBeNull();
    await a.remove('k');
    expect(await a.read('k')).toBeNull();
  });
});
