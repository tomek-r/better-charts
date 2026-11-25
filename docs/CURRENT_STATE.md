# Project status

Current behavior and owner decisions. See [architecture](architecture/README.md)
and the [bridge contract](protocol/bridge-v1.md) for implementation details.

React state ownership follows the 2026-10-08 [domain-store decision](reviews/domain-store-migration.md): scoped Zustand stores own frequent bridge/ticket and provider data; contexts inject stable dependencies or retain rare state. Chart effects and state hooks live in separate `effects/` and `state/` folders. Order-ticket producers expose commands; lifecycle effects consume focused entry, order-check, preview, and chart interfaces instead of a full ticket-state object. The lifecycle coordinator passes non-quote props to ordered children; only quote-dependent children subscribe to live quotes. Chart tools, the Arrow and Crosshair pointers included, are plugins: one folder per tool under `features/tools/` implementing the `ChartToolPlugin`/`ChartTool` contract (`features/chart/engine/tools/toolContract.ts`), registered by one line in `features/tools/registry.ts`; the chart lifecycle passes that list to `ChartController` (`toolPlugins`), so the engine imports no concrete tool; the rail and icon iterate the registry, plugins sharing a `railGroup` (the pointers) render as one flyout button, and `DEFAULT_CHART_TOOL_ID` (arrow) is active when nothing else is. The engine owns only the pointer's time/price axis labels (`pointerReadoutPrimitive.ts`, shown for every tool); the Crosshair lines are drawn by `CrosshairTool` through the generic `pointerHover`/`pointerLeave` hooks and the layered `draw(ctx, viewport, layer)` hook (`aboveTradingOverlays*` layers); every plugin is built from its `toolClass`. Tools see the bridge only through the read-only `MarketDataPort` (`features/bridge/marketDataPort.ts`), never `invoke` or execution commands. Chart indicators are plugins the same way: one folder per indicator under `features/indicators/` implementing `ChartIndicatorPlugin` (`features/indicators/chartIndicatorPlugin.ts`, built on the engine's `ChartIndicatorDefinition`/`ChartIndicator` in `features/chart/engine/indicators/indicatorContract.ts`), registered in `features/indicators/registry.ts` and handed to `ChartController` as `indicatorDefinitions`. An indicator turns bars into an `IndicatorFrame` (plots, levels, fills, per-bar values and colours, an optional precision) and never touches the chart; the engine's display layer (`features/chart/engine/indicators/`) draws any frame and never computes, so another producer can attach later. Bar-by-bar indicators extend `BarByBarIndicator`, which owns the load/update and forming-bar contract.

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
  choice, retries and reason to the `pnpm dev` terminal. The `request_tick_profile`
  command takes `rowsLayout` (`{ kind: 'rows', count }` with 1-128 rows, or
  `{ kind: 'ticksPerRow', ticks }` with 1-100000 ticks per row) and `valueAreaPercent`
  (an integer 1-100); the chart sends what the drawing's Inputs set (1 tick per row and 70%
  by default). A range needing more than 1000 rows is coarsened to the smallest
  whole-tick row height that fits, and `actualRows` reports the rows used.
  The drawing's settings dialog has Inputs (Rows Layout with Row Size or Ticks Per Row,
  Volume Up/Down, Total or Delta, Value Area Volume %, Extend Right) and Style (Up and Down
  Volume colours, POC/VAH/VAL lines, Width % of range, Placement Left or Right). Defaults
  paint the original look: down bars left and up bars right of the range start, solid POC,
  dashed VAH/VAL, lines to the pane's right edge. Rows layout and value area re-request the
  profile; everything else only repaints.
  The dialog hangs from a fixed offset below the window's top edge, shows one setting per row
  (label left, control right), and uses an app-styled drop-down instead of the native select.
  A style's colour (and a line's thickness and line style) is edited in one colour picker
  popover; colours are stored as `#rrggbb`, or `#rrggbbaa` when not fully opaque.
