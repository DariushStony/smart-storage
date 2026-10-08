import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StorageQuotaError,
  StorageUnavailableError,
  createVault,
  registerDriver,
  unregisterDriver,
} from '@dariushstony/smart-storage';
import type { StorageError, Vault } from '@dariushstony/smart-storage';
import { assertStorageDriver } from '@dariushstony/smart-storage/testing';

import { CookieDriver } from '../../../examples/cookie-driver/cookie-driver.js';

const vaults: Vault[] = [];

function clearCookies(): void {
  if (typeof document === 'undefined') return;
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

afterEach(() => {
  vaults.splice(0).forEach((vault) => vault.dispose());
  unregisterDriver('cookie');
  clearCookies();
});

describe('CookieDriver (examples/cookie-driver)', () => {
  it('honours the driver contract', async () => {
    await assertStorageDriver(() => new CookieDriver({ namespace: 'test' }), {
      largeValueLength: 1_000,
    });
  });

  it('works as a registered driver under a vault', () => {
    registerDriver('cookie', () => new CookieDriver({ namespace: 'app' }));
    const vault = createVault({ key: 'PREFS', driver: 'cookie' });
    vaults.push(vault);

    vault.set('theme', 'dark');

    expect(document.cookie).toContain('app%3APREFS=');
    expect(vault.get('theme')).toBe('dark');
  });

  it('turns an oversized cookie into StorageQuotaError', () => {
    registerDriver('cookie', () => new CookieDriver());
    const vault = createVault({ key: 'BIG', driver: 'cookie' });
    vaults.push(vault);

    expect(() => vault.set('text', 'x'.repeat(5_000))).toThrow(
      StorageQuotaError
    );
  });

  it('falls back to memory, and reports it, without a document', () => {
    vi.stubGlobal('document', undefined);
    registerDriver('cookie', () => new CookieDriver());
    const onError = vi.fn<(error: StorageError) => void>();

    const vault = createVault({ key: 'SSR', driver: 'cookie', onError });
    vaults.push(vault);
    vault.set('a', 1);

    expect(vault.get('a')).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });
});
