import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { composeAsyncCodecs } from '../../../src/codec/async-codec.js';
import type { AsyncCodec } from '../../../src/codec/async-codec.js';
import { utf8ByteLength } from '../../../src/core/byte-size.js';
import type { Entry } from '../../../src/core/entry.js';
import { encodeEnvelope } from '../../../src/core/envelope.js';
import { Snapshot } from '../../../src/core/snapshot.js';
import { AsyncMemoryDriver } from '../../../src/drivers/async-memory-driver.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  StorageAccessError,
  StorageCorruptionError,
  StorageQuotaError,
  StorageSerializationError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';
import { AsyncSnapshotRepository } from '../../../src/persistence/async-snapshot-repository.js';
import { AsyncSnapshotSerializer } from '../../../src/persistence/async-snapshot-serializer.js';

const entry = (value: unknown, expiresAt: number | null = null): Entry => ({
  json: JSON.stringify(value),
  expiresAt,
});

interface Setup {
  driver: AsyncMemoryDriver;
  report: Mock<(error: StorageError) => void>;
  repository: AsyncSnapshotRepository;
}

function setup(
  options: { maxBytes?: number; codecs?: AsyncCodec[] } = {}
): Setup {
  const driver = new AsyncMemoryDriver();
  const report = vi.fn<(error: StorageError) => void>();
  const repository = new AsyncSnapshotRepository({
    driver,
    key: 'K',
    serializer: new AsyncSnapshotSerializer(
      composeAsyncCodecs(options.codecs ?? [])
    ),
    maxBytes: options.maxBytes ?? 1_000_000,
    report,
  });
  return { driver, report, repository };
}

describe('AsyncSnapshotRepository', () => {
  it('saves and loads, caching while the stored text is unchanged', async () => {
    const { repository, driver } = setup();
    const snapshot = Snapshot.empty.with('a', entry(1));

    await repository.save(snapshot);

    expect(await driver.read('K')).toBe(encodeEnvelope(snapshot));
    expect(await repository.load()).toBe(snapshot);
  });

  it('sees text written by someone else', async () => {
    const { repository, driver } = setup();
    await driver.write('K', encodeEnvelope(Snapshot.empty.with('b', entry(2))));

    expect((await repository.load()).get('b', 0)).toEqual(entry(2));
  });

  it('reads 1.x data', async () => {
    const { repository, driver } = setup();
    await driver.write(
      'K',
      JSON.stringify({ theme: { value: 'dark', expiry: null } })
    );

    expect((await repository.load()).get('theme', 0)).toEqual(entry('dark'));
  });

  it('reports unreadable text once and leaves it in place', async () => {
    const { repository, driver, report } = setup();
    await driver.write('K', 'not json');

    expect((await repository.load()).size).toBe(0);
    await repository.load();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(StorageCorruptionError));
    expect(await driver.read('K')).toBe('not json');
  });

  it('rejects data over maxBytes, but lets over-limit data shrink', async () => {
    const { repository, driver } = setup({ maxBytes: 80 });
    const big = Snapshot.empty.with('big', entry('x'.repeat(100)));
    await expect(repository.save(big)).rejects.toThrow(StorageQuotaError);

    await driver.write('K', encodeEnvelope(big.with('more', entry(1))));
    await repository.load();
    await expect(repository.save(big)).resolves.toBeUndefined();
  });

  it('maps a quota rejection to StorageQuotaError and keeps the previous state', async () => {
    const { repository, driver } = setup();
    const first = Snapshot.empty.with('a', entry(1));
    await repository.save(first);
    vi.spyOn(driver, 'write').mockRejectedValue(
      new DOMException('full', 'QuotaExceededError')
    );

    const failure = repository.save(first.with('b', entry(2)));

    await expect(failure).rejects.toThrow(StorageQuotaError);
    await expect(failure).rejects.toMatchObject({
      bytes: utf8ByteLength(encodeEnvelope(first.with('b', entry(2)))),
    });
    expect((await repository.load()).get('b', 0)).toBeUndefined();
  });

  it('wraps other driver failures as StorageAccessError', async () => {
    const { repository, driver } = setup();
    vi.spyOn(driver, 'read').mockRejectedValue(new Error('denied'));

    await expect(repository.load()).rejects.toThrow(StorageAccessError);
  });

  it('wraps an async codec failure as StorageSerializationError', async () => {
    const { repository } = setup({
      codecs: [
        { encode: () => Promise.reject(new Error('no key')), decode: (t) => t },
      ],
    });

    await expect(repository.save(Snapshot.empty)).rejects.toThrow(
      StorageSerializationError
    );
  });

  it('works over a sync driver too', async () => {
    const driver = new MemoryDriver();
    const repository = new AsyncSnapshotRepository({
      driver,
      key: 'K',
      serializer: new AsyncSnapshotSerializer(composeAsyncCodecs([])),
      maxBytes: 1000,
      report: vi.fn(),
    });

    await repository.save(Snapshot.empty.with('a', entry(1)));

    expect(driver.read('K')).not.toBeNull();
    expect(await repository.measure(Snapshot.empty)).toBe(
      utf8ByteLength(encodeEnvelope(Snapshot.empty))
    );
    await repository.remove();
    expect(driver.read('K')).toBeNull();
    expect(repository.storedBytes()).toBe(0);
  });
});
