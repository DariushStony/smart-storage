import type { Snapshot } from '../core/snapshot.js';
import { toStorageError } from '../errors.js';
import type { Reporter } from '../reporting/reporter.js';
import type { PageLifecycle } from './page-lifecycle.js';
import type { SnapshotStore } from './snapshot-store.js';

/** Decides when a changed snapshot reaches storage. */
interface WriteStrategy {
  write(snapshot: Snapshot): void;
  /** A snapshot written but not yet saved, for read-your-writes. */
  pending(): Snapshot | null;
  /** Saves anything pending now. Throws if that fails. */
  flush(): void;
  /** Drops anything pending without saving it. */
  discard(): void;
  dispose(): void;
}

class ImmediateWriteStrategy implements WriteStrategy {
  constructor(private readonly repository: SnapshotStore) {}

  write(snapshot: Snapshot): void {
    this.repository.save(snapshot);
  }

  pending(): Snapshot | null {
    return null;
  }

  flush(): void {}

  discard(): void {}

  dispose(): void {}
}

interface DebouncedDeps {
  repository: SnapshotStore;
  delayMs: number;
  report: Reporter;
  lifecycle: PageLifecycle;
}

/**
 * Coalesces writes made within `delayMs`. Nobody is left to catch a failure
 * on the timer or on page hide, so it is reported and the snapshot is kept
 * for the next attempt.
 */
class DebouncedWriteStrategy implements WriteStrategy {
  private readonly repository: SnapshotStore;
  private readonly delayMs: number;
  private readonly report: Reporter;
  private readonly detach: () => void;
  private queued: Snapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: DebouncedDeps) {
    this.repository = deps.repository;
    this.delayMs = deps.delayMs;
    this.report = deps.report;
    this.detach = deps.lifecycle.onHide(() => this.flushAndReport());
  }

  write(snapshot: Snapshot): void {
    this.queued = snapshot;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushAndReport();
    }, this.delayMs);
  }

  pending(): Snapshot | null {
    return this.queued;
  }

  flush(): void {
    this.cancelTimer();
    if (this.queued === null) return;
    this.repository.save(this.queued);
    this.queued = null;
  }

  discard(): void {
    this.cancelTimer();
    this.queued = null;
  }

  dispose(): void {
    this.cancelTimer();
    this.detach();
  }

  private flushAndReport(): void {
    try {
      this.flush();
    } catch (error) {
      this.report(toStorageError(error, 'A deferred write failed.'));
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export { ImmediateWriteStrategy, DebouncedWriteStrategy };
export type { WriteStrategy };
