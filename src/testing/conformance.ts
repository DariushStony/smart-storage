type MaybePromise<T> = T | Promise<T>;

/** The surface the checks touch; sync and async drivers both fit it. */
interface CheckedDriver {
  readonly name: string;
  read(key: string): MaybePromise<string | null>;
  write(key: string, value: string): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

interface VerifyOptions {
  /**
   * Characters written by the [large] check. Default 65_536; lower it for
   * small backends such as cookies.
   */
  largeValueLength?: number;
}

interface ConformanceCheck {
  /** Rule id, as listed in docs/CUSTOM_STORAGE.md. */
  rule: string;
  description: string;
  passed: boolean;
  /** Why it failed: a ContractViolation, or whatever the driver threw. */
  error?: unknown;
}

interface ConformanceReport {
  /** The driver's name, or 'unknown' when none could be read. */
  driver: string;
  passed: boolean;
  checks: ConformanceCheck[];
}

interface Settings {
  largeValueLength: number;
}

interface Check {
  rule: string;
  description: string;
  run(
    driver: CheckedDriver,
    keys: KeyTracker,
    settings: Settings
  ): MaybePromise<void>;
}

class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}

/** Remembers every key a check touches, so the runner can remove them. */
class KeyTracker {
  readonly used = new Set<string>();

  key(name: string): string {
    this.used.add(name);
    return name;
  }
}

const P = '__conformance__:';

const EXACT_VALUES = [
  'unicode: é 中文 😀',
  'quotes: " \' and a backslash \\',
  'whitespace:\n\r\t and trailing  ',
  '{"json":[1,2,{"nested":null}],"escaped":"\\u0000"}',
];

