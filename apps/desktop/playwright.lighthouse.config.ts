import { defineConfig, devices } from '@playwright/test';

/**
 * Lighthouse harness config: runs `scripts/lighthouse.spec.ts` only, so the
 * audit never joins the E2E suite or the pre-commit hook. It always builds and
 * serves a fresh PRODUCTION bundle (`vite build` + `vite preview`) on port
 * 4173, because dev-server numbers say nothing about shipped performance.
 *
 *   pnpm lighthouse
 *   LIGHTHOUSE_RUNS=3 pnpm lighthouse
 */
export default defineConfig({
  testDir: './scripts',
  testMatch: 'lighthouse.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
