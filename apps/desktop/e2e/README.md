# Browser tests

Playwright tests the desktop frontend in Chromium, including the browser
fallback and execution flows through a deterministic Tauri v2 stub. It does
not launch MT5 or verify the real Tauri runtime.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter better-charts exec playwright install chromium
pnpm test:e2e
```

Browser installation requires network access once. Playwright starts Vite on
port 1420 and reuses an existing server. Traces are saved on failure. On busy
machines, limit concurrency with `pnpm test:e2e --workers=2`.

## Test boundaries

- `tauriStub.ts` installs before app load. Commands have scripted responses,
  invocation logs and deterministic failures; unscripted commands reject.
- Events use the production TypeScript contracts and listener registry. Stub
  risk values test UI flow, not the Rust risk calculations.
- Canvas gestures cover staged orders, SL/TP and pending-price changes,
  close/cancel, crosshair, volume profiles, viewport and scale controls.
- Development-only `__chartTest` and `__stagedWidgetTest` hooks expose limited
  observations, not chart-library objects. See `devTestApi.ts` in the chart engine.
- Uncaught page errors fail tests. Browser-fallback tests may allow expected
  Tauri invocation errors; preserve each test's console assertions.

Run manual demo-account verification separately before a desktop release.