function show(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 60
      ? `a ${String(value.length)}-character string`
      : JSON.stringify(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value.toString();
  }
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function same(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new ContractViolation(
      `${what}: expected ${show(expected)}, got ${show(actual)}.`
    );
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function largeValue(length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(97 + (i % 26));
  }
  return text;
}

async function roundTrip(
  driver: CheckedDriver,
  key: string,
  value: string,
  what: string
): Promise<void> {
  await driver.write(key, value);
  same(await driver.read(key), value, what);
}

const CONTRACT: Check[] = [
  {
    rule: 'name',
    description: 'name is a non-empty string that does not change',
    run: (driver) => {
      const first = driver.name;
      const second = driver.name;
      if (typeof first !== 'string' || first.trim() === '') {
        throw new ContractViolation(
          `name: expected a non-empty string, got ${show(first)}.`
        );
      }
      if (first !== second) {
        throw new ContractViolation(
          `name changed between reads: ${show(first)}, then ${show(second)}.`
        );
      }
    },
  },
  {
    rule: 'missing',
    description: 'read returns null for a key that was never written',
    run: async (driver, keys) => {
      same(
        await driver.read(keys.key(`${P}missing`)),
        null,
        'read of a missing key'
      );
    },
  },
  {
    rule: 'roundtrip',
    description: 'read returns exactly what write stored',
    run: (driver, keys) =>
      roundTrip(driver, keys.key(`${P}roundtrip`), 'value', 'read after write'),
  },
  {
    rule: 'empty',
    description: 'the empty string round-trips as "", not null',
    run: (driver, keys) =>
      roundTrip(driver, keys.key(`${P}empty`), '', 'read after writing ""'),
  },
  {
    rule: 'exact',
    description:
      'unicode, quotes, backslashes, newlines and JSON text round-trip unchanged',
    run: async (driver, keys) => {
      for (const [index, value] of EXACT_VALUES.entries()) {
        await roundTrip(
          driver,
          keys.key(`${P}exact-${String(index)}`),
          value,
          `read after writing ${show(value)}`
        );
      }
    },
  },
  {
    rule: 'large',
    description: 'a large value round-trips',
    run: (driver, keys, settings) =>
      roundTrip(
        driver,
        keys.key(`${P}large`),
        largeValue(settings.largeValueLength),
        'read after a large write'
      ),
  },
  {
    rule: 'overwrite',
    description: 'a second write replaces the value',
    run: async (driver, keys) => {
      const key = keys.key(`${P}overwrite`);
      await driver.write(key, 'first');
      await roundTrip(driver, key, 'second', 'read after overwriting');
    },
  },
  {
    rule: 'remove',
    description: 'read returns null after remove',
    run: async (driver, keys) => {
      const key = keys.key(`${P}remove`);
      await driver.write(key, 'value');
      await driver.remove(key);
      same(await driver.read(key), null, 'read after remove');
    },
  },
  {
    rule: 'remove-missing',
    description: 'removing a key that was never written does not throw',
    run: async (driver, keys) => {
      await driver.remove(keys.key(`${P}never-written`));
    },
  },
  {
    rule: 'independent',
    description: 'keys are independent and exact (case and spaces matter)',
    run: async (driver, keys) => {
      const removed = keys.key(`${P}a`);
      // " k" and "k " catch drivers that trim keys.
      const kept = [`${P}b`, `${P}K`, `${P}k`, `${P} k`, `${P}k `].map((key) =>
        keys.key(key)
      );
      for (const key of [removed, ...kept]) {
        await driver.write(key, `value of ${key}`);
      }
      await driver.remove(removed);

      same(await driver.read(removed), null, 'read of a removed key');
      for (const key of kept) {
        same(await driver.read(key), `value of ${key}`, `read of ${show(key)}`);
      }
    },
  },
  {
    rule: 'any-key',
    description: 'keys may contain ":", "/", spaces, unicode and "__proto__"',
    run: async (driver, keys) => {
      // The bare __proto__ catches drivers built on plain objects.
      for (const key of [`${P}a:b/c d`, `${P}ü 中文 😀`, '__proto__']) {
        await roundTrip(
          driver,
          keys.key(key),
          `value of ${key}`,
          `read of ${show(key)}`
        );
      }
    },
  },
];

const SYNC_CHECK: Check = {
  rule: 'sync',
  description:
    'read, write and remove return their results directly, not Promises',
  run: (driver, keys) => {
    const key = keys.key(`${P}sync`);
    const results: Array<[string, unknown]> = [
      ['write', driver.write(key, 'value')],
      ['read', driver.read(key)],
      ['remove', driver.remove(key)],
    ];
    // Settle every returned promise first, so none surfaces as an unhandled
    // rejection after this check has already failed.
    for (const [, result] of results) {
      if (isThenable(result)) result.then(undefined, () => undefined);
    }
    const promised = results.find(([, result]) => isThenable(result));
    if (promised) {
      throw new ContractViolation(
        `${promised[0]} returned a Promise; a sync driver must return its result directly.`
      );
    }
  },
};

async function runConformance(
  create: () => MaybePromise<CheckedDriver>,
  modeCheck: Check,
  options: VerifyOptions = {}
): Promise<ConformanceReport> {
  const largeValueLength = options.largeValueLength ?? 65_536;
  // A zero, negative or fractional size would make [large] pass trivially.
  if (!Number.isInteger(largeValueLength) || largeValueLength < 1) {
    throw new RangeError('largeValueLength must be a positive integer.');
  }
  const settings: Settings = { largeValueLength };
  const checks: ConformanceCheck[] = [];
  let driverName = 'unknown';

  for (const check of [modeCheck, ...CONTRACT]) {
    const keys = new KeyTracker();
    let driver: CheckedDriver | undefined;
    try {
      driver = await create();
      if (typeof driver.name === 'string' && driver.name !== '') {
        driverName = driver.name;
      }
      await check.run(driver, keys, settings);
      checks.push({
        rule: check.rule,
        description: check.description,
        passed: true,
      });
    } catch (error) {
      checks.push({
        rule: check.rule,
        description: check.description,
        passed: false,
        error,
      });
    } finally {
      if (driver) await cleanUp(driver, keys);
    }
  }

  return {
    driver: driverName,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function cleanUp(driver: CheckedDriver, keys: KeyTracker): Promise<void> {
  for (const key of keys.used) {
    try {
      await driver.remove(key);
    } catch {
      // Best effort: a broken remove is already reported by its own rule.
    }
  }
}

function formatFailures(report: ConformanceReport): string {
  const failed = report.checks.filter((check) => !check.passed);
  const lines = failed.map((check) => {
    const reason =
      check.error instanceof Error ? check.error.message : String(check.error);
    return `- [${check.rule}] ${check.description}: ${reason}`;
  });
  return `Driver "${report.driver}" breaks ${String(failed.length)} contract rule(s):\n${lines.join('\n')}`;
}

export { runConformance, formatFailures, SYNC_CHECK, ContractViolation };
export type {
  Check,
  CheckedDriver,
  ConformanceCheck,
  ConformanceReport,
  VerifyOptions,
};
