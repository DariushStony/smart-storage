import { describe, expect, it, vi } from 'vitest';

import { LoggingHandler } from '../../src/logger/logging-handler.js';
import type { StorageLogger } from '../../src/logger/storage-logger.js';
import { InlineTransformHandler } from '../../src/transform/inline-transform-handler.js';
import { TransformChain } from '../../src/transform/transform-chain.js';
import { TransformHandler } from '../../src/transform/transform-handler.js';
import type { StorageTransform } from '../../src/transform/types.js';

/** Wraps the payload so ordering is visible in assertions. */
class TagHandler extends TransformHandler {
  constructor(private tag: string) {
    super();
  }

  protected process(data: string): string {
    return `${this.tag}(${data})`;
  }

  protected reverseProcess(data: string): string {
    const prefix = `${this.tag}(`;
    if (!data.startsWith(prefix) || !data.endsWith(')')) {
      throw new Error(`TagHandler(${this.tag}) received unexpected: ${data}`);
    }
    return data.slice(prefix.length, -1);
  }
}

const base64Transform: StorageTransform = {
  serialize: (data) => btoa(data),
  deserialize: (data) => atob(data),
};

describe('TransformChain', () => {
  describe('empty chain', () => {
    it('passes data through untouched', () => {
      const chain = TransformChain.from([]);
      expect(chain.apply('hello')).toBe('hello');
      expect(chain.reverse('hello')).toBe('hello');
    });

    it('reports having no transforms', () => {
      expect(TransformChain.from([]).hasTransforms()).toBe(false);
    });
  });

  describe('single handler', () => {
    it('applies and reverses symmetrically', () => {
      const chain = TransformChain.from([new TagHandler('a')]);
      expect(chain.apply('x')).toBe('a(x)');
      expect(chain.reverse('a(x)')).toBe('x');
    });

    it('reports having transforms', () => {
      expect(TransformChain.from([new TagHandler('a')]).hasTransforms()).toBe(
        true
      );
    });
  });

  describe('ordering', () => {
    it('applies handlers head to tail on write', () => {
      const chain = TransformChain.from([
        new TagHandler('a'),
        new TagHandler('b'),
        new TagHandler('c'),
      ]);
      // a runs first, so its tag is innermost.
      expect(chain.apply('x')).toBe('c(b(a(x)))');
    });

    it('reverses handlers tail to head on read', () => {
      const chain = TransformChain.from([
        new TagHandler('a'),
        new TagHandler('b'),
        new TagHandler('c'),
      ]);
      expect(chain.reverse('c(b(a(x)))')).toBe('x');
    });

    it('round-trips an arbitrary payload', () => {
      const chain = TransformChain.from([
        new TagHandler('outer'),
        base64Transform,
        new TagHandler('inner'),
      ]);
      const payload = JSON.stringify({ theme: 'dark', n: 42 });
      expect(chain.reverse(chain.apply(payload))).toBe(payload);
    });
  });

  describe('plain transform objects', () => {
    it('accepts a bare { serialize, deserialize } object', () => {
      const chain = TransformChain.from([base64Transform]);
      const applied = chain.apply('hello');
      expect(applied).toBe(btoa('hello'));
      expect(chain.reverse(applied)).toBe('hello');
    });

    it('mixes plain objects and class handlers in one chain', () => {
      const chain = TransformChain.from([new TagHandler('a'), base64Transform]);
      expect(chain.reverse(chain.apply('data'))).toBe('data');
    });
  });

  describe('error propagation', () => {
    it('surfaces an error thrown by a handler', () => {
      const exploding: StorageTransform = {
        serialize: () => {
          throw new Error('serialize boom');
        },
        deserialize: (d) => d,
      };

      const chain = TransformChain.from([exploding]);
      expect(() => chain.apply('x')).toThrow('serialize boom');
    });
  });
});

describe('TransformHandler', () => {
  it('links prev and next when chained', () => {
    const a = new TagHandler('a');
    const b = new TagHandler('b');

    const returned = a.setNext(b);

    // setNext returns the next handler so calls can be chained fluently.
    expect(returned).toBe(b);
    expect(a.getNext()).toBe(b);
    expect(b.getPrev()).toBe(a);
    expect(a.getPrev()).toBeNull();
    expect(b.getNext()).toBeNull();
  });
});

describe('InlineTransformHandler', () => {
  it('adapts a plain transform into a handler', () => {
    const handler = new InlineTransformHandler(base64Transform);
    expect(handler).toBeInstanceOf(TransformHandler);
    expect(handler.serialize('hi')).toBe(btoa('hi'));
    expect(handler.deserialize(btoa('hi'))).toBe('hi');
  });
});

describe('LoggingHandler', () => {
  it('passes data through unchanged in both directions', () => {
    const logger: StorageLogger = { log: vi.fn() };
    const chain = TransformChain.from([new LoggingHandler(logger)]);

    expect(chain.apply('payload')).toBe('payload');
    expect(chain.reverse('payload')).toBe('payload');
  });

  it('exposes the logger it was constructed with', () => {
    const logger: StorageLogger = { log: vi.fn() };
    expect(new LoggingHandler(logger).getLogger()).toBe(logger);
  });

  it('does not disturb the transforms around it', () => {
    const logger: StorageLogger = { log: vi.fn() };
    const withLogging = TransformChain.from([
      new LoggingHandler(logger),
      new TagHandler('a'),
    ]);
    const withoutLogging = TransformChain.from([new TagHandler('a')]);

    // Adding logging must be observationally invisible to stored bytes,
    // otherwise enabling it would corrupt existing data.
    expect(withLogging.apply('x')).toBe(withoutLogging.apply('x'));
  });
});
