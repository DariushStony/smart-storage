import { isExpired } from './entry.js';
import type { Entry } from './entry.js';

/**
 * An immutable view of every item under one storage key. Each operation
 * returns a new snapshot, so a failed write can never leave half-applied
 * state behind. Map order is write order: least recently written first.
 */
class Snapshot {
  static readonly empty: Snapshot = new Snapshot(new Map());

  private constructor(private readonly entries: ReadonlyMap<string, Entry>) {}

  static from(entries: Iterable<readonly [string, Entry]>): Snapshot {
    return new Snapshot(new Map(entries));
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    return entry && !isExpired(entry, now) ? entry : undefined;
  }

  with(key: string, entry: Entry): Snapshot {
    const next = new Map(this.entries);
    next.delete(key);
    next.set(key, entry);
    return new Snapshot(next);
  }

  without(key: string): Snapshot {
    if (!this.entries.has(key)) return this;
    const next = new Map(this.entries);
    next.delete(key);
    return new Snapshot(next);
  }

  live(now: number): Array<[string, Entry]> {
    return this.all().filter(([, entry]) => !isExpired(entry, now));
  }

  all(): Array<[string, Entry]> {
    return Array.from(this.entries);
  }

  /** Drops expired entries, then evicts the least recently written beyond maxItems. */
  compact(now: number, maxItems: number): Snapshot {
    const live = this.live(now);
    const kept =
      live.length > maxItems ? live.slice(live.length - maxItems) : live;
    return kept.length === this.entries.size ? this : Snapshot.from(kept);
  }
}

export { Snapshot };
