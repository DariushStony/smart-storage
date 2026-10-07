import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import {
  resetSharedDrivers,
  resolveDriver,
} from '../../../src/drivers/resolve-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import { StorageUnavailableError } from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';

let report: Mock<(error: StorageError) => void>;

beforeEach(() => {
  resetSharedDrivers();
  report = vi.fn<(error: StorageError) => void>();
});

afterEach(() => {
  resetSharedDrivers();
});

describe('resolveDriver', () => {
  it("gives a fresh MemoryDriver per call for 'memory'", () => {
    const a = resolveDriver('memory', report);
    expect(a).toBeInstanceOf(MemoryDriver);
    expect(resolveDriver('memory', report)).not.toBe(a);
  });

  it('passes a custom driver through unchanged', () => {
    const custom = new MemoryDriver();
    expect(resolveDriver(custom, report)).toBe(custom);
  });

  it.each([
    ['local', 'localStorage'],
    ['session', 'sessionStorage'],
  ] as const)("wraps window storage for '%s'", (spec, name) => {
    const driver = resolveDriver(spec, report);

    expect(driver).toBeInstanceOf(WebStorageDriver);
    expect(driver.name).toBe(name);
    driver.write('k', 'v');
    expect(window[name].getItem('k')).toBe('v');
    window[name].removeItem('k');
    expect(report).not.toHaveBeenCalled();
  });

  it('shares one driver per kind', () => {
    expect(resolveDriver('local', report)).toBe(resolveDriver('local', report));
    expect(resolveDriver('local', report)).not.toBe(
      resolveDriver('session', report)
    );
  });

  it('falls back to memory silently when there is no window (SSR)', () => {
    vi.stubGlobal('window', undefined);

    expect(resolveDriver('local', report)).toBeInstanceOf(MemoryDriver);
    expect(report).not.toHaveBeenCalled();
  });

  it('falls back to memory and reports when storage access throws', () => {
    const denied = new DOMException('denied', 'SecurityError');
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw denied;
      },
    });

    expect(resolveDriver('local', report)).toBeInstanceOf(MemoryDriver);
    expect(report).toHaveBeenCalledTimes(1);
    const error = report.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error?.cause).toBe(denied);
  });

  it('falls back and reports when the storage object is missing', () => {
    vi.stubGlobal('window', { localStorage: null });

    expect(resolveDriver('local', report)).toBeInstanceOf(MemoryDriver);
    expect(report).toHaveBeenCalledWith(expect.any(StorageUnavailableError));
  });

  it('reports the fallback to every caller, with one shared driver', () => {
    vi.stubGlobal('window', { localStorage: null });

    const first = resolveDriver('local', report);
    const second = resolveDriver('local', report);

    expect(second).toBe(first);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
