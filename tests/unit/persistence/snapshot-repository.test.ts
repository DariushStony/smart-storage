import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { composeCodecs } from '../../../src/codec/codec.js';
import type { Codec } from '../../../src/codec/codec.js';
import { utf8ByteLength } from '../../../src/core/byte-size.js';
import type { Entry } from '../../../src/core/entry.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  StorageAccessError,
  StorageCorruptionError,
  StorageQuotaError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { SnapshotRepository } from '../../../src/persistence/snapshot-repository.js';
import { SnapshotSerializer } from '../../../src/persistence/snapshot-serializer.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

interface Setup {
  driver: MemoryDriver;
  report: Mock<(error: StorageError) => void>;
  serializer: SnapshotSerializer;
  repository: SnapshotRepository;
}

function setup(options: { maxBytes?: number; codec?: Codec } = {}): Setup {
  const driver = new MemoryDriver();
  const report = vi.fn<(error: StorageError) => void>();
  const serializer = new SnapshotSerializer(options.codec ?? composeCodecs([]));
  const repository = new SnapshotRepository({
    driver,
    key: 'K',
    serializer,
    maxBytes: options.maxBytes ?? 1_000_000,
    report,
  });
  return { driver, report, serializer, repository };
}

describe('SnapshotRepository.load', () => {
  it('returns an empty snapshot when nothing is stored', () => {
    expect(setup().repository.load().size).toBe(0);
  });

  it('round-trips what save() wrote', () => {
    const { repository, driver } = setup();
    const snapshot = Snapshot.empty.with('a', entry(1));

    repository.save(snapshot);

    expect(driver.read('K')).toBe(encodeEnvelope(snapshot));
    expect(repository.load().get('a', 0)).toEqual(entry(1));
  });

  it('reuses the decoded snapshot while the stored text is unchanged', () => {
    const { repository, driver, serializer } = setup();
    driver.write('K', encodeEnvelope(Snapshot.empty.with('a', entry(1))));
    const deserialize = vi.spyOn(serializer, 'deserialize');

    const first = repository.load();
    const second = repository.load();

    expect(second).toBe(first);
    expect(deserialize).toHaveBeenCalledTimes(1);
  });

  it('sees text written by someone else, e.g. another tab', () => {
    const { repository, driver } = setup();
    repository.save(Snapshot.empty.with('a', entry(1)));

    driver.write('K', encodeEnvelope(Snapshot.empty.with('b', entry(2))));

    expect(repository.load().get('b', 0)).toEqual(entry(2));
    expect(repository.load().get('a', 0)).toBeUndefined();
  });

  it('reads data written by 1.x', () => {
    const { repository, driver } = setup();
    driver.write(
      'K',
      JSON.stringify({ theme: { value: 'dark', expiry: null } })
    );

    expect(repository.load().get('theme', 0)).toEqual(entry('dark'));
  });

  it('treats unreadable text as empty, reports it once, and leaves it in place', () => {
    const { repository, driver, report } = setup();
    driver.write('K', 'not json');

    expect(repository.load().size).toBe(0);
    expect(repository.load().size).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(StorageCorruptionError));
    expect(driver.read('K')).toBe('not json');
  });

  it('reports a codec that cannot decode and leaves the stored text alone', () => {
    const { repository, driver, report } = setup({
      codec: {
        encode: (text) => text,
        decode: () => {
          throw new Error('wrong key');
        },
      },
    });
    driver.write('K', 'ciphertext');

    expect(repository.load().size).toBe(0);
    expect(report).toHaveBeenCalledWith(expect.any(StorageCorruptionError));
    expect(driver.read('K')).toBe('ciphertext');
  });

  it('reports dropped items once and keeps the readable ones', () => {
    const { repository, driver, report } = setup();
    driver.write(
      'K',
      JSON.stringify({ v: 2, items: [{ key: 'ok', value: 1 }, { nope: true }] })
    );

    expect(repository.load().get('ok', 0)).toEqual(entry(1));
    repository.load();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(StorageCorruptionError));
  });

  it('wraps read failures as StorageAccessError', () => {
    const { repository, driver } = setup();
    vi.spyOn(driver, 'read').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => repository.load()).toThrow(StorageAccessError);
  });
});

