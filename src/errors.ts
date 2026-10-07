type StorageErrorCode =
  | 'INVALID_ARGUMENT'
  | 'QUOTA_EXCEEDED'
  | 'SERIALIZATION'
  | 'ACCESS'
  | 'DISPOSED'
  | 'CORRUPTED'
  | 'UNAVAILABLE'
  | 'CONFLICT';

interface StorageErrorOptions {
  /** The underlying error, e.g. the DOMException the browser threw. */
  cause?: unknown;
}

interface StorageQuotaErrorOptions extends StorageErrorOptions {
  bytes?: number;
  maxBytes?: number;
}

/**
 * Base class for every error the library throws or reports.
 * Branch on `code` or on the subclass. `name` is set explicitly so it
 * survives minification.
 */
class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(
    code: StorageErrorCode,
    message: string,
    options: StorageErrorOptions = {}
  ) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
    // Engines older than ES2022 ignore the options argument.
    if ('cause' in options && !('cause' in this)) this.cause = options.cause;
  }
}

/** An argument or option is invalid. Thrown. */
class StorageArgumentError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('INVALID_ARGUMENT', message, options);
    this.name = 'StorageArgumentError';
  }
}

/** The data does not fit `maxBytes` or the browser quota. Thrown, or reported for deferred writes. */
class StorageQuotaError extends StorageError {
  /** UTF-8 size of the string the write tried to store, when known. */
  readonly bytes: number | undefined;
  /** The vault's `maxBytes` when that was the limit hit; undefined for the browser quota. */
  readonly maxBytes: number | undefined;

  constructor(message: string, options: StorageQuotaErrorOptions = {}) {
    super('QUOTA_EXCEEDED', message, options);
    this.name = 'StorageQuotaError';
    this.bytes = options.bytes;
    this.maxBytes = options.maxBytes;
  }
}

/** A value or codec could not produce a string. Thrown, or reported for deferred writes. */
class StorageSerializationError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('SERIALIZATION', message, options);
    this.name = 'StorageSerializationError';
  }
}

/** The backend refused a read, write or remove. Thrown, or reported for deferred writes. */
class StorageAccessError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('ACCESS', message, options);
    this.name = 'StorageAccessError';
  }
}

/** The vault was disposed or replaced. Thrown. */
class StorageDisposedError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('DISPOSED', message, options);
    this.name = 'StorageDisposedError';
  }
}

/** Stored data could not be read and was treated as empty. Reported. */
class StorageCorruptionError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('CORRUPTED', message, options);
    this.name = 'StorageCorruptionError';
  }
}

/** Web Storage is blocked; the vault keeps data in memory. Reported. */
class StorageUnavailableError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('UNAVAILABLE', message, options);
    this.name = 'StorageUnavailableError';
  }
}

/** A newer vault took over the same storage key. Reported. */
class StorageConflictError extends StorageError {
  constructor(message: string, options?: StorageErrorOptions) {
    super('CONFLICT', message, options);
    this.name = 'StorageConflictError';
  }
}

function toStorageError(error: unknown, message: string): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageAccessError(message, { cause: error });
}

export {
  StorageError,
  StorageArgumentError,
  StorageQuotaError,
  StorageSerializationError,
  StorageAccessError,
  StorageDisposedError,
  StorageCorruptionError,
  StorageUnavailableError,
  StorageConflictError,
  toStorageError,
};
export type { StorageErrorCode, StorageErrorOptions, StorageQuotaErrorOptions };
