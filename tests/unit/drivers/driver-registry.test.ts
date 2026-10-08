import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import {
  registerDriver,
  resetDriverRegistry,
  resolveDriver,
  unregisterDriver,
} from '../../../src/drivers/driver-registry.js';
import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import type { StorageDriver } from '../../../src/drivers/storage-driver.js';
import { WebStorageDriver } from '../../../src/drivers/web-storage-driver.js';
import {
  StorageArgumentError,
  StorageUnavailableError,
} from '../../../src/errors.js';
import type { StorageError } from '../../../src/errors.js';

let report: Mock<(error: StorageError) => void>;

beforeEach(() => {
  resetDriverRegistry();
  report = vi.fn<(error: StorageError) => void>();
});

afterEach(() => {
  resetDriverRegistry();
});

describe('built-in drivers', () => {
  it("gives a fresh MemoryDriver per call for 'memory'", () => {
    const a = resolveDriver('memory', report);
    expect(a).toBeInstanceOf(MemoryDriver);
    expect(resolveDriver('memory', report)).not.toBe(a);
  });

  it('passes a driver object through unchanged', () => {
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

  it('shares one driver per name', () => {
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

describe('registerDriver', () => {
  it('makes a custom driver resolvable by name', () => {
    const custom = new MemoryDriver();
    registerDriver('custom', () => custom);

    expect(resolveDriver('custom', report)).toBe(custom);
  });

  it('shares one instance per name by default', () => {
    registerDriver('custom', () => new MemoryDriver());

    expect(resolveDriver('custom', report)).toBe(
      resolveDriver('custom', report)
    );
  });

  it('creates an instance per vault with shared: false', () => {
    registerDriver('custom', () => new MemoryDriver(), { shared: false });

    expect(resolveDriver('custom', report)).not.toBe(
      resolveDriver('custom', report)
    );
  });

  // Hot module reloading re-runs registrations.
  it('replaces an existing custom registration and its shared instance', () => {
    const first = new MemoryDriver();
    const second = new MemoryDriver();
    registerDriver('custom', () => first);
    resolveDriver('custom', report);

    registerDriver('custom', () => second);

    expect(resolveDriver('custom', report)).toBe(second);
  });

  it.each(['local', 'session', 'memory'])(
    'refuses to replace the built-in %s',
    (name) => {
      expect(() => registerDriver(name, () => new MemoryDriver())).toThrow(
        StorageArgumentError
      );
    }
  );

  it.each([
    ['an empty name', '', (): StorageDriver => new MemoryDriver()],
    ['a non-function factory', 'custom', 'not a function'],
  ])('rejects %s', (_label, name, factory) => {
    expect(() => registerDriver(name, factory as () => StorageDriver)).toThrow(
      StorageArgumentError
    );
  });

  it('falls back to memory and reports to every caller when a custom factory throws', () => {
    const failure = new Error('backend down');
    registerDriver('flaky', () => {
      throw failure;
    });

    const first = resolveDriver('flaky', report);
    const second = resolveDriver('flaky', report);

    expect(first).toBeInstanceOf(MemoryDriver);
    expect(second).toBe(first);
    expect(report).toHaveBeenCalledTimes(2);
    const error = report.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error?.cause).toBe(failure);
  });

  it('rejects a factory that does not return a StorageDriver', () => {
    registerDriver('broken', () => ({}) as StorageDriver);

    expect(() => resolveDriver('broken', report)).toThrow(StorageArgumentError);
  });
});

describe('unregisterDriver', () => {
  it('removes a custom driver', () => {
    registerDriver('custom', () => new MemoryDriver());

    expect(unregisterDriver('custom')).toBe(true);
    expect(() => resolveDriver('custom', report)).toThrow(StorageArgumentError);
    expect(unregisterDriver('custom')).toBe(false);
  });

  it('refuses to remove a built-in', () => {
    expect(() => unregisterDriver('local')).toThrow(StorageArgumentError);
  });
});

describe('resolveDriver', () => {
  it('points at registerDriver when a name is unknown', () => {
    expect(() => resolveDriver('nope', report)).toThrow(/registerDriver/);
  });
});
