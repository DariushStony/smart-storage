const noop = (): void => undefined;

/** Anything that can run a task exclusively. */
interface TaskRunner {
  run<T>(task: () => T | Promise<T>): Promise<T>;
}

/**
 * Runs an async vault's operations one at a time, in call order, so
 * concurrent calls can never interleave their read-modify-write steps.
 */
class OperationQueue implements TaskRunner {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(noop, noop);
    return result;
  }

  /** Holds every later task until `gate` settles, whether it resolves or rejects. */
  after(gate: Promise<unknown>): void {
    this.tail = this.tail.then(() => gate).then(noop, noop);
  }
}

export { OperationQueue };
export type { TaskRunner };
