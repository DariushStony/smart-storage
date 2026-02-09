/**
 * Abstract base class for the Chain of Responsibility pattern.
 *
 * Each handler in the chain:
 * 1. Receives data
 * 2. Applies its own transformation via `process()` / `reverseProcess()`
 * 3. Delegates to the next handler in the chain (if any)
 *
 * Handlers are self-contained — they own their own dependencies (e.g. a logger).
 * They do NOT receive external dependencies via method parameters.
 *
 * Subclass this to create concrete transform handlers (compression, encryption, logging, etc.).
 *
 * @example
 * class CompressionHandler extends TransformHandler {
 *   protected process(data: string): string {
 *     return LZString.compress(data);
 *   }
 *   protected reverseProcess(data: string): string {
 *     return LZString.decompress(data);
 *   }
 * }
 */
abstract class TransformHandler {
  private nextHandler: TransformHandler | null = null;
  private prevHandler: TransformHandler | null = null;

  /**
   * Sets the next handler in the forward (serialize) chain.
   * Returns the next handler to allow fluent chaining:
   *
   *   handler1.setNext(handler2).setNext(handler3);
   *
   * @param handler - The next handler in the chain.
   * @returns The next handler (for fluent API).
   */
  setNext(handler: TransformHandler): TransformHandler {
    this.nextHandler = handler;
    handler.prevHandler = this;
    return handler;
  }

  /**
   * Returns the next handler in the forward chain, or null if this is the tail.
   */
  getNext(): TransformHandler | null {
    return this.nextHandler;
  }

  /**
   * Returns the previous handler in the chain, or null if this is the head.
   */
  getPrev(): TransformHandler | null {
    return this.prevHandler;
  }

  /**
   * Applies this handler's transformation, then delegates to the next handler.
   * Called during writes (serialize direction).
   *
   * @param data - The input string to transform.
   * @returns The fully transformed string after all handlers in the chain.
   */
  serialize(data: string): string {
    const result = this.process(data);

    if (this.nextHandler) {
      return this.nextHandler.serialize(result);
    }

    return result;
  }

  /**
   * Reverses this handler's transformation, then delegates to the previous handler.
   * Called during reads (deserialize direction — chain is traversed in reverse).
   *
   * @param data - The transformed string from storage.
   * @returns The original string after all handlers have reversed their transforms.
   */
  deserialize(data: string): string {
    const result = this.reverseProcess(data);

    if (this.prevHandler) {
      return this.prevHandler.deserialize(result);
    }

    return result;
  }

  /**
   * Applies the forward transformation on data.
   * Subclasses must implement this with their specific transform logic.
   *
   * @param data - The input string.
   * @returns The transformed string.
   */
  protected abstract process(data: string): string;

  /**
   * Applies the reverse transformation on data.
   * Subclasses must implement this with their specific reverse logic.
   *
   * @param data - The transformed string.
   * @returns The original string.
   */
  protected abstract reverseProcess(data: string): string;
}

export { TransformHandler };
