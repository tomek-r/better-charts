import { defineConfig, devices } from '@playwright/test';

/** Serves the pre-built bundle; not the 1420 of `pnpm tauri dev`. */
const E2E_BUNDLE_PORT = 1421;
const E2E_BUNDLE_URL = `http://localhost:${E2E_BUNDLE_PORT}`;
const E2E_BUNDLE_DIR = '.e2e-bundle';
const E2E_BUNDLE_COMMAND =
  `pnpm exec vite build --mode development --minify false --outDir ${E2E_BUNDLE_DIR} --emptyOutDir && ` +
  `pnpm exec vite preview --outDir ${E2E_BUNDLE_DIR} --port ${E2E_BUNDLE_PORT} --strictPort`;
/** The dev server for the source-module specs; not WebKit's 1422, so both suites can run at once. */
const E2E_DEV_SERVER_PORT = 1423;
const E2E_DEV_SERVER_URL = `http://localhost:${E2E_DEV_SERVER_PORT}`;

/**
 * These specs load source modules or `/e2e/helpers/*Harness.tsx` into the page, which only the dev server serves.
 * A spec that does so and is missing here fails on the bundle with "Failed to fetch dynamically imported module".
 */
const SOURCE_MODULE_SPECS: string[] = [
  'candle-validation.spec.ts',
  'chart-migration.spec.ts',
  'field-store.spec.ts',
  'history-adapter-coalescing.spec.ts',
  'indicator-pushed-frames.spec.ts',
  'live-candle-state.spec.ts',
  'market-data-forwarding.spec.ts',
  'modal-dialog.spec.ts',
  'native-context-menu.spec.ts',
  'provider-isolation.spec.ts',
  'quote-presentation.spec.ts',
  'tool-set-construction.spec.ts',
  'color-picker.spec.ts',
  'drawing-settings-fields.spec.ts',
  'drawing-settings-tabs.spec.ts',
  'field-focus.spec.ts',
  'fixed-range-profile-settings-dialog.spec.ts',
  'select.spec.ts',
];

/**
 * Playwright smoke config for the desktop web UI.
 * Serves a pre-built bundle on its own port (strictPort) for most specs, since
 * a page load from the dev server costs 604 module requests, and keeps a second
 * dev server for the specs that load source modules into the page. Both never
 * reuse a running server, so tests always exercise the code in this checkout.
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
    // Recording a trace for every test, only to keep the failing ones, cost 28% of the browser specs' run time
    // and left extra workers idle. CI keeps no artifacts, so a failure is rerun locally with `--trace on`.
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: SOURCE_MODULE_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: E2E_BUNDLE_URL },
    },
    {
      name: 'chromium-source-modules',
      testMatch: SOURCE_MODULE_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: E2E_DEV_SERVER_URL },
    },
  ],
  webServer: [
    // Rebuilt on every run (4s), so it is never stale; NODE_ENV development keeps the dev test hooks and React's
    // development build, and no minifying keeps CSS values as written, as the dev server serves them.
    {
      command: E2E_BUNDLE_COMMAND,
      url: E2E_BUNDLE_URL,
      env: { NODE_ENV: 'development' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // Only for the specs in SOURCE_MODULE_SPECS.
    {
      command: `pnpm dev --port ${E2E_DEV_SERVER_PORT} --strictPort`,
      url: E2E_DEV_SERVER_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
