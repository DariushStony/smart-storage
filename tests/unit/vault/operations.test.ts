import { describe, expect, it } from 'vitest';

import type { Entry } from '../../../src/core/entry.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { StorageArgumentError } from '../../../src/errors.js';
import {
  extendOp,
  getOp,
  hasOp,
  keysOp,
  purgeExpiredOp,
  removeOp,
  setOp,
  toObjectOp,
  ttlOp,
  updateOp,
} from '../../../src/vault/operations.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

const snapshot = Snapshot.empty
  .with('a', entry(1))
  .with('t', entry(2, 1500))
  .with('old', entry(3, 500));

describe('building an operation', () => {
  it('validates the arguments before any snapshot is involved', () => {
    expect(() => getOp('')).toThrow(StorageArgumentError);
    expect(() => setOp('k', undefined)).toThrow(StorageArgumentError);
    expect(() => setOp('k', 1, { ttl: 0 })).toThrow(StorageArgumentError);
    expect(() => setOp('k', 1, null as unknown as { ttl?: number })).toThrow(
      StorageArgumentError
    );
    expect(() => updateOp('k', undefined)).toThrow(StorageArgumentError);
    expect(() => extendOp('k', -1)).toThrow(StorageArgumentError);
    expect(() => removeOp(' ')).toThrow(StorageArgumentError);
  });
});

describe('queries', () => {
  it('return results and never a next snapshot', () => {
    expect(getOp('a')(snapshot, 1000)).toEqual({ result: 1 });
    expect(hasOp('old')(snapshot, 1000)).toEqual({ result: false });
    expect(ttlOp('t')(snapshot, 1000)).toEqual({ result: 500 });
    expect(ttlOp('a')(snapshot, 1000)).toEqual({ result: Infinity });
    expect(keysOp()(snapshot, 1000)).toEqual({ result: ['a', 't'] });
    expect(toObjectOp()(snapshot, 1000)).toEqual({ result: { a: 1, t: 2 } });
  });
});

describe('writes', () => {
  it('setOp stores the value with an absolute expiry', () => {
    const { next } = setOp('k', 'v', { ttl: 100 })(Snapshot.empty, 1000);
    expect(next?.get('k', 1000)).toEqual({ json: '"v"', expiresAt: 1100 });
  });

  it('updateOp keeps the expiry and reports a missing key', () => {
    expect(updateOp('t', 9)(snapshot, 1000).next?.get('t', 1000)).toEqual(
      entry(9, 1500)
    );
    expect(updateOp('missing', 9)(snapshot, 1000)).toEqual({ result: false });
  });

  it('extendOp leaves a non-expiring entry alone without a next snapshot', () => {
    expect(extendOp('a', 100)(snapshot, 1000)).toEqual({ result: true });
    expect(extendOp('t', 100)(snapshot, 1000).next?.get('t', 1000)).toEqual(
      entry(2, 1600)
    );
  });

  it('removeOp and purgeExpiredOp produce a next snapshot only on change', () => {
    expect(removeOp('missing')(snapshot, 1000)).toEqual({ result: false });
    expect(removeOp('a')(snapshot, 1000).next?.get('a', 1000)).toBeUndefined();
    expect(purgeExpiredOp()(snapshot, 1000).result).toBe(1);
    expect(purgeExpiredOp()(Snapshot.empty, 1000)).toEqual({ result: 0 });
  });
});
