import { describe, expect, it } from 'vitest';

import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import type { AsyncStorageDriver } from '../../../src/drivers/async-storage-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  assertAsyncStorageDriver,
  verifyAsyncStorageDriver,
} from '../../../src/testing/index.js';

describe('verifyAsyncStorageDriver', () => {
  it('passes the reference async driver, with and without a namespace', async () => {
    await assertAsyncStorageDriver(() => new AsyncMemoryDriver());
    await assertAsyncStorageDriver(
      () => new AsyncMemoryDriver({ namespace: 'ns' })
    );
  });

  it('checks [async] first, then the shared contract', async () => {
    const report = await verifyAsyncStorageDriver(
      () => new AsyncMemoryDriver()
    );

    expect(report.checks[0]?.rule).toBe('async');
    expect(report.checks).toHaveLength(12);
  });

  it('fails [async] for a sync driver', async () => {
    const report = await verifyAsyncStorageDriver(
      () => new MemoryDriver() as unknown as AsyncStorageDriver
    );

    expect(report.checks.find((check) => check.rule === 'async')?.passed).toBe(
      false
    );
  });

  it('detects a broken async driver', async () => {
    const report = await verifyAsyncStorageDriver(() => {
      const data = new Map<string, string>();
      return {
        name: 'broken',
        read: (key: string) => Promise.resolve(data.get(key) ?? null),
        write: (key: string, value: string) => {
          data.set(key, value.trim());
          return Promise.resolve();
        },
        remove: (key: string) => {
          data.delete(key);
          return Promise.resolve();
        },
      };
    });

    expect(report.checks.find((check) => check.rule === 'exact')?.passed).toBe(
      false
    );
  });
});
