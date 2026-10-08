import { describe, expect, it } from 'vitest';

import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import type { StorageDriver } from '../../../src/drivers/storage-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import type { WebStorageLike } from '../../../src/drivers/web-storage-driver.js';
import {
  assertStorageDriver,
  verifyStorageDriver,
} from '../../../src/testing/index.js';

const RULES = [
  'sync',
  'name',
  'missing',
  'roundtrip',
  'empty',
  'exact',
  'large',
  'overwrite',
  'remove',
  'remove-missing',
  'independent',
  'any-key',
];

type Override = (data: Map<string, string>) => object;

/** A correct Map-backed driver, with whatever `override` replaces. */
function brokenDriver(override: Override): () => StorageDriver {
  return () => {
    const data = new Map<string, string>();
    const correct = {
      name: 'broken',
      read: (key: string): string | null => data.get(key) ?? null,
      write: (key: string, value: string): void => {
        data.set(key, value);
      },
      remove: (key: string): void => {
        data.delete(key);
      },
    };
    return { ...correct, ...override(data) };
  };
}

/**
 * A spec-compliant Storage stand-in. happy-dom's Storage is backed by a plain
 * object, so its "__proto__" key fails [any-key] (the kit caught it); real
 * localStorage and sessionStorage are verified in Chromium by the e2e suite.
 */
function mapStorage(): WebStorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('the built-in drivers honour the contract', () => {
  it.each([
    ['MemoryDriver', (): StorageDriver => new MemoryDriver()],
    [
      'MemoryDriver with a namespace',
      (): StorageDriver => new MemoryDriver({ namespace: 'ns' }),
    ],
    [
      'WebStorageDriver',
      (): StorageDriver => new WebStorageDriver(mapStorage(), 'webStorage'),
    ],
    [
      'WebStorageDriver with a namespace',
      (): StorageDriver =>
        new WebStorageDriver(mapStorage(), 'webStorage', { namespace: 'ns' }),
    ],
  ])('%s', async (_label, create) => {
    await expect(assertStorageDriver(create)).resolves.toBeUndefined();
  });
});

describe('verifyStorageDriver', () => {
  it('reports every rule, in order, with the driver name', async () => {
    const report = await verifyStorageDriver(() => new MemoryDriver());

    expect(report.driver).toBe('memory');
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.rule)).toEqual(RULES);
  });

  it('removes every key it wrote, including the bare __proto__ key', async () => {
    const storage = mapStorage();
    await verifyStorageDriver(() => new WebStorageDriver(storage));

    expect([...storage.data.keys()]).toEqual([]);
  });

  it.each<[string, Override]>([
    [
      'sync',
      (data) => ({
        read: (key: string) => Promise.resolve(data.get(key) ?? null),
      }),
    ],
    ['name', () => ({ name: '' })],
    ['missing', (data) => ({ read: (key: string) => data.get(key) })],
    ['roundtrip', () => ({ write: () => undefined })],
    ['empty', (data) => ({ read: (key: string) => data.get(key) || null })],
    [
      'exact',
      (data) => ({
        write: (key: string, value: string) => {
          data.set(key, value.trim());
        },
      }),
    ],
    [
      'large',
      (data) => ({
        write: (key: string, value: string) => {
          data.set(key, value.slice(0, 1000));
        },
      }),
    ],
    [
      'overwrite',
      (data) => ({
        write: (key: string, value: string) => {
          if (!data.has(key)) data.set(key, value);
        },
      }),
    ],
    ['remove', () => ({ remove: () => undefined })],
    [
      'remove-missing',
      (data) => ({
        remove: (key: string) => {
          if (!data.delete(key)) throw new Error('no such key');
        },
      }),
    ],
    [
      'independent',
      (data) => ({
        read: (key: string) => data.get(key.toLowerCase()) ?? null,
        write: (key: string, value: string) => {
          data.set(key.toLowerCase(), value);
        },
        remove: (key: string) => {
          data.delete(key.toLowerCase());
        },
      }),
    ],
    [
      'any-key',
      () => {
        const record: Record<string, unknown> = {};
        return {
          read: (key: string) => (key in record ? record[key] : null),
          write: (key: string, value: string) => {
            record[key] = value;
          },
          remove: (key: string) => {
            Reflect.deleteProperty(record, key);
          },
        };
      },
    ],
  ])('detects a driver that breaks [%s]', async (rule, override) => {
    const report = await verifyStorageDriver(brokenDriver(override));

    const failed = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.rule);
    expect(failed).toContain(rule);
    expect(report.passed).toBe(false);
  });

  it('records a driver whose constructor throws as failing every rule', async () => {
    const report = await verifyStorageDriver(() => {
      throw new Error('no backend');
    });

    expect(report.driver).toBe('unknown');
    expect(report.checks.every((check) => !check.passed)).toBe(true);
  });

  it('lets small backends lower the large-value size', async () => {
    const truncating = brokenDriver((data) => ({
      write: (key: string, value: string) => {
        data.set(key, value.slice(0, 1000));
      },
    }));

    const report = await verifyStorageDriver(truncating, {
      largeValueLength: 500,
    });

    expect(report.passed).toBe(true);
  });
});

describe('assertStorageDriver', () => {
  it('throws an error naming each broken rule', async () => {
    await expect(
      assertStorageDriver(brokenDriver(() => ({ remove: () => undefined })))
    ).rejects.toThrow(/\[remove\] read returns null after remove/);
  });
});
