import { describe, expect, it } from 'vitest';

import type { Codec } from '../../../src/codec/codec.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import { StorageArgumentError } from '../../../src/errors.js';
import { resolveOptions } from '../../../src/vault/options.js';
import type { VaultOptions } from '../../../src/vault/vault.js';

describe('resolveOptions', () => {
  it('fills in the defaults', () => {
    expect(resolveOptions({ key: 'K' })).toEqual({
      key: 'K',
      driver: 'local',
      codecs: [],
      debounceMs: 0,
      maxBytes: 4_000_000,
      maxItems: Infinity,
      onError: undefined,
    });
  });

  it('keeps provided values, including custom drivers and class codecs', () => {
    class Upper implements Codec {
      encode(text: string): string {
        return text.toUpperCase();
      }
      decode(text: string): string {
        return text.toLowerCase();
      }
    }
    const driver = new MemoryDriver();
    const codec = new Upper();
    const onError = (): void => undefined;

    expect(
      resolveOptions({
        key: 'K',
        driver,
        codecs: [codec],
        debounceMs: 50,
        maxBytes: 10,
        maxItems: 3,
        onError,
      })
    ).toEqual({
      key: 'K',
      driver,
      codecs: [codec],
      debounceMs: 50,
      maxBytes: 10,
      maxItems: 3,
      onError,
    });
  });

  // Migrating code often spreads old options into createVault(); silently
  // ignoring them would put session data in localStorage or skip codecs.
  it.each([
    ['storageType', 'driver'],
    ['storageKey', 'key'],
    ['maxSizeBytes', 'maxBytes'],
    ['maxItemsInMemory', 'maxItems'],
    ['logger', 'onError'],
    ['transforms', 'codecs'],
    ['transformChain', 'codecs'],
  ])(
    'rejects the 1.x option %s and names %s instead',
    (legacy, replacement) => {
      const options = { key: 'K', [legacy]: 'anything' } as VaultOptions;

      expect(() => resolveOptions(options)).toThrow(StorageArgumentError);
      expect(() => resolveOptions(options)).toThrow(replacement);
    }
  );

  it('accepts any driver name; unknown names fail when the vault is built', () => {
    expect(
      resolveOptions({ key: 'K', driver: 'not-registered-yet' }).driver
    ).toBe('not-registered-yet');
  });

  it.each([
    ['no options', undefined],
    ['null', null],
    ['a missing key', {}],
    ['an empty key', { key: '' }],
    ['an empty driver name', { key: 'K', driver: '' }],
    ['a driver without methods', { key: 'K', driver: {} }],
    ['codecs that are not an array', { key: 'K', codecs: {} }],
    ['a codec without methods', { key: 'K', codecs: [{}] }],
    ['a negative debounceMs', { key: 'K', debounceMs: -1 }],
    ['a zero maxBytes', { key: 'K', maxBytes: 0 }],
    ['a zero maxItems', { key: 'K', maxItems: 0 }],
    ['a non-function onError', { key: 'K', onError: 'log' }],
  ])('rejects %s', (_label, options) => {
    expect(() => resolveOptions(options as VaultOptions)).toThrow(
      StorageArgumentError
    );
  });
});
