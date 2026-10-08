// Compiled against the built dist/ with skipLibCheck off, the way a strict
// consumer would, so broken declaration files fail the build.
import {
  StorageQuotaError,
  createAsyncVault,
  createVault,
} from '@dariushstony/smart-storage';
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';
import type { ConformanceReport } from '@dariushstony/smart-storage/testing';
import type {
  AsyncCodec,
  AsyncVault,
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

// Kept identical to the README's Web Crypto example, so the docs compile.
const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function aesGcm(key: CryptoKey): AsyncCodec {
  return {
    async encode(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new TextEncoder().encode(text);
      const sealed = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );
      return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
    },
    async decode(text) {
      const [iv = '', sealed = ''] = text.split('.');
      const data = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(iv) },
        key,
        fromBase64(sealed)
      );
      return new TextDecoder().decode(data);
    },
  };
}

export const secrets = (key: CryptoKey): AsyncVault =>
  createAsyncVault({ key: 'NOTES', codecs: [aesGcm(key)] });
