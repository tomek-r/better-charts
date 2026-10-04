import { defineConfig, devices } from '@playwright/test';

/**
 * Profiler harness config: runs `scripts/react-profiler.spec.ts` only, so the
 * measurement never joins the E2E suite or the pre-commit hook. The harness
 * asserts nothing — it drives a fixed interaction scenario and writes what
 * React's DevTools hook saw to `PROFILER_OUT`.
 *
 * Measure another checkout by starting its dev server on a free port and
 * setting `PROFILER_BASE`:
 *
 *   PROFILER_BASE=http://localhost:1421 PROFILER_OUT=/tmp/base.json pnpm profiler
 */
export default defineConfig({
  testDir: './scripts',
  testMatch: 'react-profiler.spec.ts',
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:1420' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