- The last chart window survives an app restart: on connect the app reopens the symbol and timeframe saved for the same login and broker server, and only when the broker still lists that symbol and serves that timeframe; another account, or a symbol the broker no longer lists, keeps the session default.
- Tick intervals: the interval selector offers `1T`, `10T`, `100T` and `1000T`
  before the MT5 timeframes (a "Ticks" section, listed first in the menu as
  TradingView lists them), and a tick interval can be starred and is restored like
  any other interval. The codes are frontend-only and never reach the EA. The
  chart's bars for one are built in the frontend from the chart symbol's raw ticks:
  they are read backwards from the newest instant the bridge reported through the
  read-only `request_indicator_ticks` route under the key `chart-ticks`, one page of
  the negotiated tick bound at a time, until 500 bars are built or the
  1,000,000-tick budget is spent, then drawn exactly as an accepted MT5 window is.
  Every quote for the chart symbol adds a tick (bid, else last) to the forming bar,
  and the tick after a bar's N-th opens the next one. Quote updates are sampled, not
  lossless: a forming bar holds the ticks that reached the app, not every tick the
  broker saw. A tick bar has no fixed length, so the bar countdown and the legend's
  previous-day close are off on tick intervals, and windows, live bars and pages of
  MT5 timeframes never replace the tick bars while one is shown. Switching back to
  an MT5 timeframe requests its history as before, and a symbol switch while a tick
  interval is shown reads the new symbol's ticks: the window that moves the bridge to
  the new symbol is requested on the last MT5 timeframe and its candles are dropped.
  A session that starts over (a disconnect, or another account) returns to the
  bridge's own window.
- A tick interval reads time to the second: the time axis shows `HH:MM:SS` (the
  library is asked to show seconds only while a tick interval is drawn, and in
  broker time the axis writes its marks as the broker's own wall clock rather than
  in the zone the library would read them in), and the crosshair's time label reads
  the second the bar opened in, while every MT5 timeframe keeps the minute labels it
  always had.
- Scrolling left past the oldest tick bar reads older ticks through the same
  `chart-ticks` route: one page of the negotiated bound for the range before the
  oldest tick held, joined to the oldest bar the chart already draws so no bar but
  the newest is short of the ticks its interval groups, then prepended through the
  chart's own older-history seam (`appendOlderHistory`), which re-anchors the pane
  as an MT5 page does. Ticks that do not yet fill a bar wait undrawn for the next
  page. The read stops at the 1,000,000-tick budget, and asks for nothing more: it
  hands the chart an empty, final page so the chart's paging latches the end of
  history and a scroll cannot start a request loop. There is no history-limit
  notice in the chart to reuse, so nothing is said on screen.
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
- Setup guide: three steps. "Find MetaTrader 5" lists the installations and data
  folders detection found (Windows, macOS's official app with its bundled Wine,
  Linux prefixes `~/.mt5` and `~/.wine`) and offers "Choose folder…", a native
  file picker for `terminal64.exe` that starts in the most likely MT5 folder and
  turns the picked file into an installation listed, installed into and
  restartable at once, without restarting Better Charts; its terminal path, Wine
  prefix and Wine binary are saved for the next launch. When detection found
  nothing, the step says so and points at "Choose folder…" or the manual steps.
  "Install" copies `BetterChartsTickHistoryReader.mq5` into `Indicators` and
  `BetterChartsBridge.mq5` into `Experts/Advisors`, leaves older copies elsewhere
  below `MQL5` untouched, and compiles both with MetaEditor, reporting per file;
  the UTF-16LE log decides, and an indicator with errors stops the run before the
  EA. "Connect" waits for the EA with a short checklist, names what to do after
  20 s without one, and points a token mismatch or an outdated component back at
  the install. The manual steps stay folded away under "Install manually instead",
  with the file download buttons and a "Copy token" button.
