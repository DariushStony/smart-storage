import type { StorageLogger, StorageTransform } from '../utils/types';

/**
 * Transform pipeline manager.
 * Handles chaining of multiple transforms for serialization and deserialization.
 */
class TransformPipeline {
  constructor(
    private transforms: StorageTransform[],
    private logger?: StorageLogger
  ) {}

  /**
   * Applies transform pipeline in order: serialize → transform1 → transform2 → ... → transformN
   *
   * @param data - The serialized JSON string.
   * @returns The transformed string ready for persistence.
   */
  apply(data: string): string {
    return this.transforms.reduce((current, transform) => {
      try {
        return transform.serialize(current);
      } catch (e) {
        this.logger?.log('Transform serialize failed', e);
        throw new Error(
          `Transform pipeline failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }, data);
  }

  /**
   * Reverses transform pipeline: transformN → ... → transform2 → transform1 → deserialize
   *
   * @param data - The transformed string from storage.
   * @returns The original serialized JSON string.
   */
  reverse(data: string): string {
    return this.transforms.reduceRight((current, transform) => {
      try {
        return transform.deserialize(current);
      } catch (e) {
        this.logger?.log('Transform deserialize failed', e);
        throw new Error(
          `Transform pipeline reversal failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }, data);
  }

  /**
   * Checks if any transforms are configured.
   */
  hasTransforms(): boolean {
    return this.transforms.length > 0;
  }
}

export { TransformPipeline };
