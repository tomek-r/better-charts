# Project status

Updated 2026-10-04. This is the current feature and validation summary. See
[architecture](architecture/README.md) for implementation boundaries and the
[bridge contract](protocol/bridge-v1.md) for wire semantics.

## Available

- Live candlestick charts, Bid/Ask quotes, symbol search and metadata, and
  M1, M5, M15, H1, H4 and D1 timeframes. Older history loads as the chart pans.
- Fixed Range Volume Profile with BID/ASK tick activity and POC/VAH/VAL.
  Calculation supports cancellation and reports incomplete history.
- Market, Limit, Stop and Stop Limit orders; risk sizing, optional SL/TP,
  time-in-force, risk preview and read-only MT5 `OrderCheck`.
- Positions and pending orders on the chart and in the portfolio drawer,
  with close, cancel and modification controls.
- Local authenticated TCP bridge, account/session binding, reconciliation,
  append-only execution journals and one command in flight.
- Saved app settings and optional, explicitly configured MT5 startup.

Partial close, removing SL/TP, Break Even, multiple charts and Pine Script
execution are not implemented.

## Interface decisions

- The chart is the main workspace. The Panel button opens the ticket and
  portfolio drawer; at widths of 900 px or less it overlays the chart.
- There is no separate execution-status panel or Commands list.
- Arrow and MT5-style Crosshair pointers share a toolbar group. Escape closes
  its menu without disarming the tool. Fixed Range Volume Profile is separate.
- The price scale fits on series load, then holds until the user rescales it.
  Hovering the right axis reveals auto-scale (`A`) and logarithmic (`L`) controls.
- History paging preserves the viewport. Timeframe changes preserve bar spacing
  and the viewport's pixel distance from the right edge.
- The countdown uses broker quote time and hides when quotes stop. Bid/Ask
  labels avoid overlap and axis-width changes that would move the chart.
- Profile boundaries can be dragged; Delete/Backspace clears the profile.
  The selection survives timeframe changes and clears on symbol changes.
- Position SL/TP and pending-order price drags use the execution guard.
  Shift+drag moves a pending entry and its SL/TP together.

Check the corresponding E2E regressions before changing these behaviors.

## Execution and configuration

`DISPATCH_ENABLED` is currently `true`. Dispatch also requires the app's
trading permission, handshake `trading_enabled=true`, complete reconciliation
and an available journal. The EA rechecks trading permissions before execution.
New submissions additionally require an observed open broker trade session;
modify, close and cancel are not subject to that session-hours check.

Commands are never retried automatically. A session change or loss drains the
queue. Missing broker records do not prove non-execution. Risk preview,
`OrderCheck` and reconciliation never call `OrderSend`.

Trading and MT5 auto-start default to disabled. Settings apply after restart;
process environment overrides the first applicable `.env`, which overrides
saved settings. Only `MT5_` keys are loaded. Invalid configuration disables
trading and auto-start. See [setup](../README.md#connect-to-metatrader-5).

## Validation status

The earlier MVP was verified end to end on a demo account. Current chart
changes, packaged builds and native Windows/Linux runtime behavior still need
manual verification. Browser E2E tests use a Tauri stub and do not establish
MT5 runtime correctness. Real-account testing has not been validated.

Use the [release checklist](RELEASING.md) before publishing installers.

## Planned Pine Script support

Piner is the preferred engine to evaluate for v6 indicators, recorded on
2026-10-04. Run calculations in a Web Worker and render through the existing
chart adapter. Integration has not started; the repository remains MIT licensed.

[Piner](https://github.com/heyphat/piner) 0.13.0 passed targeted Node checks for
basic v6 syntax, series history, persistent state and open-bar rollback, and
browser bundling. Full upstream tests and the Tauri runtime were not checked.
Validate representative indicators against TradingView before integration.
Adoption requires a compatible AGPL licensing plan; for proprietary distribution,
evaluate [PineTS's commercial license](https://github.com/LuxAlgo/PineTS/blob/main/LICENSE-COMMERCIAL.md).
Script calculations remain separate from order execution.
