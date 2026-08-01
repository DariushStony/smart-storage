import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration.
 *
 * These specs exercise behavior a simulated DOM cannot honestly prove: real
 * persistence across reloads, sessionStorage clearing with the tab, genuine
 * pagehide flushing, and real quota limits. Pure logic lives in the Vitest
 * suite under tests/unit.
 *
 * The suite loads the built ESM bundle, so `pnpm build` must run first --
 * the `pretest:e2e` script handles that.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Specs are named *.e2e.ts to keep them clearly distinct from the Vitest
  // *.test.ts files, so the default spec/test pattern would miss them.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    // A real origin is required: Web Storage is origin-scoped and is
    // unavailable on about:blank and file:// in some browsers.
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Serves the repo root so specs can import /dist/index.js directly.
    command: 'node tests/e2e/server.mjs',
    url: 'http://localhost:4173/tests/e2e/harness.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
