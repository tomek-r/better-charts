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
| `InpBridgeMaxTicksPerPage` | `65535` | Negotiated tick-page limit |

Allow only the local endpoint in MT5's Expert Advisor settings. DLL imports
are unnecessary. Start the desktop listener before attaching the EA; attach
one bridge EA and do not manually add the tick reader to a chart.

Trading permissions are observed during the handshake. Reattach the EA after
changing them. Risk preview, OrderCheck and reconciliation are read-only;
submit/modify/close/cancel can execute trades. Commands are session-bound,
journaled and sequential, with no automatic retries. See the
[protocol contract](../../docs/protocol/bridge-v1.md).

EA version `1.002` includes account-currency TP/SL amounts in live portfolio
snapshots, calculated with read-only `OrderCalcProfit` at actual entry and volume.
Recompile and reattach the EA after updating both the app and bridge.

The legacy EA journal filename `TradeCanvasBridge.commands.log` is retained
for recovery compatibility. Preserve it when upgrading and replace the old EA
rather than running two bridges. Temporary tick-reader files under
`MQL5/Files/TradeCanvasTicks` are removed after use.

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