- The install offers "Install and restart MT5" and "Install only". A press
  installs and compiles both files; the restart button then closes MT5 and
  reopens it with the EA attached (the `Experts/Advisors` copy the install wrote,
  never an older copy left elsewhere), but only once every file compiled with 0
  errors and 0 warnings, so a run that needs fixing stops at its per-file rows. A
  clean run of either button moves the guide on to "Connect". The restart writes a
  temporary UTF-16LE
  `config/BetterChartsStartup.ini` below the install folder under Wine and below the
  MT5 data folder on native Windows (passed as an absolute `/config:` path; no
  symbol, so MT5 opens its own default chart) and a preset with the bridge token,
  host and port (`<MQL5>/Presets/BetterChartsStartup.set`), relaunches
  `terminal64.exe` (`/portable` for the portable layout) and deletes both files once
  the bridge connects, after 120 s, or at the next app start. It never enables Algo
  Trading, and is refused while an order is queued or in flight, without a token, or
  before the EA is installed.
- While no chart can be drawn — the bridge is unreachable or still without candles —
  a full-window blurred setup screen replaces the workspace until the setup is
  completed on this device: it names the missing MetaTrader 5 connection, keeps the
  notifications and the dialogs above it, and its "Open setup guide" button opens the
  guide at "Find MetaTrader 5". When the bridge connects while the guide is open, the
  guide closes (App settings too, when it sits beneath) and a full-window blurred
  "setup complete" screen takes over: a check mark and a "Happy trading" button enter
  with a short animation, and the button drops the screen and shows the chart. "Happy
  trading" also records the finished setup in localStorage
  (`better-charts.setup-completed`), so the setup screen never returns on later
  launches, connected or not. A compact header status then shows only while the bridge
  is away, after it has been away for 3 s: "MT5 not connected", "MT5 error", "Token
  mismatch" or "EA outdated", and pressing it opens the guide at "Install" for the two
  refusals and at "Connect" otherwise. A guide opened on an already connected bridge
  stays open. The chart's connection dot appears only once a chart is rendered, and the
  install section names the data folder in words ("Installs into MetaTrader 5." or
  a portable/user folder choice) instead of showing its path.
