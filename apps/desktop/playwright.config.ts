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
  reporter: [['list']],
  use: {
    baseURL: E2E_DEV_SERVER_URL,
    trace: 'on-failure',
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
