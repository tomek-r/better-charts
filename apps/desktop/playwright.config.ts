import { defineConfig, devices } from '@playwright/test';

/** Not the 1420 of `pnpm tauri dev`, so a running app never collides with tests. */
const E2E_DEV_SERVER_PORT = 1421;
const E2E_DEV_SERVER_URL = `http://localhost:${E2E_DEV_SERVER_PORT}`;

/**
 * Playwright smoke config for the desktop web UI.
 * `webServer` boots this checkout's Vite dev server on its own port
 * (strictPort) and never reuses a running one, so tests always exercise the
 * code in this checkout.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Three quarters of the cores: with tracing off the suite scales with workers (5.3 min on the default half of
  // 14 cores, 3.0 min on 10). Every core was no faster and timed out under load in one run of two, since Vite
  // and the browsers need cores too.
  workers: '75%',
  reporter: [['list']],
  use: {
    baseURL: E2E_DEV_SERVER_URL,
    // Recording a trace for every test, only to keep the failing ones, cost 28% of the browser specs' run time
    // and left extra workers idle. CI keeps no artifacts, so a failure is rerun locally with `--trace on`.
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${E2E_DEV_SERVER_PORT} --strictPort`,
    url: E2E_DEV_SERVER_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
