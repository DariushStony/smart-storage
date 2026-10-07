import { describe, expect, it } from 'vitest';

import type { Entry } from '../../../src/core/entry.js';
import { Snapshot } from '../../../src/core/snapshot.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

const keysOf = (snapshot: Snapshot, now = 0): string[] =>
  snapshot.live(now).map(([key]) => key);

describe('Snapshot', () => {
  it('starts empty', () => {
    expect(Snapshot.empty.size).toBe(0);
    expect(Snapshot.empty.all()).toEqual([]);
  });

  it('builds from entries in order', () => {
    const snapshot = Snapshot.from([
      ['b', entry(2)],
      ['a', entry(1)],
    ]);
    expect(keysOf(snapshot)).toEqual(['b', 'a']);
  });

  it('with() returns a new snapshot and leaves the original untouched', () => {
    const before = Snapshot.empty;
    const after = before.with('a', entry(1));

    expect(before.size).toBe(0);
    expect(after.get('a', 0)).toEqual(entry(1));
  });

  it('with() moves a rewritten key to the most-recently-written end', () => {
    const snapshot = Snapshot.empty
      .with('a', entry(1))
      .with('b', entry(2))
      .with('a', entry(3));

    expect(keysOf(snapshot)).toEqual(['b', 'a']);
    expect(snapshot.get('a', 0)).toEqual(entry(3));
  });

  it('get() hides expired entries', () => {
    const snapshot = Snapshot.empty.with('a', entry(1, 100));

    expect(snapshot.get('a', 99)).toEqual(entry(1, 100));
    expect(snapshot.get('a', 100)).toBeUndefined();
    expect(snapshot.get('missing', 0)).toBeUndefined();
  });

  it('without() removes a key', () => {
    const snapshot = Snapshot.empty.with('a', entry(1)).with('b', entry(2));
    expect(keysOf(snapshot.without('a'))).toEqual(['b']);
  });

  it('without() returns the same snapshot for a missing key', () => {
    const snapshot = Snapshot.empty.with('a', entry(1));
    expect(snapshot.without('zz')).toBe(snapshot);
  });

  it('live() skips expired entries and keeps write order', () => {
    const snapshot = Snapshot.empty
      .with('old', entry(1, 50))
      .with('a', entry(2))
      .with('b', entry(3, 500));

    expect(keysOf(snapshot, 100)).toEqual(['a', 'b']);
  });

  it('all() includes expired entries', () => {
    const snapshot = Snapshot.empty.with('old', entry(1, 50));
    expect(snapshot.all()).toEqual([['old', entry(1, 50)]]);
  });

  it('compact() drops expired entries', () => {
    const snapshot = Snapshot.empty
      .with('old', entry(1, 50))
      .with('a', entry(2));
    expect(snapshot.compact(100, Infinity).all()).toEqual([['a', entry(2)]]);
  });

  it('compact() evicts least-recently-written entries beyond maxItems', () => {
    const snapshot = Snapshot.empty
      .with('a', entry(1))
      .with('b', entry(2))
      .with('c', entry(3));

    expect(keysOf(snapshot.compact(0, 2))).toEqual(['b', 'c']);
  });

  it('compact() returns the same snapshot when nothing changes', () => {
    const snapshot = Snapshot.empty.with('a', entry(1));
    expect(snapshot.compact(0, Infinity)).toBe(snapshot);
  });
});
