import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { composeCodecs } from '../../../src/codec/codec.js';
import type { Entry } from '../../../src/core/entry.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import { StorageQuotaError } from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import type { PageLifecycle } from '../../../src/persistence/page-lifecycle.js';
import { SnapshotRepository } from '../../../src/persistence/snapshot-repository.js';
import type { SnapshotStore } from '../../../src/persistence/snapshot-store.js';
import { SnapshotSerializer } from '../../../src/persistence/snapshot-serializer.js';
import {
  DebouncedWriteStrategy,
  ImmediateWriteStrategy,
} from '../../../src/persistence/write-strategy.js';

const entry = (value: unknown): Entry => ({
  json: JSON.stringify(value),
  expiresAt: null,
});
const one = Snapshot.empty.with('a', entry(1));
const two = one.with('b', entry('x'.repeat(100)));

interface Setup {
  driver: MemoryDriver;
  report: Mock<(error: StorageError) => void>;
  repository: SnapshotRepository;
}

function setup(maxBytes = 1_000_000): Setup {
  const driver = new MemoryDriver();
  const report = vi.fn<(error: StorageError) => void>();
  const repository = new SnapshotRepository({
    driver,
    key: 'K',
    serializer: new SnapshotSerializer(composeCodecs([])),
    maxBytes,
    report,
  });
  return { driver, report, repository };
}

describe('ImmediateWriteStrategy', () => {
  it('saves on write and never holds anything pending', () => {
    const { driver, repository } = setup();
    const strategy = new ImmediateWriteStrategy(repository);

    strategy.write(one);

    expect(driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
  });

  it('lets save failures propagate', () => {
    const { repository } = setup(80);
    const strategy = new ImmediateWriteStrategy(repository);

    expect(() => strategy.write(two)).toThrow(StorageQuotaError);
  });

  it('treats flush, discard and dispose as no-ops', () => {
    const strategy = new ImmediateWriteStrategy(setup().repository);
    expect(() => {
      strategy.flush();
      strategy.discard();
      strategy.dispose();
    }).not.toThrow();
  });
});

describe('DebouncedWriteStrategy', () => {
  interface DebouncedSetup extends Setup {
    strategy: DebouncedWriteStrategy;
    hide: () => void;
    detach: Mock<() => void>;
  }

  function debounced(maxBytes?: number): DebouncedSetup {
    const base = setup(maxBytes);
    let listener: (() => void) | undefined;
    const detach = vi.fn<() => void>();
    const lifecycle: PageLifecycle = {
      onHide: (callback) => {
        listener = callback;
        return detach;
      },
    };
    const strategy = new DebouncedWriteStrategy({
      repository: base.repository,
      delayMs: 100,
      report: base.report,
      lifecycle,
    });
    return { ...base, strategy, detach, hide: () => listener?.() };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the write until the delay elapses', () => {
    const { strategy, driver } = debounced();

    strategy.write(one);
    expect(driver.read('K')).toBeNull();
    expect(strategy.pending()).toBe(one);

    vi.advanceTimersByTime(100);
    expect(driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
  });

  it('restarts the delay and persists only the latest snapshot', () => {
    const { strategy, driver } = debounced();
    const write = vi.spyOn(driver, 'write');

    strategy.write(one);
    vi.advanceTimersByTime(50);
    strategy.write(two);
    vi.advanceTimersByTime(50);
    expect(driver.read('K')).toBeNull();

    vi.advanceTimersByTime(50);
    expect(driver.read('K')).toBe(encodeEnvelope(two));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush() saves immediately and cancels the timer', () => {
    const { strategy, driver } = debounced();
    const write = vi.spyOn(driver, 'write');

    strategy.write(one);
    strategy.flush();
    vi.advanceTimersByTime(100);

    expect(driver.read('K')).toBe(encodeEnvelope(one));
    expect(strategy.pending()).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing pending does nothing', () => {
    const { strategy, driver } = debounced();
    const write = vi.spyOn(driver, 'write');

    strategy.flush();

    expect(write).not.toHaveBeenCalled();
  });

  it('flush() throws on failure and keeps the snapshot', () => {
    const { strategy } = debounced(80);

    strategy.write(two);

    expect(() => strategy.flush()).toThrow(StorageQuotaError);
    expect(strategy.pending()).toBe(two);
  });

  it('reports a failed timed write and retries on the next flush', () => {
    const { strategy, driver, report } = debounced();
    vi.spyOn(driver, 'write').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    strategy.write(one);
    vi.advanceTimersByTime(100);

    expect(report).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    expect(strategy.pending()).toBe(one);

    strategy.flush();
    expect(driver.read('K')).toBe(encodeEnvelope(one));
  });

  it('flushes when the page is hidden', () => {
    const { strategy, driver, hide } = debounced();

    strategy.write(one);
    hide();

    expect(driver.read('K')).toBe(encodeEnvelope(one));
  });

  it('reports a failed flush on page hide instead of throwing', () => {
    const { strategy, report, hide } = debounced(80);

    strategy.write(two);

    expect(() => hide()).not.toThrow();
    expect(report).toHaveBeenCalledWith(expect.any(StorageQuotaError));
  });

  it('discard() drops the pending snapshot and cancels the timer', () => {
    const { strategy, driver } = debounced();

    strategy.write(one);
    strategy.discard();
    vi.advanceTimersByTime(100);

    expect(strategy.pending()).toBeNull();
    expect(driver.read('K')).toBeNull();
  });

  it('dispose() cancels the timer and detaches from the page lifecycle', () => {
    const { strategy, driver, detach } = debounced();

    strategy.write(one);
    strategy.dispose();
    vi.advanceTimersByTime(100);

    expect(driver.read('K')).toBeNull();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  // Review focus: debounced writes are last-writer-wins against other tabs.
  it('overwrites a write made elsewhere while its own write was pending', () => {
    const { strategy, driver } = debounced();

    strategy.write(one);
    driver.write('K', encodeEnvelope(Snapshot.empty.with('tab2', entry(2))));
    vi.advanceTimersByTime(100);

    expect(driver.read('K')).toBe(encodeEnvelope(one));
  });
});

describe('seams', () => {
  it('ImmediateWriteStrategy works with any SnapshotStore', () => {
    const saved: Snapshot[] = [];
    const store: SnapshotStore = {
      key: 'K',
      driverName: 'fake',
      load: () => Snapshot.empty,
      save: (snapshot) => {
        saved.push(snapshot);
      },
      remove: () => undefined,
      measure: () => 0,
      storedBytes: () => 0,
    };

    new ImmediateWriteStrategy(store).write(one);

    expect(saved).toEqual([one]);
  });
});