- A drawn chart whose bridge drops stays unchanged for 3 s, so a blip is invisible. From
  3 s the app's loader covers the chart ("Reconnecting to MetaTrader 5…"), and from 12 s
  (past the EA's longest 10 s retry gap) the loader gives way to the not-connected
  notice. The notice asks `get_mt5_backend_status` (`terminalProcess`: `running`,
  `not_running` or `unknown`; the command inspects off the main thread) once when it
  shows and every 5 s while it stays, and words itself after the answer: "MetaTrader 5 is
  not running.", "MetaTrader 5 is running, but the EA is not connected.", or, while
  unanswered, failed or `unknown`, "MetaTrader 5 is not connected."; no check is made
  before the notice shows. Connecting again removes both at once; a refusal or the setup
  flow on screen shows neither.
- On first launch no dialog opens by itself: the setup screen stands in for the
  chart (until the setup is completed) and its "Open setup guide" button leads on.
  That launch generates a random
  bridge token and saves it, so an EA already attached in MT5 cannot know it until
  the guide's install hands it over. The bridge, the environment exported at
  startup and the EA preset then share a token nobody had to invent.
- An outdated EA or tick reader sets `componentOutdated` on the bridge status; the
  error notice offers "Update in MT5", which opens the setup guide at its Install
  step. A token
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

Not implemented: break even or multiple charts.

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
  A press selects the profile on a handle, between the handles, on the painted
  histogram bars (including the part outside the range, e.g. the down bars left of
  the start line) and on the painted value labels column; with no profile painted
  (previewing, no bins) only the handles and the band select it.
- Price scale fits on load, then holds until rescaled; axis hover exposes `A`/`L`.
  Every pane has its own `A`/`L` at the foot of its own axis, and the price
  pane's row sits above the indicator panes: the price pane's `L` is the saved
  scale type, while an indicator pane's choices are not saved and last until
  the chart is reloaded. The first history request covers only the visible pane
  (`initialHistoryBars` in `config/bridge.json`; the UI measures the pane), then
  one older page is prefetched when idle. A reconnect of the same terminal and
  account reopens the symbol and timeframe the user was viewing (the bridge
  requests them itself); if they cannot be served, the EA's chart symbol is
  shown with a notice, and another account starts from the chart symbol.
  History paging
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
  avoid overlap/axis-width shifts; timeframe buttons share one 44 px width, and
  a shown tick interval's longer label (`1000T`) widens the whole row together.
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

## Chart settings

Every chart has a chart id and belongs to a chart group (groups will become tabs of
several charts). Today the app shows one chart, created once in `better-charts.sqlite3`
and reused on every launch. A chart uses a template; today there is one, Default, whose
values are the built-in ones (today's candle colours, the exchange time zone).

What a chart shows is the template, then the chart's own overrides for the account and
symbol it shows. Overrides store only the fields the user changed, so a later template
change still reaches untouched fields; a new chart has no overrides.

Settings are kept per bar type. Each bar type declares its own fields (checkbox, checkbox
with up/down colours, colour pair, colour, line width, choice, percent), so a new bar type
adds only its declaration. The type a chart draws is chosen from the button beside the
timeframes in the chart header and saved with the chart's settings, so it comes back for
the account and symbol it was chosen on. All twelve types are offered: Bars, Candles,
Hollow candles, Volume candles, Line, Line with markers, Step line, Area, Baseline,
Columns, High-low and Heikin Ashi. The candle series stays the anchor the price tags, the
countdown, the pointer readout and the drawings use, while a second series draws every
other type; Heikin Ashi is computed from the MT5 bars, and Baseline's base level is a
share of the visible price range. The legend and the price tags keep showing the real MT5
prices. These twelve are the standard types; the bar style menu offers four chart types
beside them: Renko, Line break, Kagi and Point & figure. While one of them is chosen the
chart's bars are the bricks, lines or columns computed in Rust from the broker's bars
(the `trading-core` `chart_types` module and Tauri command `compute_chart_type_bars`),
so the time axis, the legend, the drawings and the indicators run on them, with
synthetic times at least a second apart, second-precision time labels and no bar
countdown, as on tick charts, and a live update is asked for again at most every 250 ms.
Their settings and defaults are Renko's box by ATR 14, fixed or percentage of the last
price with wicks on, Line break's 3 lines, Kagi's reversal by ATR 14, fixed or percentage
with the yang and yin colours and widths, and Point & figure's high/low or close source,
box by ATR 14, fixed or percentage, and reversal 3. An ATR amount is the Wilder ATR at
the last bar and a percentage amount that share of the last close, each rounded to one
significant figure.

The host reads a footprint for the chart's own bars when the chart asks
(`set_chart_footprint`, with a manual ticks-per-row or the automatic row size, value area
and imbalance percentages validated at the boundary) and publishes `chart-footprint` for
every bar whose whole range the tick read covered — complete bars only, oldest first, with
the bars it stopped inside named apart in `incomplete` and `incompleteBefore` — and
`chart-footprint-forming` after each whole re-read of the forming bar, `null` while it
holds none. The automatic row size is `0.2 × ATR(atrLength) / tick size` in the symbol's
ticks, resolved once per enable and per window load and documented as an approximation of
the charting platform's undocumented normalization. Prices and volumes in both events are
decimal strings, the way the wire carries them, and each row also carries its buy and sell
trade counts, and each bar its totals. The reads reuse the indicator-ticks route under the
reserved keys `chart-footprint` and `chart-footprint-live`, so a connected EA needs no
change. Nothing is published while the footprint is off, and a chart that has not asked for
one reads no tick.

The `Volume footprint` bar style draws these rows. Its Symbol settings choose the row size
(Auto with an ATR length, or Manual ticks per row), the display (Cluster, or Profile with
cell widths proportional to their value), the type (Buy and Sell, Bid × Ask, Delta, Total
or Ladder), the values (Volume or Trade count), the four-shade gradient of each side, the
value area and its percentage, the imbalance percentage and highlight colours, stacked
levels, POC and the summary. Changing the row size, value area or imbalance percentage
sends a new request; the rest only redraws. The point of control and value area always
come from the host's volume rows, even in Trade count mode. Entering the style zooms to
120 px per bar and leaving it restores the previous spacing. A cell writes its number only
when the measured text fits. Stacked levels mark every run of at least N consecutive rows
imbalanced on one side as a band reaching right until a later bar's range touches it. The
legend warns about the bars before the first complete read.

The time zone is one of these settings: the footer clock and the dialog edit the same
value. The old per-symbol saved time zones were not carried over.

The Settings dialog opens from the chart's right-click menu ("Settings", after a divider
below "Reset chart view") and from the gear in the chart's bottom-right corner. It has a
Symbol tab whose section follows the current bar type, plus Timezone. Every edit shows on
the chart at once; OK saves the overrides; Cancel, × and Escape restore what the chart
showed when the dialog opened.

## Chart drawings

Drawings belong to one chart (its chart id) and the account and symbol it shows, and are
kept by the Rust side in the local
SQLite database `better-charts.sqlite3` (under the app data folder): one list per chart,
account and symbol, loaded when that window opens and saved again on every committed
change. A record holds only vector data — the shared fields (id, tool id, lock,
visibility, settings) plus the ordered anchor points a tool placed, each a time, a
price, or both, with prices kept as decimal text. No candle, tick or profile data is
stored; a tool asks for what it paints from the chart again. An unreadable list is
reported and never overwritten by the empty chart.

Pressing a drawing selects it (the drawing is highlighted), and a floating toolbar
appears over the chart: a drag grip that moves the toolbar inside the chart frame,
Settings, Lock/Unlock, Hide/Show and Remove. Lock makes the drawing ignore edit
gestures, and Delete/Backspace removes the selected drawing even while it is locked. The
toolbar is built once against the shared drawing interface (`ChartDrawings`, the selection
it reports, and each tool's declarations), so every tool that places drawings gets it
without its own code; the Arrow and Crosshair pointers place no drawings and therefore
never show it.

Settings are the tool's typed inputs (`int`, `float`, `bool`,
`string`, `textArea`, `color`, `source`, `timeframe`, `symbol`, `session`, `price`,
`time`, `enum`), rendered generically from the definitions a tool declares, one control
per kind, grouped in fieldsets as the definitions ask, and OK stays disabled while a
value fails its kind's rule. The Fixed Range Volume Profile declares its inputs and styles
(see above), so its dialog opens on the Inputs and Style tabs. Inputs and Style edits show on the drawing as
they are made (after a short pause) and are saved only on OK; every other way out restores the settings the
dialog opened with. A hidden drawing keeps its stored `visible` flag and is neither
painted nor hit; the toolbar's Hide/Show button sets that flag.

A strip down the chart's right edge holds the Trade panel and Object tree buttons, and the far
right of the chart header holds a Settings button that opens the chart's settings dialog: one
drawer is open at a time, and the chart shrinks beside the open drawer instead of sitting
under it. The Object tree lists every drawing of the account and symbol, topmost first,
the way TradingView lists its objects. A click on a row selects that drawing on the chart,
hovering a row reveals Settings, Lock, Hide/Show and Remove buttons (the floating
toolbar's order), a double click or the Settings button opens the drawing's settings dialog, and Delete or Backspace removes the drawing of the focused row.
Arrow keys walk the rows. The price bars have a row of their own (the chart's symbol and
timeframe, e.g. "EURUSD, 1H", with a candlestick icon) at their place in the stacking order,
and a hover shows its one button, Hide/Show price bars. Hiding stops the chart drawing the
bars of its main series — the candles, bars or line the bar type chooses, and the last price
they label — while the drawings and indicators stay; the row then keeps its crossed eye in
sight and its dimmed name. The choice is saved per chart, account and symbol among the chart's
settings overrides, so the chart opens hidden again. Any row, the bars row included, drags
with the mouse or moves with Alt+ArrowUp / Alt+ArrowDown to change the order: the top row
paints on top, a drawing listed below the bars row paints under the candles, and a price-pane
indicator listed above the bars row paints over the candles while one listed under it paints
under them. The order and each drawing's side of the bars are saved. A locked or hidden drawing
keeps its toggle in sight, and a hidden row's name is dimmed while the row stays listed and
clickable. The dialog is the same one the floating toolbar opens, held by one provider above the
chart and the tree. The tree keeps no data window and no toolbar of its own (owner decision).

## Chart indicators

The Indicators button beside the bar-type control opens a dialog titled "Indicators" with a
search field (a case-insensitive part of the name or short name) and the list of indicator
names; choosing one, or Enter for the first match, attaches it with its defaults and closes
the dialog. TradingView's tabs and categories are left out (owner decision). The list is kept
alphabetical by title and holds Bollinger Bands (BB 20 close 2: basis, upper and lower, with
the band between them filled), MACD (MACD 12 26 close 9: a histogram coloured by sign and by
whether it grew, the MACD and signal lines and a zero line), Moving Average Exponential (EMA 9
close), Moving Average Simple (SMA 9 close), Relative Strength Index (RSI 14 close, with
dashed 70 and 30 bands, a dotted 50 band and the background between 70 and 30) and Volume
(Vol, or Vol SMA 20 while its MA line is on: the bar's tick volume in columns coloured by
whether the bar closed at or above its open, with a Volume MA line, SMA or EMA, that is off
until switched on in the Style tab).
The chart no longer draws volume by itself; volume shows through the Volume indicator.
SMA, EMA and Bollinger Bands draw on the price pane; RSI, MACD and Volume each get a pane of their own under
it, about a ninth of the height, which closes when the indicator is removed. A pane resized by
dragging its separator keeps that height, relative to the price pane, with the saved indicator,
and the chart restores it on load. Every value is computed in the frontend from the bars the chart
draws, or from another timeframe read from the bridge, as Pine's `ta.sma`, `ta.stdev`, `ta.rsi` and
`ta.ema` compute them; a live tick redraws only the forming bar and never moves an indicator's state.
Indicator values are display-only and never reach order, account or journal data.

Every indicator carries a Calculation section after its own inputs: the timeframe it is calculated
on, and whether a chart bar waits for that timeframe to close. Chart, the default, calculates on the
bars the chart draws, a tick chart's N-tick bars included; every MT5 timeframe can be chosen, above or
below the chart's, and so can the four tick timeframes (1, 10, 100 and 1000 ticks). A timeframe whose
bars are shorter than a tick chart's own cannot be calculated on: every MT5 timeframe counts as longer
than any tick interval, and the tick choices that group no more ticks than the chart's own bars are
listed but disabled, with the reason. Another timeframe's candles are read through the
read-only `request_indicator_series` route, keyed per indicator, so a lower timeframe is possible at
all (an M5 chart reading M1) and a higher one gets the full depth a series grouped from the chart's
own bars cannot reach. Indicators of one chart that read the same timeframe share one read and its
candles, kept in memory until the chart's symbol or timeframe changes. A read can name another symbol
than the chart's when the connected EA negotiates `other_symbol_series`, and such a read asks for that
symbol's newest two candles once per closed bar of its timeframe, never on a tick. A higher timeframe's
newest candles are projected onto the chart's bars as grouped bars were; after that first read nothing
more is asked: its
forming bar and every bar that closes are grouped from the chart's own bars, which are the broker's. A
lower timeframe's candles are paged back over the chart's loaded range, and a chart bar shows the last lower
bar inside it; the forming lower bar is built from the chart's live bars, and a lower bar that closes asks
once for the newest two candles, so the broker's own candle replaces the one built from quotes. A tick timeframe reads
the chart symbol's raw ticks through the read-only `request_indicator_ticks` route, also keyed per
indicator, and builds a bar out of every group of N ticks: the first open, the highest high, the
lowest low, the last close and the number of ticks as its volume. The tick price is the tick's bid.
Ticks cover only a recent window, as on TradingView: the read asks for its newest window of the chart's
range and walks back, a window at a time, until it reaches the oldest loaded chart bar or spends its
200,000-tick budget, so chart bars older than the fetched ticks show no value. Each chart bar shows the
last N-tick bar whose final tick arrived inside it, and waiting for closes is on by default: a chart
bar then keeps the last N-tick bar that has all its ticks and ignores the forming one. A closed chart
bar reads only the ticks after the newest one held, and a live tick reads nothing. The wait switch keeps its
meaning on every timeframe: a chart bar keeps the last closed higher-timeframe value, and a lower
timeframe's forming chart bar keeps the last closed lower bar's. A series or a tick window the bridge
cannot read leaves the last good values on screen, retries nothing and shows no notice of its own;
until the first page arrives a higher timeframe still groups the chart's own bars, so nothing flickers
empty.

Volume's Style tab offers one Plot type icon button, on the Growing row beside its colour, which
opens a menu holding the Current value line switch and the eleven ways to draw the plot. Columns, the
default, draws the columns an attached Volume showed before the choice existed. The other choices
are Line, Line with breaks, Step line, Step line with breaks, Step line with diamonds, Histogram,
Cross, Area, Area with breaks and Circles; a type with breaks differs from its plain one only
where a plot has a missing value, which Volume never has. Current value line draws the horizontal
line at the last volume and is off by default. A bar that has just opened does not lower Volume's
scale, and the columns stand on the pane's foot.

Attached indicators are saved per chart, account and symbol in the chart's settings overrides
(id, indicator id, the settings the user changed, and `hidden: true` while hidden), so they
come back when that chart opens. A price-pane indicator also saves `belowBars: true` while the
object tree lists it under the price bars, and every document saved without that field keeps it
over the candles, where the chart has always painted it. An entry that does not read is dropped,
and one this build does not know stays saved and draws nothing.

The OHLC line writes the four values of the bar under the pointer, or of the last bar while the
pointer is off the chart or over no bar, in that bar's body colour as it is drawn, following the
bar style and its up and down colours; a style without them (Line, Line with markers, Step line,
Area, Baseline, High-low) keeps the label colour.

The chart settings dialog's Status line tab switches the title (name, symbol or both), the market
status dot, the chart values, the bar change against the previous close, the bar's tick volume,
the last day change, and the indicator titles, inputs and values, and draws a background behind
them. The last day change is the last price against the close of the newest loaded bar on an
earlier broker day, so it is not shown on timeframes above one day or while no earlier day is
loaded.

Under the OHLC line the legend lists one row per price-pane indicator: its short title, its input
values and each plot's value at the crosshair bar, or at the last bar while the pointer is off the
chart (e.g. "SMA 9 close 1.08520"); oscillators write two decimals. An indicator with a pane of
its own shows the same row at the top-left of that pane instead. A hovered row offers Hide/Show,
Settings, Remove and More ("…") buttons, and a double click on its title opens the settings. The
More button, and a right press on the indicator's Object tree row, open one actions menu at that
point: Visual order, whose submenu brings a price-pane indicator to the front, forwards it, sends it
backward or to the back of its pane's paint order, the commands that would leave the order as it is
greyed out (all four, with a title saying why, for an indicator with a pane of its own); Visibility
on intervals, which opens the settings dialog on its Visibility tab; Hide or Show; Remove, which
names the Del key that removes the selected indicator; then Object tree, which opens the tree's
drawer, in a section of its own, offered by the legend's menu only; and Settings. Every row starts
with the same icon column: Visual order, Hide or Show, Remove and Settings draw one there, and the
rows without one keep their words in line. The menu answers the keyboard the way a menu does: its
arrow keys, Home and End walk its rows, Left and Right move between it and its submenu,
Enter runs a row, and Escape closes it and gives the focus back to the More button or the row name;
a press outside it closes it. A hidden indicator's row is dimmed, and a chevron collapses the
price-pane rows to their count ("˅ 2"). The selected indicator's row keeps its buttons in sight and
is framed the way a hovered row is, without the pointer resting on it.
Each indicator pane draws its own top border, which stops at the price axis; the library's pane
separator and its hover band, which would cross the axis, are transparent, and a band of the
pane's width shows while the line between the panes is hovered or dragged.

The Indicators dialog sits at a fixed offset from the top of the window, like the settings
dialogs.

The Object tree groups its rows by chart pane, as TradingView's object tree does: a divider
separates the groups, which carry no visible heading. The first group holds every row of the price
pane in one list, topmost first: the drawings, the price-pane indicators by their legend names and
the price bars among them, so the bars row marks where the candles stand; then comes one group per
indicator with a pane of its own (RSI, MACD, Volume), in the order those panes stand under the
price pane, each holding that indicator's row. A row's buttons open the indicator's settings, hide
or show it and remove it, and a double click or Delete on its name does the same as in a drawing
row. A right press on a row opens the indicator's actions menu at the pointer, the menu the
legend row's More button opens less its Object tree row, which would point back at the drawer the
row is already in, and Escape closes it and gives the focus back to the row's name.
The price-pane rows keep the saved order, the top one painting over the ones under it: a drag, or
Alt+ArrowUp / Alt+ArrowDown on a focused row, moves one row among its pane's rows, keeps the focus
on it, saves the new order and repaints the chart in it, so a reload keeps the order. A row crossed
over the bars row paints over the candles and one crossed under it paints under them: a drag of the
bars row onto an indicator row, or Alt+Arrow on either of them, moves the two past each other, and
the chart paints the price-pane indicators the rows list over the bars row over the candles and the
rest under them. The actions menu's four paint-order commands move an indicator to the first, the
last or the row beside it among those rows and save the same order. Own-pane groups keep their
order, and a row of a pane of its own never crosses the price bars or leaves its group.
A click on a row selects that indicator, and so does a click on its plotted lines, markers or
columns: within 4 CSS pixels of the ink a plot draws in the pane it draws in. Either way the row is
highlighted like a selected drawing row, the chart frames its legend row with its buttons in sight,
and every plot of it shows a selection handle on every 10th visible bar and at the last bar: a
hollow ring 9 CSS pixels across, stroked 1.5 CSS pixels in the selection blue and filled with the
pane background, so the line it marks does not show through it. The pointer over a plotted line shows the pointer cursor; a
click on a drawing picks the drawing even where a plot line crosses it.
Delete or Backspace removes the selected indicator while the focus is not in a text field, and
Escape, a click on empty chart space or a drawing's own selection clears it; selecting one clears the
other, so the chart holds one selection at a time.
The settings dialog is the drawing settings form with the indicator's Inputs and Style tabs;
OK stays disabled while a value is invalid and recomputes the indicator. Its Inputs and Style edits
show on the chart as they are made, after a short pause, and are stored only on OK; Cancel, the
close button, Escape and a backdrop click put the stored settings back. A plot or band switched off
in the Style tab hides only that line. Its Style tab ends with three display switches: Labels on
price scale, off by default (each visible plot's last value on the price scale), Values in status
line (the plot values in the legend row), and Inputs in status line (the inputs after the short
title there; the Object tree name keeps them either way), with the last two on by default. The
settings dialog also has the drawings' Visibility tab: an indicator limited to some timeframes is
not attached on the others, so its line, legend row and pane leave and come back with the
timeframe; the Object tree keeps listing it.

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
inspection on every platform. Saved settings apply at once: the trading
permission takes effect immediately (turning it off refuses new submissions and
drops unsent queued orders; an in-flight order finishes); a new bridge address,
token or maximum frame size restarts the bridge listener so the EA reconnects,
and the save is refused while an order is queued or in flight; MT5 paths apply
at once; MT5 auto-start runs only at launch. Precedence:
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
