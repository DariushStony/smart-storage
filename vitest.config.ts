import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom gives us window, localStorage, sessionStorage and DOMException
    // without a real browser. Genuine persistence across reloads, real quota
    // limits and pagehide are covered by the Playwright suite in tests/e2e.
    environment: 'happy-dom',
    // Node >= 25 ships a built-in localStorage global that shadows happy-dom's.
    execArgv:
      Number(process.versions.node.split('.')[0]) >= 25
        ? ['--no-experimental-webstorage']
        : [],
    include: ['tests/unit/**/*.test.ts'],
    // tests/e2e is driven by Playwright, not Vitest.
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      // Enforced: the rewrite is fully covered, and must stay that way.
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Type-only modules have no runtime code to measure.
      exclude: ['src/vault/vault.ts', 'src/persistence/snapshot-store.ts'],
    },
  },
});
