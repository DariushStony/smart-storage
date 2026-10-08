import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { composeAsyncCodecs } from '../../../src/codec/async-codec.js';
import type { Entry } from '../../../src/core/entry.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { StorageQuotaError } from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { AsyncSnapshotRepository } from '../../../src/persistence/async-snapshot-repository.js';
import { AsyncSnapshotSerializer } from '../../../src/persistence/async-snapshot-serializer.js';
import {
  AsyncDebouncedWriteStrategy,
  AsyncImmediateWriteStrategy,
} from '../../../src/persistence/async-write-strategy.js';
import type { PageLifecycle } from '../../../src/persistence/page-lifecycle.js';
import { OperationQueue } from '../../../src/vault/operation-queue.js';

const entry = (value: unknown): Entry => ({
  json: JSON.stringify(value),
  expiresAt: null,
});
const one = Snapshot.empty.with('a', entry(1));
const big = one.with('b', entry('x'.repeat(100)));

interface Setup {
  driver: AsyncMemoryDriver;
  store: AsyncSnapshotRepository;
  report: Mock<(error: StorageError) => void>;
}

function setup(maxBytes = 1_000_000): Setup {
  const driver = new AsyncMemoryDriver();
  const report = vi.fn<(error: StorageError) => void>();
  const store = new AsyncSnapshotRepository({
    driver,
    key: 'K',
    serializer: new AsyncSnapshotSerializer(composeAsyncCodecs([])),
    maxBytes,
    report,
  });
  return { driver, store, report };
}

describe('AsyncImmediateWriteStrategy', () => {
  it('saves on write; flush, discard and dispose do nothing', async () => {
    const { driver, store } = setup();
    const strategy = new AsyncImmediateWriteStrategy(store);

    await strategy.write(one);
    await strategy.flush();
    strategy.discard();
    strategy.dispose();

    expect(await driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
  });
});

describe('AsyncDebouncedWriteStrategy', () => {
  let hide: () => void = () => undefined;
  const detach = vi.fn<() => void>();
  const lifecycle: PageLifecycle = {
    onHide: (callback) => {
      hide = callback;
      return detach;
    },
  };

  function debounced(maxBytes?: number): Setup & {
    strategy: AsyncDebouncedWriteStrategy;
  } {
    const base = setup(maxBytes);
    const strategy = new AsyncDebouncedWriteStrategy({
      store: base.store,
      delayMs: 100,
      report: base.report,
      lifecycle,
      runner: new OperationQueue(),
    });
    return { ...base, strategy };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the write and saves it after the delay', async () => {
    const { strategy, driver } = debounced();

    await strategy.write(one);
    expect(strategy.pending()).toBe(one);
    expect(await driver.read('K')).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(await driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
  });

  it('flush() saves now and rejects on failure, keeping the snapshot', async () => {
    const { strategy } = debounced(80);

    await strategy.write(big);

    await expect(strategy.flush()).rejects.toThrow(StorageQuotaError);
    expect(strategy.pending()).toBe(big);
  });

  it('reports a failed timed save and keeps the snapshot for a retry', async () => {
    const { strategy, report } = debounced(80);

    await strategy.write(big);
    await vi.advanceTimersByTimeAsync(100);

    expect(report).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    expect(strategy.pending()).toBe(big);
  });

  it('flushes on page hide', async () => {
    const { strategy, driver } = debounced();

    await strategy.write(one);
    hide();
    await vi.advanceTimersByTimeAsync(0);

    expect(await driver.read('K')).toBe(encodeEnvelope(one));
  });

  it('discard() drops the snapshot; dispose() detaches', async () => {
    const { strategy, driver } = debounced();

    await strategy.write(one);
    strategy.discard();
    strategy.dispose();
    await vi.advanceTimersByTimeAsync(100);

    expect(await driver.read('K')).toBeNull();
    expect(detach).toHaveBeenCalled();
  });
});
