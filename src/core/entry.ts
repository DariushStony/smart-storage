import { StorageArgumentError, StorageSerializationError } from '../errors.js';

/**
 * One stored item. The value is kept as JSON text rather than as a live
 * object: reads parse a fresh copy (no aliasing), serializability is checked
 * when the value is set, and a write never re-stringifies other items.
 */
interface Entry {
  readonly json: string;
  /** Epoch milliseconds from which the entry counts as gone; null = never. */
  readonly expiresAt: number | null;
}

// Same boundary as 1.x: an entry is gone only once now is past expiresAt.
function isExpired(entry: Entry, now: number): boolean {
  return entry.expiresAt !== null && now > entry.expiresAt;
}

/** `from + ms`, rejecting results JSON and Date cannot hold exactly. */
function expiryAfter(from: number, ms: number): number {
  const expiresAt = from + ms;
  if (expiresAt > Number.MAX_SAFE_INTEGER) {
    throw new StorageArgumentError(
      'That lifetime is too long: the expiry would pass the largest safe timestamp.'
    );
  }
  return expiresAt;
}

function remainingTtl(entry: Entry, now: number): number {
  return entry.expiresAt === null ? Infinity : entry.expiresAt - now;
}

function toJson(value: unknown): string {
  if (value === undefined) {
    throw new StorageArgumentError(
      'Cannot store undefined; use remove() to delete a key.'
    );
  }

  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new StorageSerializationError(
      'Value cannot be converted to JSON (circular reference or BigInt?).',
      { cause: error }
    );
  }

  if (json === undefined) {
    throw new StorageSerializationError(
      'Value has no JSON representation (function or symbol?).'
    );
  }

  return json;
}

export { isExpired, expiryAfter, remainingTtl, toJson };
export type { Entry };
