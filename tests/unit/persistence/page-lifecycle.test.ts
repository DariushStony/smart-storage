import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserLifecycle } from '../../../src/persistence/page-lifecycle.js';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('browserLifecycle.onHide', () => {
  it('calls back on pagehide', () => {
    const callback = vi.fn();
    const off = browserLifecycle.onHide(callback);

    window.dispatchEvent(new Event('pagehide'));

    expect(callback).toHaveBeenCalledTimes(1);
    off();
  });

  it('calls back when the document becomes hidden', () => {
    const callback = vi.fn();
    const off = browserLifecycle.onHide(callback);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(callback).toHaveBeenCalledTimes(1);
    off();
  });

  it('ignores the document becoming visible', () => {
    const callback = vi.fn();
    const off = browserLifecycle.onHide(callback);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(callback).not.toHaveBeenCalled();
    off();
  });

  it('stops calling back after unsubscribe', () => {
    const callback = vi.fn();
    browserLifecycle.onHide(callback)();

    window.dispatchEvent(new Event('pagehide'));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(callback).not.toHaveBeenCalled();
  });

  it('is a no-op without a window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    const off = browserLifecycle.onHide(vi.fn());
    expect(() => off()).not.toThrow();
  });
});
