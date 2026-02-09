import { TransformHandler } from './transform-handler';
import type { StorageTransform } from './types';

/**
 * A concrete TransformHandler that wraps a plain StorageTransform object.
 *
 * This serves as an adapter between the legacy `{ serialize, deserialize }` interface
 * and the Chain of Responsibility pattern, ensuring full backward compatibility.
 *
 * Users who pass plain objects as transforms don't need to know about the chain —
 * their objects are automatically wrapped into handler nodes.
 *
 * @example
 * const handler = new InlineTransformHandler({
 *   serialize: (data) => btoa(data),
 *   deserialize: (data) => atob(data),
 * });
 */
class InlineTransformHandler extends TransformHandler {
  constructor(private transform: StorageTransform) {
    super();
  }

  protected process(data: string): string {
    return this.transform.serialize(data);
  }

  protected reverseProcess(data: string): string {
    return this.transform.deserialize(data);
  }
}

export { InlineTransformHandler };
