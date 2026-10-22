# Project status

Current behavior and owner decisions. See [architecture](architecture/README.md)
and the [bridge contract](protocol/bridge-v1.md) for implementation details.

React state ownership follows the 2026-10-08 [domain-store decision](reviews/domain-store-migration.md): scoped Zustand stores own frequent bridge/ticket and provider data; contexts inject stable dependencies or retain rare state. Chart effects and state hooks live in separate `effects/` and `state/` folders. Order-ticket producers expose commands; lifecycle effects consume focused entry, order-check, preview, and chart interfaces instead of a full ticket-state object. The lifecycle coordinator passes non-quote props to ordered children; only quote-dependent children subscribe to live quotes. Chart tools, the Arrow and Crosshair pointers included, are plugins: one folder per tool under `features/tools/` implementing the `ChartToolPlugin`/`ChartTool` contract (`features/chart/engine/toolContract.ts`), registered by one line in `features/tools/registry.ts`; the chart lifecycle passes that list to `ChartController` (`toolPlugins`), so the engine imports no concrete tool; the rail and icon iterate the registry, plugins sharing a `railGroup` (the pointers) render as one flyout button, and `DEFAULT_CHART_TOOL_ID` (arrow) is active when nothing else is. The engine owns only the pointer's time/price axis labels (`pointerReadoutPrimitive.ts`, shown for every tool); the Crosshair lines are drawn by `CrosshairTool` through the generic `pointerHover`/`pointerLeave` hooks and the layered `draw(ctx, viewport, layer)` hook (`aboveTradingOverlays*` layers); every plugin is built from its `toolClass`. Tools see the bridge only through the read-only `MarketDataPort` (`features/bridge/marketDataPort.ts`), never `invoke` or execution commands.

## Available

- Live candles, Bid/Ask, symbol search/metadata, configurable timeframes and
  older-history paging; Fixed Range Volume Profile with BID/ASK and POC/VAH/VAL. The profile is
  tick-exact when the range is affordable; otherwise (estimated from bars, or
  when a tick load hits the page/price limit) it is an APPROXIMATE bar profile
  (UP/DOWN volume in the ask/bid series, bar timeframe shown in the range band);
  fetched bars are cached in memory so refreshing an open range only fetches the
  newest (and, if extended, older) bars. When the broker's history for the bar
  timeframe ends inside the range, coarser timeframes (up to D1) are tried for
  the whole range; if none reaches the range start, the furthest-reaching one is
  used and the band label turns amber (`M2 · from 20 Mar`, `coveredFromMs`) so a
  partial profile is never shown as complete. Each profile logs its tick/bar
  choice, retries and reason to the `pnpm dev` terminal.
- The last chart window survives an app restart: on connect the app reopens the symbol and timeframe saved for the same login and broker server, and only when the broker still lists that symbol and serves that timeframe; another account, or a symbol the broker no longer lists, keeps the session default.
- Market, Limit, Stop and Stop Limit orders; optional SL/TP, time-in-force,
  risk preview and MT5 `OrderCheck`; chart/portfolio close, cancel and modify.
- Chart SL/TP clear chips remove the selected live level from positions or
  pending orders through the guarded modify pipeline.
- Automatic sizing respects SL risk, broker lot limits and margin budget:
  `min(equity × Equity use % / 100, free margin)`. Equity use defaults to 100%
  and accepts greater than 0 through 100%; Risk % uses allocated equity,
  money risk stays fixed, and manual Units keeps explicit volume. Risk % input
  stays in 0–100; zero/empty drafts cannot produce a risk preview.
  MT5 quotes incorporate price, contract and leverage; `OrderCheck` checks affordability.
- Authenticated local TCP, account/session binding, reconciliation, append-only
  journals, one command in flight, saved settings and opt-in MT5 startup.
- A demo (or contest) account scrolls three sentences in a thin strip along the top
  bar's bottom edge, in orange: "Demo account. No real money is involved.",
  "Orders here use your broker's demo funds." and "Switch to a real account in MT5
  to trade live.", spaced with no separator glyph. The strip is an absolute overlay
  that takes no layout space, so a real or disconnected account shows no strip and
  neither kind moves the bar or the chart; reduced motion shows the first sentence
  once, static and centred.
