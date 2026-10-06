# Project status

Current behavior and owner decisions. See [architecture](architecture/README.md)
and the [bridge contract](protocol/bridge-v1.md) for implementation details.

## Available

- Live candles, Bid/Ask, symbol search/metadata, configurable timeframes and
  older-history paging; Fixed Range Volume Profile with BID/ASK and POC/VAH/VAL.
- Market, Limit, Stop and Stop Limit orders; optional SL/TP, time-in-force,
  risk preview and MT5 `OrderCheck`; chart/portfolio close, cancel and modify.
- Automatic sizing respects SL risk, broker lot limits and margin budget:
  `min(equity × Equity use % / 100, free margin)`. Equity use defaults to 100%
  and accepts greater than 0 through 100%; Risk % uses allocated equity,
  money risk stays fixed, and manual Units keeps explicit volume.
  MT5 quotes incorporate price, contract and leverage; `OrderCheck` checks affordability.
- Authenticated local TCP, account/session binding, reconciliation, append-only
  journals, one command in flight, saved settings and opt-in MT5 startup.

Not implemented: partial close, removing SL/TP, Break Even, multiple charts or
Pine Script execution.

## Interface decisions

- Chart-first workspace; Panel opens the ticket/portfolio drawer (overlay at
  ≤900 px). No separate execution-status panel or Commands list. Errors use
  dismissible bottom-right notifications; negative free margin preserves charts.
- Arrow/Crosshair share a toolbar group; Escape closes the menu without disarming.
  Volume Profile is separate; boundaries drag, Delete/Backspace clears it,
  timeframe changes preserve selection and symbol changes clear it.
- Price scale fits on load, then holds until rescaled; axis hover exposes `A`/`L`.
  History paging preserves viewport; timeframe changes preserve bar spacing and
  right-edge pixel distance. Clicking the current portfolio symbol keeps the chart.
- Countdown uses broker quote time and hides on stale quotes. Bid/Ask labels
  avoid overlap/axis-width shifts; timeframe buttons have equal fixed widths.
- Live P&L right-aligns within the widest amount observed per position, expanding
  only as needed and resetting on removal; units/RR stay in place. Overlapping
  trading rows spread vertically; close buttons follow labels, price lines stay put.
- Ticket/chart SL/TP amounts and RR share a display model using actual volume
  and unrounded estimates. Drags project the last broker quote immediately;
  broker replies replace estimates. Pending orders retain RR with both exits.
- Entering money/% risk fits SL distance from the current size (initially 1 lot),
  reducing size for margin/lot/minimum-distance limits and rounding within budget;
  the adjusted stop needs a fresh broker preview. Manual level edits cancel the fit.
- Money/% SL drags resize volume from the cached broker quote using native Decimal
  sizing; local projections cannot replace the fresh broker preview required to send.
  Market entry/exits and the grabbed SL USD label hold during a drag; release
  resumes quotes and shows the latest calculated SL amount.
- Review pins checked sizing across equity/free-margin ticks; editing recalculates.
  SL/TP and pending-entry drags use the execution guard; Shift+drag moves all levels.

Check corresponding E2E regressions before changing these decisions.

## Execution and configuration

`DISPATCH_ENABLED=true`; dispatch also needs app trading permission, handshake
`trading_enabled`, complete reconciliation and a working journal. EA rechecks
permissions. New submissions require an open broker session; modify/close/cancel
are exempt. No automatic retries; session loss/change drains the queue. Missing
broker records do not prove non-execution. Preview/check/reconciliation never send orders.

Trading/MT5 auto-start default off; settings apply after restart. Precedence:
process environment → first applicable `.env` → saved settings; only `MT5_` keys
load. Invalid configuration disables trading/auto-start. See [setup](../README.md#connect-to-metatrader-5).

## Validation and plans

Earlier MVP was verified on a demo account. Current changes, packaged builds and
native Windows/Linux behavior need manual verification; browser E2E uses a Tauri
stub. Real-account testing is unvalidated. See [release checklist](RELEASING.md).

Pine integration has not started. [Piner](https://github.com/heyphat/piner) 0.13.0
is preferred for v6 indicators (2026-10-04): targeted Node semantics/browser-bundle
checks passed; upstream suite/Tauri runtime and TradingView parity remain unchecked.
Use a Web Worker and existing chart adapter; keep scripts separate from execution.
Repository remains MIT; adoption needs an AGPL-compatible plan, or evaluate
[PineTS commercial licensing](https://github.com/LuxAlgo/PineTS/blob/main/LICENSE-COMMERCIAL.md).
