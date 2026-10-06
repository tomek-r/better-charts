import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Price-scale regressions must also run in the macOS desktop browser engine. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:1421' },
  webServer: {
    command: 'pnpm dev --port 1421',
    url: 'http://localhost:1421',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  testMatch: 'price-scale-controls.spec.ts',
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
});