- Setup guide's automatic install (App settings -> "How to set up the bridge
  connection"): finds MT5 on Windows, macOS (the official app with its bundled
  Wine) and Linux (Wine prefixes `~/.mt5` and `~/.wine`), lists the `MQL5` data
  folders of each installation (portable and standard layouts), and "Install to
  MT5" copies `BetterChartsTickHistoryReader.mq5` into `Indicators` and
  `BetterChartsBridge.mq5` into `Experts/Advisors`, leaves older copies elsewhere
  below `MQL5` untouched, and compiles both with MetaEditor, reporting per file;
  the UTF-16LE log decides, and an indicator with errors stops the run before the
  EA. The guide's manual steps remain the fallback when no installation is found.
- The install offers two buttons, "Install to MT5" and "Install and restart MT5".
  A press installs and compiles both files; the restart button then closes MT5 and
  reopens it with the EA attached (the `Experts/Advisors` copy the install wrote,
  never an older copy left elsewhere), but only once every file compiled with 0
  errors and 0 warnings, so a run that needs fixing stops at its per-file rows. A
  clean run shows no message at all. The restart writes a temporary UTF-16LE
  `config/BetterChartsStartup.ini` below the install folder under Wine and below the
  MT5 data folder on native Windows (passed as an absolute `/config:` path; no
  symbol, so MT5 opens its own default chart) and a preset with the bridge token,
  host and port (`<MQL5>/Presets/BetterChartsStartup.set`), relaunches
  `terminal64.exe` (`/portable` for the portable layout) and deletes both files once
  the bridge connects, after 120 s, or at the next app start. It never enables Algo
  Trading, and is refused while an order is queued or in flight, without a token, or
  before the EA is installed.
- While no chart can be drawn — the bridge is unreachable or still without candles —
  a full-window blurred setup screen replaces the workspace: it names the missing
  MetaTrader 5 connection, keeps the notifications and the dialogs above it, and
  its "Open setup guide" button opens the guide on its own window, with no App
  settings dialog beneath it (the "Update in MT5" notice opens the same standalone
  guide). When "Install and restart MT5" finishes cleanly, or the bridge connects
  while the guide is open, the guide closes (App settings too, when it sits
  beneath) and a full-window blurred "setup complete" screen takes over: a check
  mark and a "Happy trading" button enter with a short animation, and the button
  drops the screen and shows the chart. A plain "Install to MT5" leaves the guide
  open, since the EA may not be attached yet, and a guide opened on an already
  connected bridge stays open. Once a plain install compiles every file clean, its
  two buttons give way to one "All installed. Close" button, which finishes the
  setup exactly like a clean "Install and restart MT5". The chart's connection dot appears only once a chart is rendered, and the
  install section names the data folder in words ("Installs into MetaTrader 5." or
  a portable/user folder choice) instead of showing its path.
- On first launch no dialog opens by itself: the setup screen stands in for the
  chart and its "Open setup guide" button leads on. That launch generates a random
  bridge token and saves it, so an EA already attached in MT5 cannot know it until
  the guide's install hands it over. The bridge, the environment exported at
  startup and the EA preset then share a token nobody had to invent.
- An outdated EA or tick reader sets `componentOutdated` on the bridge status; the
  error notice offers "Update in MT5", which opens the setup guide. A token
  mismatch sets `tokenMismatch` instead: the setup screen says the token differs
  and points at the guide's install, and no error notice is shown for it. Detected
  installation paths fill the App settings fields the user left unset (terminal
  path, Wine prefix, and the Wine binary while it is still `wine`); user values and
  `MT5_*` overrides are never replaced, and auto-start stays off unless the user
  enables it.
- Money amounts use the MT5 account currency and precision, formatted as
  `100.00 USD`, `100.00 EUR` or `100.00 PLN`. Chart estimates use broker tick
  values converted to account currency; unavailable or mismatched values are omitted.

- Partial close from the portfolio card (Close ▾) and the chart chip (✕ ▾):
  25/50/75% presets and a custom volume popover, validated against the
  symbol's min volume and volume step. Offered only when the EA negotiates the
  `partial_close` capability (EA 1.004).

Not implemented: break even, multiple charts or Pine Script execution.

## Interface decisions

- Chart-first workspace; Panel opens the ticket/portfolio drawer (overlay at
  ≤900 px). No separate execution-status panel or Commands list. Errors use
  dismissible bottom-right notifications with bright text, red borders and an error
  icon; messages start with a capital letter. Failed OrderCheck shows one broker
  rejection notice, without a separate last-error-code notice. Negative free margin preserves charts.
