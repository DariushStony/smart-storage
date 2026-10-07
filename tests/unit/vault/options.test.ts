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

  it.each([
    ['no options', undefined],
    ['null', null],
    ['a missing key', {}],
    ['an empty key', { key: '' }],
    ['an unknown driver name', { key: 'K', driver: 'indexeddb' }],
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
