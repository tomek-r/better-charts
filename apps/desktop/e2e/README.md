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

Price-scale regressions also have a WebKit suite for the macOS desktop browser
engine. It covers XBRUSD scale dragging, NAS100 logarithmic switching, and
keeping manual ranges fixed during live bar updates. It starts its own Vite
server on port 1421 to avoid reusing a desktop dev session.

```bash
pnpm --filter better-charts exec playwright install webkit
pnpm --filter better-charts exec playwright test --config playwright.webkit.config.ts
```

## Helpers

`helpers/` holds shared non-test code: the Tauri stub (`tauriStub.ts`), page
objects (`panel.ts`), canvas and overlay utilities (`canvasText.ts`,
`overlayHarness.ts`), the dev chart hook typings (`chartTest.ts`), and the
React harnesses that specs load by URL as `/e2e/helpers/*Harness.tsx`. Files
there are not tests and must not end in `.spec.ts`.

## Test boundaries

- `helpers/tauriStub.ts` installs before app load. Commands have scripted responses,
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
