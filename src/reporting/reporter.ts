import type { StorageError } from '../errors.js';

type Reporter = (error: StorageError) => void;

function createReporter(onError?: (error: StorageError) => void): Reporter {
  if (!onError) return () => undefined;

  return (error) => {
    try {
      onError(error);
    } catch {
      // Reporting is best-effort: a failing handler must not become a storage failure.
    }
  };
}

export { createReporter };
export type { Reporter };
