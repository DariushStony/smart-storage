import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageStatistics } from '../../src/statistics/storage-statistics.js';
import { StorageType } from '../../src/storage/storage-type.js';
import { StorageVault } from '../../src/vault/storage-vault.js';
import type { DataRecord } from '../../src/vault/types.js';

/** Wires a collector to a vault the way the documentation instructs. */
function attach(vault: StorageVault): StorageStatistics {
  return new StorageStatistics(
    vault.getStorageAdapter(),
    vault.getStorageKey(),
    vault.getTransformChain(),
    vault.getMaxSizeBytes()
  );
}

let counter = 0;
function makeVault(
  options: Parameters<typeof StorageVault.getInstance>[0] = {}
): StorageVault {
  counter += 1;
  return StorageVault.getInstance({
    storageKey: `STATS_${String(counter)}`,
    storageType: StorageType.InMemory,
    debounceMs: 0,
    ...options,
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  StorageVault.clearAllInstances();
  vi.restoreAllMocks();
  // Centralised so a failing assertion inside a fake-timer test cannot leak
  // the frozen clock into later tests in this file, where the resulting
  // failure would surface somewhere unrelated.
  vi.useRealTimers();
});

describe('StorageStatistics.collect', () => {
  it('reports no items for an empty slice', () => {
    const vault = makeVault();
    const stats = attach(vault).collect(() => vault.getAllData());

    expect(stats.itemCount).toBe(0);
    // An empty slice still serialises to "{}", so the footprint is 2 bytes
    // rather than 0 -- negligible against the quota, but not exactly zero.
    expect(stats.sizeBytes).toBe(2);
    expect(stats.stringLength).toBe(2);
    expect(stats.quotaPercentage).toBeGreaterThan(0);
    expect(stats.quotaPercentage).toBeLessThan(0.001);
  });

  it('counts stored items', () => {
    const vault = makeVault();
    vault.setItem('a', 1);
    vault.setItem('b', 2);
    vault.setItem('c', 3);

    expect(attach(vault).collect(() => vault.getAllData()).itemCount).toBe(3);
  });

  it('reports size in bytes and string length', () => {
    const vault = makeVault();
    vault.setItem('k', 'a'.repeat(100));

    const stats = attach(vault).collect(() => vault.getAllData());

    expect(stats.sizeBytes).toBeGreaterThan(100);
    expect(stats.stringLength).toBeGreaterThan(100);
  });

  it('surfaces the configured quota ceiling', () => {
    const vault = makeVault({ maxSizeBytes: 10_000 });
    expect(attach(vault).collect(() => vault.getAllData()).maxSizeBytes).toBe(
      10_000
    );
  });

  it('computes quota percentage against maxSizeBytes', () => {
    const vault = makeVault({ maxSizeBytes: 1000 });
    vault.setItem('k', 'a'.repeat(400));

    const stats = attach(vault).collect(() => vault.getAllData());

    // sizeBytes/1000*100, so a 400-char payload lands well above 10%.
    expect(stats.quotaPercentage).toBeGreaterThan(10);
    expect(stats.quotaPercentage).toBeCloseTo(
      (stats.sizeBytes / 1000) * 100,
      5
    );
  });

  it.each([
    [StorageType.Local, 'localStorage'],
    [StorageType.Session, 'sessionStorage'],
    [StorageType.InMemory, 'memory'],
  ])('reports the %s backend as %s', (type, expected) => {
    const vault = makeVault({ storageType: type });
    expect(attach(vault).collect(() => vault.getAllData()).storageType).toBe(
      expected
    );
  });

  it('reports an unavailable backend without throwing', () => {
    const vault = makeVault({ maxSizeBytes: 4242 });
    vi.spyOn(vault.getStorageAdapter(), 'isAvailable').mockReturnValue(false);

    const stats = attach(vault).collect(() => vault.getAllData());

    expect(stats).toEqual({
      itemCount: 0,
      sizeBytes: 0,
      stringLength: 0,
      maxSizeBytes: 4242,
      quotaPercentage: 0,
      storageType: 'unavailable',
    });
  });

  it('does not read data when the backend is unavailable', () => {
    const vault = makeVault();
    vi.spyOn(vault.getStorageAdapter(), 'isAvailable').mockReturnValue(false);
    const reader = vi.fn<() => DataRecord>(() => ({}));

    attach(vault).collect(reader);

    expect(reader).not.toHaveBeenCalled();
  });

  it('counts expired-but-not-yet-evicted items', () => {
    vi.useFakeTimers();
    const vault = makeVault();
    vault.setItem('dead', 'v', 1000);
    vi.advanceTimersByTime(1001);

    // collect() reflects raw stored records, and expiry is lazy, so the
    // entry still counts until something evicts it.
    const stats = attach(vault).collect(() => vault.getAllData());
    expect(stats.itemCount).toBe(1);

    vault.cleanupExpiredItems();

    expect(attach(vault).collect(() => vault.getAllData()).itemCount).toBe(0);
  });

  it('reflects a fresh reading on each call', () => {
    const vault = makeVault();
    const statistics = attach(vault);

    expect(statistics.collect(() => vault.getAllData()).itemCount).toBe(0);
    vault.setItem('k', 'v');
    expect(statistics.collect(() => vault.getAllData()).itemCount).toBe(1);
  });
});