describe('SnapshotRepository.save', () => {
  it('rejects data over maxBytes without touching storage', () => {
    const { repository, driver } = setup({ maxBytes: 80 });
    const small = Snapshot.empty.with('a', entry(1));
    repository.save(small);

    expect(() =>
      repository.save(small.with('b', entry('x'.repeat(100))))
    ).toThrow(StorageQuotaError);
    expect(driver.read('K')).toBe(encodeEnvelope(small));
    expect(repository.load().get('b', 0)).toBeUndefined();
  });

  // Data can already be over the limit: written by 1.x (which only logged),
  // by a vault with a higher limit, or before maxBytes was lowered.
  it('lets a write through that does not grow data already over maxBytes', () => {
    const { repository, driver } = setup({ maxBytes: 80 });
    const oversized = Snapshot.empty
      .with('big', entry('x'.repeat(100)))
      .with('small', entry(1));
    driver.write('K', encodeEnvelope(oversized));

    const shrunk = repository.load().without('small');
    repository.save(shrunk);

    expect(driver.read('K')).toBe(encodeEnvelope(shrunk));
    expect(() => repository.save(shrunk.with('more', entry(2)))).toThrow(
      StorageQuotaError
    );
  });

  // Regression for the 1.x defect: at quota, 1.x retried with stale data,
  // returned true, and silently dropped the new value.
  it('turns a browser quota error into StorageQuotaError and keeps the previous state', () => {
    const { repository, driver } = setup();
    const first = Snapshot.empty.with('a', entry(1));
    repository.save(first);
    const quota = new DOMException('full', 'QuotaExceededError');
    vi.spyOn(driver, 'write').mockImplementation(() => {
      throw quota;
    });

    let caught: unknown;
    try {
      repository.save(first.with('b', entry(2)));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StorageQuotaError);
    expect((caught as StorageQuotaError).cause).toBe(quota);
    expect(repository.load().get('a', 0)).toEqual(entry(1));
    expect(repository.load().get('b', 0)).toBeUndefined();
  });

  it.each([
    [{ name: 'QuotaExceededError' }],
    [{ name: 'NS_ERROR_DOM_QUOTA_REACHED' }],
    [{ code: 22 }],
    [{ code: 1014 }],
  ])('recognises %o as a quota error', (thrown) => {
    const { repository, driver } = setup();
    vi.spyOn(driver, 'write').mockImplementation(() => {
      throw thrown;
    });

    expect(() => repository.save(Snapshot.empty)).toThrow(StorageQuotaError);
  });

  it('wraps other write failures as StorageAccessError', () => {
    const { repository, driver } = setup();
    vi.spyOn(driver, 'write').mockImplementation(() => {
      throw new DOMException('nope', 'SecurityError');
    });

    expect(() => repository.save(Snapshot.empty)).toThrow(StorageAccessError);
  });
});

describe('SnapshotRepository.remove', () => {
  it('deletes the stored text and resets the cache', () => {
    const { repository, driver } = setup();
    repository.save(Snapshot.empty.with('a', entry(1)));

    repository.remove();

    expect(driver.read('K')).toBeNull();
    expect(repository.load().size).toBe(0);
  });

  it('wraps failures as StorageAccessError', () => {
    const { repository, driver } = setup();
    vi.spyOn(driver, 'remove').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => repository.remove()).toThrow(StorageAccessError);
  });
});

describe('SnapshotRepository.measure', () => {
  it('returns the UTF-8 size of the serialized snapshot', () => {
    const { repository } = setup();
    const snapshot = Snapshot.empty.with('é', entry('😀'));

    expect(repository.measure(snapshot)).toBe(
      utf8ByteLength(encodeEnvelope(snapshot))
    );
  });

  it('exposes the driver name and key', () => {
    const { repository } = setup();
    expect(repository.driverName).toBe('memory');
    expect(repository.key).toBe('K');
  });
});
