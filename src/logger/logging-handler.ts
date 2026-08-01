import { TransformHandler } from '../transform/transform-handler';
import type { StorageLogger } from './storage-logger';

/**
 * A chain-of-responsibility handler that logs data as it flows through the transform chain.
 *
 * This handler is a **passthrough** — it does not modify the data.
 * It logs the data size on serialize (write) and deserialize (read),
 * then forwards the data unchanged to the next/previous handler.
 *
 * To enable logging, add this handler to the chain.
 * To disable logging, simply remove it — no code changes needed.
 *
 * @example Enable logging
 * ```typescript
 * const chain = TransformChain.from([
 *   new LoggingHandler(myLogger),
 *   new CompressionHandler(),
 * ]);
 * ```
 *
 * @example Disable logging (just remove from the array)
 * ```typescript
 * const chain = TransformChain.from([
 *   new CompressionHandler(),
 * ]);
 * ```
 */
class LoggingHandler extends TransformHandler {
  constructor(private logger: StorageLogger) {
    super();
  }

  /**
   * Returns the logger instance held by this handler.
   * Useful for external code that needs to log through the same logger.
   */
  getLogger(): StorageLogger {
    return this.logger;
  }

  protected process(data: string): string {
    this.logger.log('Transform chain serialize', {
      dataLength: data.length,
    });
    return data;
  }

  protected reverseProcess(data: string): string {
    this.logger.log('Transform chain deserialize', {
      dataLength: data.length,
    });
    return data;
  }
}

export { LoggingHandler };
