/**
 * Transform handler interface for the Chain of Responsibility pattern.
 *
 * Each handler in the chain transforms data and delegates to the next handler.
 * Handlers are linked together to form a processing pipeline:
 *
 *   serialize:   handler1 → handler2 → handler3 → output
 *   deserialize: handler3 → handler2 → handler1 → output
 *
 * Implement this interface to create custom transform handlers
 * (compression, encryption, encoding, etc.).
 *
 * @example Compression handler
 * ```typescript
 * class CompressionHandler extends TransformHandler {
 *   protected process(data: string): string {
 *     return LZString.compress(data);
 *   }
 *   protected reverseProcess(data: string): string {
 *     return LZString.decompress(data);
 *   }
 * }
 * ```
 *
 * @example Base64 encoding handler
 * ```typescript
 * class Base64Handler extends TransformHandler {
 *   protected process(data: string): string {
 *     return btoa(data);
 *   }
 *   protected reverseProcess(data: string): string {
 *     return atob(data);
 *   }
 * }
 * ```
 *
 * @example Building and using a chain
 * ```typescript
 * const chain = TransformChain.build([
 *   new CompressionHandler(),
 *   new Base64Handler(),
 * ]);
 *
 * const vault = getStorageSlice('LARGE_DATA', {
 *   transformChain: chain,
 * });
 * ```
 */

/**
 * Legacy transform interface for backward compatibility.
 * Users can still pass plain objects with serialize/deserialize functions.
 * These are internally wrapped into TransformHandler instances.
 *
 * @example
 * const compressionTransform: StorageTransform = {
 *   serialize: (data) => LZString.compress(data),
 *   deserialize: (data) => LZString.decompress(data),
 * };
 */
interface StorageTransform {
  /**
   * Transforms serialized data before persistence.
   * @param data - The serialized JSON string.
   * @returns The transformed string.
   */
  serialize: (data: string) => string;

  /**
   * Reverses the transformation after reading from storage.
   * @param data - The transformed string from storage.
   * @returns The original serialized JSON string.
   */
  deserialize: (data: string) => string;
}

export type { StorageTransform };
