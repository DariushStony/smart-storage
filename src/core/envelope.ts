import type { Entry } from './entry.js';
import { Snapshot } from './snapshot.js';

const FORMAT_VERSION = 2;

interface DecodedEnvelope {
  snapshot: Snapshot;
  /** Items that were present but unreadable and were skipped. */
  dropped: number;
}

type JsonObject = Record<string, unknown>;
type RawItem = readonly [key: unknown, value: unknown, expiresAt: unknown];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeEnvelope(snapshot: Snapshot): string {
  const items = snapshot.all().map(([key, entry]) => {
    const expiry =
      entry.expiresAt === null ? '' : `,"expiresAt":${String(entry.expiresAt)}`;
    // entry.json is already JSON text, so it is spliced in, not re-stringified.
    return `{"key":${JSON.stringify(key)},"value":${entry.json}${expiry}}`;
  });

  return `{"v":${String(FORMAT_VERSION)},"items":[${items.join(',')}]}`;
}

/** Throws when the text is not a readable envelope; callers treat that as corruption. */
function decodeEnvelope(text: string): DecodedEnvelope {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed))
    throw new TypeError('Stored data is not a JSON object.');

  // 1.x kept user keys at the top level, each mapping to an object, so a
  // numeric `v` can only come from a versioned envelope.
  if (typeof parsed.v !== 'number') return decodeV1(parsed);

  if (parsed.v !== FORMAT_VERSION) {
    throw new TypeError(`Unsupported storage format v${String(parsed.v)}.`);
  }
  if (!Array.isArray(parsed.items)) {
    throw new TypeError('Stored data has no items list.');
  }

  return collect(
    parsed.items.map((item: unknown) =>
      isObject(item) ? [item.key, item.value, item.expiresAt] : undefined
    )
  );
}

function decodeV1(record: JsonObject): DecodedEnvelope {
  return collect(
    Object.keys(record).map((key) => {
      const item = record[key];
      return isObject(item) ? [key, item.value, item.expiry] : undefined;
    })
  );
}

function collect(items: Array<RawItem | undefined>): DecodedEnvelope {
  const entries = new Map<string, Entry>();
  let dropped = 0;

  for (const item of items) {
    const decoded = item && toEntry(item);
    if (decoded) {
      entries.delete(decoded[0]);
      entries.set(decoded[0], decoded[1]);
    } else {
      dropped += 1;
    }
  }

  return { snapshot: Snapshot.from(entries), dropped };
}

function toEntry([key, value, expiresAt]: RawItem):
  [string, Entry] | undefined {
  if (typeof key !== 'string' || key.trim() === '' || value === undefined) {
    return undefined;
  }
  if (expiresAt === undefined || expiresAt === null) {
    return [key, { json: JSON.stringify(value), expiresAt: null }];
  }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return undefined;
  }
  return [key, { json: JSON.stringify(value), expiresAt }];
}

export { encodeEnvelope, decodeEnvelope };
export type { DecodedEnvelope };
