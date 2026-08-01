/**
 * Logger interface for error reporting.
 * Implement this to connect to your logging service (e.g., Sentry).
 */
interface StorageLogger {
  log(message: string, error?: unknown): void;
}

export type { StorageLogger };
