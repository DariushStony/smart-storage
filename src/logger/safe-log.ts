import type { StorageLogger } from './storage-logger.js';

/**
 * Reports through the logger without ever throwing, so a failing logger can
 * never interrupt a write, a recovery or the memory fallback.
 *
 * @param logger - The configured logger, if any.
 * @param args - The message and optional detail, as for `StorageLogger.log`.
 */
function safeLog(
  logger: StorageLogger | undefined,
  ...args: Parameters<StorageLogger['log']>
): void {
  try {
    logger?.log(...args);
  } catch {
    // Logging is best-effort: its failure must not become a storage failure.
  }
}

export { safeLog };
