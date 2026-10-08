/**
 * Test kit for storage drivers: proves a driver honours the contract the
 * vault relies on. Plain async functions, so it works with any test runner.
 *
 * @example
 * import { assertStorageDriver } from '@dariushstony/smart-storage/testing';
 *
 * it('honours the driver contract', async () => {
 *   await assertStorageDriver(() => new MyDriver());
 * });
 */
import type { AsyncStorageDriver } from '../drivers/async-storage-driver.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import {
  ASYNC_CHECK,
  SYNC_CHECK,
  formatFailures,
  runConformance,
} from './conformance.js';
import type {
  ConformanceCheck,
  ConformanceReport,
  VerifyOptions,
} from './conformance.js';

/** Runs every contract check, each against a fresh driver from `create`. */
function verifyStorageDriver(
  create: () => StorageDriver,
  options?: VerifyOptions
): Promise<ConformanceReport> {
  return runConformance(create, SYNC_CHECK, options);
}

/** Like verifyStorageDriver, but throws an Error listing every broken rule. */
async function assertStorageDriver(
  create: () => StorageDriver,
  options?: VerifyOptions
): Promise<void> {
  const report = await verifyStorageDriver(create, options);
  if (!report.passed) throw new Error(formatFailures(report));
}

/** Runs every contract check against async drivers from `create`. */
function verifyAsyncStorageDriver(
  create: () => AsyncStorageDriver,
  options?: VerifyOptions
): Promise<ConformanceReport> {
  return runConformance(create, ASYNC_CHECK, options);
}

/** Like verifyAsyncStorageDriver, but throws an Error listing every broken rule. */
async function assertAsyncStorageDriver(
  create: () => AsyncStorageDriver,
  options?: VerifyOptions
): Promise<void> {
  const report = await verifyAsyncStorageDriver(create, options);
  if (!report.passed) throw new Error(formatFailures(report));
}

export {
  verifyStorageDriver,
  assertStorageDriver,
  verifyAsyncStorageDriver,
  assertAsyncStorageDriver,
};
export type { ConformanceCheck, ConformanceReport, VerifyOptions };
