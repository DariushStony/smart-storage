import type { Snapshot } from '../core/snapshot.js';
import { toStorageError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import type { TaskRunner } from '../vault/operation-queue.js';
import type { PageLifecycle } from './page-lifecycle.js';
import type { AsyncSnapshotStore } from './snapshot-store.js';

/** Async counterpart of WriteStrategy. */
interface AsyncWriteStrategy {
  write(snapshot: Snapshot): Promise<void>;
  pending(): Snapshot | null;
  flush(): Promise<void>;
  discard(): void;
  dispose(): void;
}

class AsyncImmediateWriteStrategy implements AsyncWriteStrategy {
  constructor(private readonly store: AsyncSnapshotStore) {}

  write(snapshot: Snapshot): Promise<void> {
    return this.store.save(snapshot);
  }

  pending(): Snapshot | null {
    return null;
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  discard(): void {}

  dispose(): void {}
}

interface AsyncDebouncedDeps {
  store: AsyncSnapshotStore;
  delayMs: number;
  report: Reporter;
  lifecycle: PageLifecycle;
  /** The vault's queue: timed and page-hide flushes run in line with its calls. */
  runner: TaskRunner;
}

/**
 * Coalesces writes made within `delayMs`. Timed and page-hide flushes go
 * through the vault's queue, so they never overlap a call. Their failures
 * are reported, and the snapshot is kept for the next attempt.
 */
class AsyncDebouncedWriteStrategy implements AsyncWriteStrategy {
  private readonly store: AsyncSnapshotStore;
  private readonly delayMs: number;
  private readonly report: Reporter;
  private readonly runner: TaskRunner;
  private readonly detach: () => void;
  private queued: Snapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: AsyncDebouncedDeps) {
    this.store = deps.store;
    this.delayMs = deps.delayMs;
    this.report = deps.report;
    this.runner = deps.runner;
    // Best effort: the browser may end the page before an async write lands.
    this.detach = deps.lifecycle.onHide(() => {
      void this.flushInLine();
    });
  }

  write(snapshot: Snapshot): Promise<void> {
    this.queued = snapshot;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushInLine();
    }, this.delayMs);
    return Promise.resolve();
  }

  pending(): Snapshot | null {
    return this.queued;
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    const snapshot = this.queued;
    if (snapshot === null) return;
    await this.store.save(snapshot);
    if (this.queued === snapshot) this.queued = null;
  }

  discard(): void {
    this.cancelTimer();
    this.queued = null;
  }

  dispose(): void {
    this.cancelTimer();
    this.detach();
  }

  private flushInLine(): Promise<void> {
    return this.runner.run(async () => {
      try {
        await this.flush();
      } catch (error) {
        this.report(toStorageError(error, 'A deferred write failed.'));
      }
    });
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export { AsyncImmediateWriteStrategy, AsyncDebouncedWriteStrategy };
export type { AsyncWriteStrategy };
