import { describe, expect, it, vi } from 'vitest';

import { StorageCorruptionError } from '../../../src/errors.js';
import { createReporter } from '../../../src/reporting/reporter.js';

describe('createReporter', () => {
  it('passes errors to the handler', () => {
    const onError = vi.fn();
    const error = new StorageCorruptionError('bad');

    createReporter(onError)(error);

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('is a no-op without a handler', () => {
    const report = createReporter(undefined);
    expect(() => report(new StorageCorruptionError('bad'))).not.toThrow();
  });

  it('swallows errors thrown by the handler', () => {
    const report = createReporter(() => {
      throw new Error('logger down');
    });
    expect(() => report(new StorageCorruptionError('bad'))).not.toThrow();
  });
});
