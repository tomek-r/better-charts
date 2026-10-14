import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Distinct from the Chromium suite's 1421 so both can run at the same time. */
const WEBKIT_DEV_SERVER_PORT = 1422;
const WEBKIT_DEV_SERVER_URL = `http://localhost:${WEBKIT_DEV_SERVER_PORT}`;

/** Price-scale regressions must also run in the macOS desktop browser engine. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: WEBKIT_DEV_SERVER_URL },
  webServer: {
    command: `pnpm dev --port ${WEBKIT_DEV_SERVER_PORT} --strictPort`,
    url: WEBKIT_DEV_SERVER_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  testMatch: 'price-scale-controls.spec.ts',
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
});
