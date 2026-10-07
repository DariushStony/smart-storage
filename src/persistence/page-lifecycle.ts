/** Tells a debounced vault when to write before the page may be discarded. */
interface PageLifecycle {
  /** Returns an unsubscribe function. */
  onHide(callback: () => void): () => void;
}

const browserLifecycle: PageLifecycle = {
  onHide(callback) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => undefined;
    }

    // pagehide covers navigation and bfcache; visibilitychange is the only
    // reliable signal on mobile Safari when the tab is backgrounded and killed.
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') callback();
    };
    window.addEventListener('pagehide', callback);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', callback);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  },
};

export { browserLifecycle };
export type { PageLifecycle };
