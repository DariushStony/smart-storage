import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isWindowAvailable } from '../../src/storage/environment.js';
import { InMemoryStorage } from '../../src/storage/in-memory-storage.js';
import { LocalStorage } from '../../src/storage/local-storage.js';
import { SessionStorage } from '../../src/storage/session-storage.js';
import { createStorage } from '../../src/storage/storage.factory.js';
import {
  DEFAULT_STORAGE_TYPE,
  StorageType,
} from '../../src/storage/storage-type.js';

describe('StorageType', () => {
  it('exposes the three backends as string literals', () => {
    expect(StorageType).toEqual({
      Local: 'local',
      Session: 'session',
      InMemory: 'in-memory',
    });
  });

  it('defaults to localStorage', () => {
    expect(DEFAULT_STORAGE_TYPE).toBe(StorageType.Local);
  });
});

describe('createStorage', () => {
  it.each([
    [StorageType.Local, LocalStorage, 'localStorage'],
    [StorageType.Session, SessionStorage, 'sessionStorage'],
    [StorageType.InMemory, InMemoryStorage, 'memory'],
  ])('builds the %s backend', (type, ctor, reportedType) => {
    const storage = createStorage(type);
    expect(storage).toBeInstanceOf(ctor);
    expect(storage.getStorageType()).toBe(reportedType);
  });

  it('throws on an unknown storage type', () => {
    // Cast through unknown: the signature makes this unreachable in typed
    // code, but the runtime guard should still hold.
    expect(() =>
      createStorage('redis' as unknown as typeof StorageType.Local)
    ).toThrow(/unknown storage type/i);
  });
});

describe('isWindowAvailable', () => {
  it('is true under the happy-dom environment', () => {
    expect(isWindowAvailable()).toBe(true);
  });
});

describe.each([
  ['LocalStorage', () => new LocalStorage(), 'localStorage'] as const,
  ['SessionStorage', () => new SessionStorage(), 'sessionStorage'] as const,
  ['InMemoryStorage', () => new InMemoryStorage(), 'memory'] as const,
])('%s', (_name, build, reportedType) => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('reports itself as available', () => {
    expect(build().isAvailable()).toBe(true);
  });

  it('reports its storage type', () => {
    expect(build().getStorageType()).toBe(reportedType);
  });

  it('round-trips a value', () => {
    const storage = build();
    storage.write('k', 'v');
    expect(storage.read('k')).toBe('v');
  });

  it('returns null for a missing key', () => {
    expect(build().read('absent')).toBeNull();
  });

  it('removes a value', () => {
    const storage = build();
    storage.write('k', 'v');
    storage.remove('k');
    expect(storage.read('k')).toBeNull();
  });

  it('overwrites an existing value', () => {
    const storage = build();
    storage.write('k', 'first');
    storage.write('k', 'second');
    expect(storage.read('k')).toBe('second');
  });

  it('tolerates removing a key that is not present', () => {
    expect(() => build().remove('absent')).not.toThrow();
  });
});

describe('InMemoryStorage isolation', () => {
  it('does not share state with another instance', () => {
    const a = new InMemoryStorage();
    const b = new InMemoryStorage();

    a.write('k', 'from-a');

    // Each instance owns its own Map; this is what makes 'in-memory'
    // suitable for isolated tests.
    expect(b.read('k')).toBeNull();
  });

  it('exposes a Map as its underlying store', () => {
    expect(new InMemoryStorage().getStorage()).toBeInstanceOf(Map);
  });

  it('never registers an unload handler', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    new InMemoryStorage().registerUnloadHandler(() => {});

    // In-memory data cannot outlive the page, so flushing on pagehide
    // would be pointless work.
    expect(addSpy).not.toHaveBeenCalledWith('pagehide', expect.anything());
  });
});

describe('LocalStorage / SessionStorage separation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('writes to genuinely different browser stores', () => {
    new LocalStorage().write('k', 'local-value');
    new SessionStorage().write('k', 'session-value');

    expect(localStorage.getItem('k')).toBe('local-value');
    expect(sessionStorage.getItem('k')).toBe('session-value');
  });

  it('LocalStorage reads through to the real localStorage', () => {
    localStorage.setItem('preexisting', 'yes');
    expect(new LocalStorage().read('preexisting')).toBe('yes');
  });
});

describe('pagehide handler lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a pagehide listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const storage = new LocalStorage();
    const handler = (): void => {};

    storage.registerUnloadHandler(handler);

    expect(addSpy).toHaveBeenCalledWith('pagehide', handler);
  });

  it('registers only the first handler', () => {
    const storage = new LocalStorage();
    const first = vi.fn();
    const second = vi.fn();

    storage.registerUnloadHandler(first);
    storage.registerUnloadHandler(second);

    window.dispatchEvent(new Event('pagehide'));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('invokes the handler when pagehide fires', () => {
    const storage = new LocalStorage();
    const handler = vi.fn();
    storage.registerUnloadHandler(handler);

    window.dispatchEvent(new Event('pagehide'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops invoking the handler after cleanup', () => {
    const storage = new LocalStorage();
    const handler = vi.fn();
    storage.registerUnloadHandler(handler);

    storage.cleanup();
    window.dispatchEvent(new Event('pagehide'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('can re-register after cleanup', () => {
    const storage = new LocalStorage();
    const first = vi.fn();
    const second = vi.fn();

    storage.registerUnloadHandler(first);
    storage.cleanup();
    storage.registerUnloadHandler(second);
    window.dispatchEvent(new Event('pagehide'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tolerates cleanup without a registered handler', () => {
    expect(() => new LocalStorage().cleanup()).not.toThrow();
  });
});
