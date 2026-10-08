import { expiryAfter, remainingTtl, toJson } from '../core/entry.js';
import type { Entry } from '../core/entry.js';
import type { Snapshot } from '../core/snapshot.js';
import { assertKey, assertPositive } from '../core/validation.js';
import { StorageArgumentError } from '../errors.js';
import type { SetOptions } from './vault.js';

/** What an operation decided: its result, and the snapshot to commit if it changed anything. */
interface Outcome<R> {
  result: R;
  next?: Snapshot;
}

/**
 * One vault operation, already validated, waiting for the current snapshot.
 * Applying it does no I/O, so the sync and async vaults share every
 * decision and differ only in how they load and save.
 */
type Operation<R> = (snapshot: Snapshot, now: number) => Outcome<R>;

function getOp<T>(key: string): Operation<T | null> {
  assertKey(key);
  return (snapshot, now) => {
    const entry = snapshot.get(key, now);
    return { result: entry ? (JSON.parse(entry.json) as T) : null };
  };
}

function hasOp(key: string): Operation<boolean> {
  assertKey(key);
  return (snapshot, now) => ({ result: snapshot.get(key, now) !== undefined });
}

function ttlOp(key: string): Operation<number | null> {
  assertKey(key);
  return (snapshot, now) => {
    const entry = snapshot.get(key, now);
    return { result: entry ? remainingTtl(entry, now) : null };
  };
}

function keysOp(): Operation<string[]> {
  return (snapshot, now) => ({
    result: snapshot.live(now).map(([key]) => key),
  });
}

function toObjectOp(): Operation<Record<string, unknown>> {
  return (snapshot, now) => ({
    result: Object.fromEntries(
      snapshot
        .live(now)
        .map(([key, entry]) => [key, JSON.parse(entry.json) as unknown])
    ),
  });
}

function setOp(
  key: string,
  value: unknown,
  options: SetOptions = {}
): Operation<void> {
  assertKey(key);
  if (typeof (options as unknown) !== 'object' || options === null) {
    throw new StorageArgumentError('set() options must be an object.');
  }
  const { ttl } = options;
  if (ttl !== undefined) assertPositive('ttl', ttl);
  const json = toJson(value);

  return (snapshot, now) => ({
    result: undefined,
    next: snapshot.with(key, {
      json,
      expiresAt: ttl === undefined ? null : expiryAfter(now, ttl),
    }),
  });
}

function updateOp(key: string, value: unknown): Operation<boolean> {
  const json = toJson(value);
  return rewriteOp(key, (entry) => ({ json, expiresAt: entry.expiresAt }));
}

function extendOp(key: string, ms: number): Operation<boolean> {
  assertPositive('ms', ms);
  return rewriteOp(key, (entry) =>
    entry.expiresAt === null
      ? entry
      : { json: entry.json, expiresAt: expiryAfter(entry.expiresAt, ms) }
  );
}

function removeOp(key: string): Operation<boolean> {
  assertKey(key);
  return (snapshot, now) =>
    snapshot.get(key, now)
      ? { result: true, next: snapshot.without(key) }
      : { result: false };
}

function purgeExpiredOp(): Operation<number> {
  return (snapshot, now) => {
    const purged = snapshot.withoutExpired(now);
    return purged === snapshot
      ? { result: 0 }
      : { result: snapshot.size - purged.size, next: purged };
  };
}

function rewriteOp(
  key: string,
  change: (entry: Entry) => Entry
): Operation<boolean> {
  assertKey(key);
  return (snapshot, now) => {
    const entry = snapshot.get(key, now);
    if (!entry) return { result: false };
    const next = change(entry);
    return next === entry
      ? { result: true }
      : { result: true, next: snapshot.with(key, next) };
  };
}

export {
  getOp,
  hasOp,
  ttlOp,
  keysOp,
  toObjectOp,
  setOp,
  updateOp,
  extendOp,
  removeOp,
  purgeExpiredOp,
};
export type { Operation, Outcome };
