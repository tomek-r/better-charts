import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke config for the desktop web UI.
 * `webServer` boots the same Vite dev server as `pnpm dev` (port 1420,
 * strictPort) and reuses one that is already running.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
