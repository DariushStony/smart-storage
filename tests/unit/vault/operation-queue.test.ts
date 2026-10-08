import { describe, expect, it } from 'vitest';

import { OperationQueue } from '../../../src/vault/operation-queue.js';

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('OperationQueue', () => {
  it('runs tasks one at a time, in call order', async () => {
    const queue = new OperationQueue();
    const log: string[] = [];

    await Promise.all([
      queue.run(async () => {
        log.push('a:start');
        await tick();
        log.push('a:end');
      }),
      queue.run(() => {
        log.push('b');
      }),
    ]);

    expect(log).toEqual(['a:start', 'a:end', 'b']);
  });

  it('passes results through and keeps going after a failure', async () => {
    const queue = new OperationQueue();
    const failed = queue.run(() => {
      throw new Error('boom');
    });
    const next = queue.run(() => 42);

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);
  });

  it('after() holds later tasks until the gate settles, even if it rejects', async () => {
    const queue = new OperationQueue();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((_, reject) => {
      release = () => reject(new Error('gate failed'));
    });
    queue.after(gate);
    const log: string[] = [];
    const task = queue.run(() => log.push('ran'));

    await tick();
    expect(log).toEqual([]);
    release();
    await task;
    expect(log).toEqual(['ran']);
  });
});
