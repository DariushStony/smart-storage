import { InlineTransformHandler } from './inline-transform-handler';
import { TransformHandler } from './transform-handler';
import type { StorageTransform } from './types';

/**
 * Manages a Chain of Responsibility for data transformation.
 *
 * The chain links TransformHandler nodes together:
 *
 *   serialize:   head → handler2 → ... → tail → output
 *   deserialize: tail → ... → handler2 → head → output
 *
 * Cross-cutting concerns like logging and statistics are just handlers in the chain.
 * To enable logging, add a LoggingHandler. To disable it, remove it from the array.
 *
 * @example Building a chain with logging
 * ```typescript
 * const chain = TransformChain.from([
 *   new LoggingHandler(myLogger),       // logs data flowing through
 *   new CompressionHandler(),           // compresses
 *   new Base64Handler(),                // encodes
 * ]);
 * ```
 *
 * @example Building without logging (just remove the handler)
 * ```typescript
 * const chain = TransformChain.from([
 *   new CompressionHandler(),
 *   new Base64Handler(),
 * ]);
 * ```
 *
 * @example Empty chain (passthrough)
 * ```typescript
 * const chain = TransformChain.from([]);
 * chain.apply('hello');   // returns 'hello' unchanged
 * chain.reverse('hello'); // returns 'hello' unchanged
 * ```
 */
class TransformChain {
  private head: TransformHandler | null;
  private tail: TransformHandler | null;

  private constructor(
    head: TransformHandler | null,
    tail: TransformHandler | null
  ) {
    this.head = head;
    this.tail = tail;
  }

  /**
   * Builds a transform chain from an array of handlers or plain transform objects.
   *
   * Handlers are linked in order: first element becomes the head,
   * last element becomes the tail. Plain StorageTransform objects are
   * automatically wrapped in InlineTransformHandler.
   *
   * @param handlers - Array of TransformHandler instances or StorageTransform objects.
   * @returns A new TransformChain instance.
   */
  static from(
    handlers: (TransformHandler | StorageTransform)[]
  ): TransformChain {
    if (handlers.length === 0) {
      return new TransformChain(null, null);
    }

    // Normalize: wrap plain objects into handler nodes
    const nodes = handlers.map((h) =>
      h instanceof TransformHandler ? h : new InlineTransformHandler(h)
    );

    // Link the chain: head → node2 → ... → tail
    for (let i = 0; i < nodes.length - 1; i++) {
      const current = nodes[i];
      const next = nodes[i + 1];
      if (current && next) {
        current.setNext(next);
      }
    }

    const head = nodes[0] ?? null;
    const tail = nodes[nodes.length - 1] ?? null;

    return new TransformChain(head, tail);
  }

  /**
   * Applies the forward transform chain (serialize direction).
   *
   * Data flows: head.process → next.process → ... → tail.process → output
   *
   * @param data - The serialized JSON string.
   * @returns The transformed string ready for persistence.
   */
  apply(data: string): string {
    if (!this.head) return data;
    return this.head.serialize(data);
  }

  /**
   * Applies the reverse transform chain (deserialize direction).
   *
   * Data flows: tail.reverseProcess → prev.reverseProcess → ... → head.reverseProcess → output
   *
   * @param data - The transformed string from storage.
   * @returns The original serialized JSON string.
   */
  reverse(data: string): string {
    if (!this.tail) return data;
    return this.tail.deserialize(data);
  }

  /**
   * Checks if any transform handlers are in the chain.
   */
  hasTransforms(): boolean {
    return this.head !== null;
  }
}

export { TransformChain };