- Arrow/Crosshair share a toolbar group; Escape closes the menu without deselecting the tool.
  Volume Profile is separate; boundaries drag, Delete/Backspace clears it,
  timeframe changes preserve selection and symbol changes clear it. The two
  clicks may come in either order (earlier time = start); the end may be dropped
  in the empty area right of the newest bar and stays on that future slot
  (`endMs` = slot open + one bar). The start is always a real bar, and a dragged
  handle never crosses the other. While the newest bar opens before `endMs` the
  profile refreshes with ticks (at most every 2 s, old histogram kept until the
  new one arrives); when a bar opens at or after `endMs` it refreshes once more
  and the range is fixed. A range ended on an older bar never refreshes.
- Price scale fits on load, then holds until rescaled; axis hover exposes `A`/`L`.
  The first history request covers only the visible pane (`initialHistoryBars`
  in `config/bridge.json`; the UI measures the pane), then one older page is
  prefetched when idle. A reconnect of the same terminal and account reopens
  the symbol and timeframe the user was viewing (the bridge requests them
  itself); if they cannot be served, the EA's chart symbol is shown with a
  notice, and another account starts from the chart symbol. History paging
  preserves viewport; reconnecting or a
  new symbol resets to the latest history, while any replacement of the same
  symbol's series (a timeframe change or a fresh window) preserves bar spacing
  and the distance from the newest bar. The chart follows new bars while the
  newest bar is in view, keeping the distance from the right edge the user chose
  (zoomed, or panned into the right margin); moving it out of view stops
  following and bringing it back resumes. Live candles wait for the release
  while a pointer is pressed on the pane (at most 10 s), so a drag is not shifted
  by a new bar.
  Clicking the current portfolio symbol keeps the chart.
- The EA (1.012) sends the initial history only after MT5 reports the series
  synchronized, so stale cached bars never anchor the live feed. A synchronized
  but shallow series is sent as is (`complete=false`). Waiting past 5 s shows
  "Loading is taking longer than usual. Waiting N s. If no data arrives, switch
  to another symbol." counting 5 to 1 toward the shared deadline
  (`initialHistorySyncTimeoutMs`, 10 s, in `config/bridge.json`); a series that
  never synchronizes ends with a correlated error, the non-fatal
  `history-unavailable` event and "No data received for {symbol} {timeframe}.
  Switch to another symbol or try again later." The notice and the "Loading
  market data" message are centered on the window (a pointer-transparent fixed
  layer), not on the chart frame. The session, reconciliation and
  dispatch gates are untouched, and the app never retries on its own.
- Countdown uses broker quote time and hides on stale quotes. Bid/Ask labels
  avoid overlap/axis-width shifts; timeframe buttons have equal fixed widths.
- Live P&L right-aligns within the widest amount observed per position, expanding
  only as needed and resetting on removal; units/RR stay in place. Overlapping
  trading rows spread vertically without connector brackets; close buttons follow
  labels, price lines stay put.
- Ticket/chart SL/TP amounts and RR share a display model using actual volume
  and unrounded estimates. Live exit amounts come from MT5 portfolio snapshots
  at actual entry and volume, with converted tick estimates as a fallback.
  Drags project the last broker quote immediately;
  broker replies replace estimates. Pending orders retain RR with both exits.
- Entering money/% risk seeds a visible SL beyond the broker minimum, then sizes
  volume to the budget using MT5 quotes. Higher risk increases volume; margin/lot
  caps reduce achievable risk without moving SL outward. Existing SL edits stay put.
  Selecting a risk mode with an empty budget shows no risk validation notification;
  entering a value enables validation. Review still requires a valid stop and sizing.
  Below-minimum sizing reports that risk is too low for the minimum order size
  at the current SL distance. The Max SL guide and drag clamp use the unrounded
  Risk % budget that native sizing receives, not the rounded "≈ amount" hint.
  Without metadata, the seed uses a quarter of the visible price span. If no valid
  stop fits, a notification asks for zooming out or a manual SL; the scale stays fixed.
- Money/% SL drags resize volume from the cached broker quote using native Decimal
  sizing; local projections cannot replace the fresh broker preview required to send.
  Market entry/exits and the grabbed SL account-currency label hold during a drag; release
  resumes quotes and shows the latest calculated SL amount.
