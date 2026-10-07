import { StorageArgumentError } from '../errors.js';

function assertKey(key: unknown, label = 'Key'): asserts key is string {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new StorageArgumentError(`${label} must be a non-empty string.`);
  }
}

function assertPositive(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new StorageArgumentError(`${name} must be a positive finite number.`);
  }
}

function assertNonNegative(
  name: string,
  value: unknown
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new StorageArgumentError(
      `${name} must be a non-negative finite number.`
    );
  }
}

function assertMaxItems(value: unknown): asserts value is number {
  const valid =
    typeof value === 'number' &&
    (value === Infinity || (Number.isInteger(value) && value >= 1));
  if (!valid) {
    throw new StorageArgumentError(
      'maxItems must be a positive integer or Infinity.'
    );
  }
}

export { assertKey, assertPositive, assertNonNegative, assertMaxItems };
