# MT5 bridge

[BetterChartsBridge.mq5](Experts/BetterChartsBridge.mq5) is the TCP client and
only component that calls the MT5 trading API.
[BetterChartsTickHistoryReader.mq5](Indicators/BetterChartsTickHistoryReader.mq5)
is a hidden helper for tick-history synchronization. Both require compilation
in MetaEditor with 0 errors and 0 warnings. Follow the
[connection instructions](../../README.md#connect-to-metatrader-5).

## EA inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `InpBridgeHost` | `127.0.0.1` | Local desktop listener |
| `InpBridgePort` | `8765` | Listener port |
| `InpBridgeToken` | Empty | Must match the app's private token |
| `InpBridgeMaxFrameMiB` | `8` | Negotiated frame budget |
| `InpBridgeMaxTicksPerPage` | `262144` | Negotiated tick-page limit |

Allow only the local endpoint in MT5's Expert Advisor settings. DLL imports
are unnecessary. Start the desktop listener before attaching the EA; attach
one bridge EA and do not manually add the tick reader to a chart.

Trading permissions are observed during the handshake. Reattach the EA after
changing them. Risk preview, OrderCheck and reconciliation are read-only;
submit/modify/close/cancel can execute trades. Commands are session-bound,
journaled and sequential, with no automatic retries. See the
[protocol contract](../../docs/protocol/bridge-v1.md).

EA version `1.011` ends the reconcile history window 60 s past the server clock (the later of `TimeTradeServer()` and `TimeCurrent()`), so a deal booked after the last quote is no longer left out of a snapshot that reports `complete=true`. It also holds older-history pages that arrive while the initial history waits for series synchronization (they are served after it, or fail with their own correlated error when it times out) instead of answering them with an empty page, and answers a window history request for a symbol the terminal does not have with the correlated history error (envelope `id` = request id, message `symbol not available`) instead of an uncorrelated `INVALID_MESSAGE` that ended the session. `1.010` adds `account_equity` (`ACCOUNT_EQUITY`) to OrderCheck results; the margin projection uses it instead of the check result's own `equity`, which MT5 leaves at 0 when the check was not evaluated (for example retcode 10027). `1.008` reconnects (`trading permission changed`) when the MT5 trading permission (for example the Algo Trading button) differs from the value advertised in the hello, so the app learns the current `trading_enabled` without a restart; the new session still needs the handshake and complete reconciliation. `1.007` adds the margin projection inputs (`margin_at_fill`, `account_margin_used`, `account_free_margin` on OrderCheck results) and the account margin-call and stop-out levels. `1.006` reconnects cleanly when the MT5 account changes: the identity check now runs before any account-stamped frame (heartbeat, portfolio snapshot), not only before account snapshots. `1.005` speeds up exact tick price aggregation (integer price keys). `1.004` added partial close (negotiated `partial_close` capability) and
per-position `volume_min`/`volume_step`. It also includes account-currency TP/SL amounts in live portfolio
snapshots, calculated with read-only `OrderCalcProfit` at actual entry and volume,
and reports the installed tick reader version in the handshake.
Recompile and reattach the EA after updating both the app and bridge.

The EA (`BetterChartsBridge`) and the indicator (`BetterChartsTickHistoryReader`,
version `1.001`) are versioned independently; the app requires the exact
versions listed in `config/mq5-versions.json` and refuses to connect otherwise.
Compile both from `MQL5/Experts` and `MQL5/Indicators`, then reattach the EA.
Before each connect the EA briefly probes the reader (up to 3 s); a missing or
outdated indicator is reported in the app.

The legacy EA journal filename `TradeCanvasBridge.commands.log` is retained
for recovery compatibility. Preserve it when upgrading and replace the old EA
rather than running two bridges. Temporary tick-reader files under
`MQL5/Files/TradeCanvasTicks` are removed after use.

While the EA aggregates a price-count tick page that is not the last one, it
starts one prefetch reader for the next page (`from = through_ms`, same count).
A matching next request adopts it (logged as `prefetch=hit`); any other
request, a disconnect, a failure or 30 s without a request discards it and
deletes its files.

## Optional MT5 startup

Auto-start is disabled by default. Enable it in the desktop's **MT5 startup**
settings and supply the installation paths: a native executable on Windows,
or a Wine executable path, prefix and binary on macOS/Linux. An optional
configuration file is passed as `/config:`. Restart the app to apply changes.

Auto-start does not install or attach the EA. An active bridge, an already
running terminal or an unknown process state suppresses startup. Paths and
startup configuration are never inferred from the checkout.

## Environment overrides

Use a private `.env` based on [`.env.example`](../../.env.example), or process
environment variables. Precedence is process environment, then the first `.env`
found in the user-data folder, executable folder or working directory, then
saved settings. Only `MT5_` keys are loaded; files are not merged.

| Variable | Default / purpose |
| --- | --- |
| `MT5_BRIDGE_TOKEN` | Private token; required in release builds |
| `MT5_BRIDGE_ADDR` | `127.0.0.1:8765`; loopback only |
| `MT5_BRIDGE_TRADING_ENABLED` | `false`; app trading permission |
| `MT5_BRIDGE_MAX_FRAME_BYTES` | `8388608`; negotiated byte budget |
| `MT5_BACKEND_ENABLED` | `false`; MT5 auto-start |
| `MT5_TERMINAL_EXE` | Explicit executable path |
| `MT5_WINE_PREFIX` | Required for auto-start on macOS/Linux |
| `MT5_WINE_BINARY` | `wine` from `PATH` |
| `MT5_BACKEND_INI` | Optional startup configuration |

Boolean values accept `1/true/yes/on` and `0/false/no/off`. Wine settings are
ignored on Windows. Overrides are shown in app settings; change them at their
source and restart. Invalid configuration disables trading and auto-start.
Keep `.env`, saved settings, startup files, journals and logs private.

The EA advertises all 21 standard MT5 timeframes during the handshake. Recompile
and reattach the EA after updating to expose the full list in Better Charts.
Older EAs without the advertisement cannot connect; update both the EA and app. Monthly history comes
from MT5's `PERIOD_MN1`, with calendar month boundaries in the chart.