- Review shows checked units alongside price and margin, and pins checked sizing
  across equity/free-margin ticks; editing recalculates.
  Entering review flushes queued sizing before OrderCheck. Checks time out after 15 seconds
  with a notification; late replies cannot enable submission after timeout.
  The review card shows margin at fill, free margin after fill and margin level after fill
  (an estimate: the order is priced alone, ignoring open positions) plus the broker's
  margin-call and stop-out levels; below either level it warns in red but never blocks Send.
  Review shows no inline messages above Send; reasons appear as notifications, and the
  checking state shows in the (disabled) Send button as "Checking with MT5…".
  The review data block is always shown with stable rows: the ticket's own entry, SL/TP
  and units, and "—" for figures only MT5 OrderCheck can supply (used price, margin
  figures) while loading, blocked or failed. The "Checked" time appears only once MT5
  has returned a check result; until then its row is reserved but invisible.
  When the market reaches a Stop / Stop Limit trigger (EA `INVALID_PRICE`), Send stays
  blocked and one notification names the live price ("Price moved past your stop entry
  (Ask …). Move the entry above Ask or switch to Market."; sell: Bid/below). The live
  price updates in place without re-animating the notice. It is informational only (no
  action button); the entry, SL/TP and sending are never touched automatically.
  SL/TP and pending-entry drags use the execution guard; Shift+drag moves all levels.

Check corresponding E2E regressions before changing these decisions.

## Execution and configuration

`DISPATCH_ENABLED=true`; dispatch also needs app trading permission, handshake
`trading_enabled`, complete reconciliation and a working journal. EA rechecks
permissions. New submissions require an open broker session; modify/close/cancel
are exempt. No automatic retries; session loss/change drains the queue. Missing
broker records do not prove non-execution. Preview/check/reconciliation never send orders.

The setup guide's install and restart reuse the same execution queue guard: both
refuse while an order is queued or in flight, because a recompile drops the bridge
session and closing the terminal would lose the order.

Trading/MT5 auto-start default off; disabled auto-start skips startup process
inspection on every platform. Settings apply after restart. Precedence:
process environment → first applicable `.env` → saved settings; only `MT5_` keys
load. Invalid configuration disables trading/auto-start. See [setup](../README.md#connect-to-metatrader-5).

Initial settings content uses React 19 `use()` with a stable store-owned request
promise and a narrow Suspense loading fallback. The modal shell and focus trap
stay available during loading; cached settings remain editable during refresh.
Request generations still reject stale results. Event-driven bridge, symbol
search, and execution progress retain explicit pending states.

The trading panel mounts its order-ticket and portfolio views on first open,
then keeps them mounted across toggles to preserve local UI state. Its code is
statically loaded. Ticket stores, lifecycle effects, chart gestures, and bridge
updates remain active before the panel opens.

The trading panel always shows Balance, Equity, Margin, Free margin, and Margin
level in aligned label/value rows, independently of open positions. Missing
account data shows placeholders; monetary values retain account currency and
precision, while margin level uses percent.

Long symbol-search result lists expose a visible scrollbar so every result is
reachable by scrolling or dragging the thumb. Scrollbars across the app use the
dark border palette color for slim thumbs, with transparent tracks and a subtly
lighter hover state.
Search favorite stars use a fixed-width column and a shared icon outline;
reserved scrollbar space prevents horizontal movement as rows are added or removed.

## Validation and plans

Windows release builds use the GUI subsystem; background process checks and stop
commands create no console window. Debug builds retain console output. macOS/Linux
launch helpers directly without opening a terminal emulator.

Production frontend console logging is removed. Actionable errors remain visible
in the UI; backend diagnostics and the durable execution journal remain active.

Earlier MVP was verified on a demo account. Current changes, packaged builds and
native Windows/Linux behavior need manual verification; browser E2E uses a Tauri
stub. Real-account testing is unvalidated. See [release checklist](RELEASING.md).

The MetaEditor compile command and the attach-on-restart startup files were
verified by hand on macOS with the official MT5 application; the in-app restart
flow still needs a manual check there. Windows and Linux discovery, compile
commands and launches are covered by unit tests only; the restart closes MT5 with
`taskkill`/`pkill`, which may close it less gracefully than quitting it.

Pine integration has not started. [Piner](https://github.com/heyphat/piner) 0.13.0
is preferred for v6 indicators (2026-10-04): targeted Node semantics/browser-bundle
checks passed; upstream suite/Tauri runtime and TradingView parity remain unchecked.
Use a Web Worker and existing chart adapter; keep scripts separate from execution.
Repository remains MIT; adoption needs an AGPL-compatible plan, or evaluate
[PineTS commercial licensing](https://github.com/LuxAlgo/PineTS/blob/main/LICENSE-COMMERCIAL.md).
