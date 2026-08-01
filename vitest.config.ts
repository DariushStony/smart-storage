import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom gives us window, localStorage, sessionStorage and DOMException
    // without a real browser. Genuine persistence across reloads, real quota
    // limits and pagehide are covered by the Playwright suite in tests/e2e.
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    // tests/e2e is driven by Playwright, not Vitest.
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      // Reported, not gated -- see CONTRIBUTING. Add thresholds once the
      // numbers have settled rather than picking one up front.
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
    },
  },
});
