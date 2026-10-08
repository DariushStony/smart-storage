// Compiled against the built dist/ with skipLibCheck off, the way a strict
// consumer would, so broken declaration files fail the build.
import { StorageQuotaError, createVault } from '@dariushstony/smart-storage';
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';
import type { ConformanceReport } from '@dariushstony/smart-storage/testing';
import type {
  Codec,
  StorageDriver,
  Vault,
  VaultOptions,
} from '@dariushstony/smart-storage';

const codec: Codec = { encode: (text) => text, decode: (text) => text };
const options: VaultOptions = { key: 'CONSUMER', codecs: [codec] };
const vault: Vault = createVault(options);
vault.set('a', 1, { ttl: 1000 });

export const driverName = (driver: StorageDriver): string => driver.name;
export const isQuota = (error: unknown): boolean =>
  error instanceof StorageQuotaError;
export const causeOf = (error: StorageQuotaError): unknown => error.cause;
export const checkDriver = (driver: StorageDriver): Promise<void> =>
  assertStorageDriver(() => driver);
export const passed = (report: ConformanceReport): boolean => report.passed;
