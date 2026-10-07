# Bridge Protocol v1

The local TCP contract between `BetterChartsBridge` (MT5 EA/client) and the
Rust desktop backend (server). This reference describes current wire behavior;
all examples below the envelope show **payloads only**. Rust models and
validation live in [`protocol`](../../crates/trading-core/src/protocol/mod.rs).

## Transport and envelope

- Default endpoint: `127.0.0.1:8765`; the server accepts loopback addresses only.
- Frame: **4-byte unsigned big-endian length + UTF-8 JSON**. Length excludes
  the header. Handle fragmented headers/payloads and coalesced frames.
- Payload length is `1..=1 MiB` before negotiation. After the handshake, use
  the negotiated byte limit. Empty or oversized frames are protocol errors.
- Decimal prices, volumes, and money are strings; integer counters and
  timestamps are JSON numbers. Timestamps are Unix milliseconds; volume is
  MT5 lots. UI units are `lots × contract_size`.
- Identity fields use nonempty trimmed strings, bounded to 128 UTF-8 bytes
  where validated. Free-text messages/comments are bounded to 256 characters.
- Unknown fields are ignored; unknown message types and missing required
  fields are rejected. Preserve optional-field defaults and `null` semantics.

```json
{
  "v": 1,
  "type": "heartbeat",
  "id": "ea-42",
  "session_id": "opaque-session-id",
  "sent_at_ms": 1770000000000,
  "payload": {"sequence": 1, "terminal_connected": true,
    "account_connected": true, "broker_server": "Broker-Demo",
    "market_session": {"symbol": "NAS100", "is_open": true, "trade_mode": 4,
      "server_time_ms": 1770000000000}}
}
```

`v` is always `1`; `id` identifies a message within the connection (correlated
tick errors reuse the request ID). `session_id` is `null` for `hello` and
pre-session errors, then the value assigned by Rust. Message IDs correlate
requests; persistent trading identity uses `command_id`.

## Handshake and heartbeat

The EA sends `hello` first, within 3 seconds of connecting. Rust validates the
version/token, binds the session to the account and broker, and returns
`hello_ack`. Invalid authentication/version closes the connection. A valid new
connection replaces the active session; account or broker changes require
reconnection. Tokens must never appear in logs or errors; a nonempty expected
token is required outside development builds.

**`hello` payload:**

```json
{
  "token": "example-token", "terminal_id": "installation-instance-id", "terminal_build": 5000,
  "account_login": "12345678", "broker_server": "Broker-Demo", "chart_symbol": "NAS100",
  "expert_version": "1.002", "trading_enabled": false,
  "transfer_limits": {"max_frame_bytes": 8388608, "max_ticks_per_page": 65535},
  "tick_price_counts": true,
  "supported_timeframes": ["M1", "M2", "M3", "M4", "M5", "M6", "M10", "M12", "M15", "M20", "M30",
    "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"]
}
```

**`hello_ack` payload:**

```json
{
  "heartbeat_interval_ms": 2000, "heartbeat_timeout_ms": 6000, "trading_enabled": false,
  "transfer_limits": {"max_frame_bytes": 8388608, "max_ticks_per_page": 65535},
  "tick_price_counts": true
}
```

The EA's `hello.trading_enabled` is a permission snapshot: MT5 must be connected
with a nonzero account login, and terminal Algo Trading, EA trading, account
trading, and account expert trading must all be allowed. The EA rechecks these
permissions before accepting and dispatching commands. After enabling trading,
reattach the EA to refresh the handshake. `hello_ack.trading_enabled` advertises
the server's permission; the app's local Settings permission is an additional
startup restriction, optionally overridden with `MT5_BRIDGE_TRADING_ENABLED`.
Neither flag submits a command or bypasses execution gates.

The app requires an exact EA `expert_version` match (`1.002` for this build).
The expected version lives in `config/bridge.json`; a regression guard checks
that the EA's `BRIDGE_EXPERT_VERSION` matches it. The EA uses that same macro
for its MT5 display version (`#property version`) and the handshake. Versions use
MT5's two-part numeric format (for example, `1.001`); this is independent of the
desktop app version. The version is checked before the full handshake schema so an older EA missing new fields
still reports the required and installed versions, with update instructions.
Missing or malformed versions are rejected without echoing arbitrary values.
Other malformed handshakes include recompile/reattach instructions.

### Negotiated capabilities

| Capability | Rule |
| --- | --- |
| `transfer_limits` | Negotiate each limit as the minimum of both peers' values; apply only after `hello_ack`. |
| Missing `transfer_limits` | Use 1 MiB / 5,000 ticks per page. |
| Current defaults | 8 MiB / 65,535 ticks per page. |
| Valid limits | Rust frame bytes: `1024..=2147483643`; EA frame MiB: `1..=2047`; ticks: `1..=65535`. Invalid limits reject the handshake. The frame bounds, the 8 MiB default and the `1..=1000` history page live once in `config/bridge.json`, embedded by `crates/trading-core/src/protocol/limits.rs` and imported by `apps/desktop/src/shared/bridge/limits.ts`. |
| `tick_price_counts` | Defaults to `false`; exact price summaries require support from both peers. Raw tick pages remain supported. |
| `hello.supported_timeframes` | Required list of the EA's supported MT5 period codes. Must be a nonempty, unique subset of the standard periods and include `M1`. Missing, `null` or invalid advertisements reject the handshake. Published as `supportedTimeframes` on the Tauri bridge status; history commands reject periods the connected EA did not advertise. |

Rust frame configuration uses Settings or the `MT5_BRIDGE_MAX_FRAME_BYTES`
override; EA inputs are
`InpBridgeMaxFrameMiB` and `InpBridgeMaxTicksPerPage`. Large frames must not be
sent before acknowledgement.

`heartbeat` contains `sequence`, `terminal_connected`, `account_connected`,
`broker_server`, and the optional `market_session` observation described below.
`heartbeat_ack` contains the same `sequence`. The interval is 2 seconds and
timeout is 6 seconds. Heartbeats check transport liveness;
market/account/portfolio publication runs independently. Reconnect delays are
1, 2, 4, 8, then 10 seconds; a successful handshake resets backoff.
If the desktop cannot bind the local bridge port, it also retries at
1, 2, 4, 8, then 10-second intervals. The connection indicator stays red with
the bind error while waiting, then changes to connecting once listening.
Only an accepted EA handshake makes it connected. Invalid address configuration
remains an error and requires correction.

### Market session

The EA evaluates the active symbol's broker trade session on every heartbeat
and reports it as an optional `market_session` object: `symbol`, `is_open`,
`trade_mode` (raw `ENUM_SYMBOL_TRADE_MODE`), and `server_time_ms` (broker server
time at which `is_open` was evaluated). The EA derives `is_open` from
`SymbolInfoSessionTrade` at `TimeTradeServer()` — checking the current weekday
and the previous weekday so an overnight session that started before midnight
still counts — and closes it when `SYMBOL_TRADE_MODE_DISABLED` is set. `null`
or an absent field means unknown.

Rust stores the latest observation and gates **order submission only**: a
submit is rejected unless the observation is present, names the order's symbol,
and reports `is_open: true`. Unknown, stale-after-session-end, or mismatched
observations fail closed. Modify, close, and cancel are not gated here — they
reduce or adjust existing exposure, and their targets are not bound to the
active chart symbol. The EA re-checks the session at dispatch, so a command
accepted moments before the close is rejected with `SESSION_CLOSED` rather than
executed (no retry). Holiday closures are only detected when the broker sets
`SYMBOL_TRADE_MODE_DISABLED`; the weekly schedule alone does not carry them.

## Market data and symbols

Requests and results are read-only. Latest selection/request wins: ignore
responses for stale request IDs, sessions, symbols, timeframes, or generations.

### Candles and quotes

After the handshake, Rust requests M1 history for `chart_symbol`. Supported
timeframes are the 21 standard [MT5 periods](https://www.mql5.com/en/docs/constants/chartconstants/enum_timeframes):
`M1`, `M2`, `M3`, `M4`, `M5`, `M6`, `M10`, `M12`, `M15`, `M20`, `M30`,
`H1`, `H2`, `H3`, `H4`, `H6`, `H8`, `H12`, `D1`, `W1`, `MN1`. The codes, their nominal bar lengths
and the default live once in `config/timeframes.json`, embedded by
`crates/trading-core/src/protocol/timeframes.rs` and imported by
`apps/desktop/src/shared/bridge/timeframes.ts`; `bars` is `1..=1000`.
The selector uses only the connected EA's advertisement. The EA and desktop
app must both be updated; EAs without the advertisement cannot connect. The EA derives advertised
codes from its MT5 `ENUM_TIMEFRAMES` values, which also drive history parsing.
`MN1` has MT5's nominal 30-day duration in configuration; chart padding,
bar interpolation, countdowns and monthly profile ends use calendar month
boundaries rather than treating every month as 30 days. Rebuild and reattach
the EA to enable the additional periods; history request payloads are unchanged.

**`history_request` payload:**

```json
{"symbol": "NAS100", "timeframe": "M1", "bars": 1000}
```

**`history_snapshot` payload:**

```json
{
  "request_id": "rust-history-1", "symbol": "NAS100", "timeframe": "M1", "complete": true,
  "candles": [
    {
      "time_ms": 1769999940000, "open": "25000.1", "high": "25002.4", "low": "24999.8",
      "close": "25001.7", "tick_volume": 183, "spread": 12, "real_volume": 0
    }
  ]
}
```

`request_id` echoes the request envelope's `id`; symbol/timeframe must match.
Candles are strictly ordered oldest first. `complete=false` means fewer candles
were available than requested. Invalid decimal prices reject the entire
snapshot; every response must fit the frame budget.

#### Older-history pages (additive extension)

Both payloads take an optional `before_ms` epoch-millisecond anchor. Absent is
the pre-extension behavior above — the newest `bars` — and the field is omitted
from the wire when absent, so old peers interoperate unchanged.

**`history_request` payload (page):**

```json
{"symbol": "NAS100", "timeframe": "M1", "bars": 1000, "before_ms": 1769999940000}
```

With `before_ms` present the EA answers the newest `bars` candles **strictly
older** than that anchor, in the same oldest-first order, and echoes the anchor
in `before_ms` on the snapshot. `bars` keeps its `1..=1000` bound. A page is
deliberately unlike the window request: it must not reset the EA's active feed
(the symbols, timeframes and last-bar anchors that drive `bar_update` and the
bar countdown), and the bridge publishes it on the `history-page` event instead
of `market-snapshot`, so a page of old candles never replaces the current market
snapshot.

`complete=false` on a page means the broker held no more candles older than the
anchor, which is how a client learns it reached the end of history. A peer that
predates the extension ignores `before_ms` and answers the window request
instead: the client sees nothing strictly older and stops paging.

`history-page` event payload (camelCase, as emitted to the frontend):

```json
{
  "symbol": "NAS100", "timeframe": "M1", "complete": false,
  "beforeMs": 1769999940000, "candles": [
    {
      "time_ms": 1769999880000, "open": "25000.1", "high": "25002.4", "low": "24999.8",
      "close": "25001.7", "tick_volume": 183, "spread": 12, "real_volume": 0
    }
  ]
}
```

`bar_update` contains `symbol`, `timeframe`, and one `candle` with the same
schema. The EA publishes changes to the active candle without resending
identical state. After history establishes the active feed, `quote_update`
publishes changed tick records:

**`quote_update` payload:**

```json
{
  "symbol": "NAS100", "time_ms": 1770000001490, "bid": "25001.6", "ask": "25001.8",
  "last": "25001.7", "volume": 12, "volume_real": "0", "flags": 6
}
```

Prices and `volume_real` are decimal strings; `volume` and `flags` are integer
MT5 values. Clear quote state on symbol/session changes; reject delayed data
for a different feed.

### Symbol search and metadata

| Message | Payload |
| --- | --- |
| `symbol_search_request` | `query` (trimmed, 1–64 characters), `limit` (`1..=50`). |
| `symbol_search_result` | `request_id`, exact `query`, `symbols` (unique symbols, at most requested limit). |
| `symbol_info_request` | `symbol`. Sent alongside history requests for the active symbol. |
| `symbol_info_result` | `request_id`, `symbol_info` (one record using the symbol schema below). |

**`symbol_search_result` payload:**

```json
{
  "request_id": "rust-symbols-1", "query": "nas",
  "symbols": [
    {
      "symbol": "NAS100", "description": "Nasdaq 100 CFD", "digits": 1, "tick_size": "0.1",
      "point_size": "0.1", "contract_size": "1", "volume_min": "0.01", "volume_max": "100",
      "volume_step": "0.01", "trade_mode": 4, "stops_level": 0, "freeze_level": 0,
      "filling_mode": 1, "order_mode": 127, "expiration_mode": 15, "trade_execution": 2
    }
  ]
}
```

`tick_size`, `point_size`, `contract_size`, and volume parameters are decimal
strings; positive parameters and valid volume bounds/step are validated.
Optional `tick_value_profit` and `tick_value_loss` are nonnegative decimal strings
per lot in `tick_value_currency`, the MT5 deposit currency. The EA estimates one
profitable/losing price tick with read-only `OrderCalcProfit` at a valid reference
volume. Up to six progressively wider probes avoid deposit-currency rounding to
zero; each result scales back to one lot/tick. Unavailable calculations emit both values as `null`;
older EAs may omit all three fields. Values provided require both amounts and a
nonempty currency. UI estimates use only values matching the current account
currency; they never substitute price distance × contract size as account money.
Cached tick conversion estimates are approximate; fresh risk quotes and OrderCheck
remain authoritative. No changes to dispatch or trading permissions are involved.
Restriction levels and mode masks are unsigned integers passed directly from
MT5. Selecting a symbol uses the same history feed; it does not create another
connection. Rust publishes active metadata as the camelCase `symbol-info`
Tauri event.

## Account and portfolio

Account identity must agree with the handshake. Permission flags and snapshots
are observations and do not enable execution by themselves.

**`account_snapshot` payload:**

```json
{
  "account_login": "12345678", "broker_server": "Broker-Demo", "currency": "USD",
  "balance": "10000.00", "equity": "9980.00", "margin": "500.00", "free_margin": "9480.00",
  "margin_level": "1996.00", "leverage": 100, "margin_mode": 0, "trade_allowed": true,
  "expert_allowed": true, "account_trade_mode": 0, "account_trade_mode_name": "demo"
}
```

The EA supplies the raw `account_trade_mode` and semantic name
`demo|contest|real|unknown`; absent fields default to `-1` / `unknown`.
`currency_digits` is the optional MT5 monetary precision (`0..=8`); absent defaults
to 2 for older EAs. Money inputs, budget rounding, account and chart labels use
the account currency and precision. Monetary displays use `amount CODE`, including
USD, EUR, PLN and broker-specific deposit currencies; there is no display conversion.
Account `margin` is nonnegative. `balance`, `equity`, `free_margin`, and
`margin_level` are signed decimal observations. Negative free margin does not
invalidate the snapshot or disconnect market data; it blocks automatic sizing.

**`portfolio_snapshot` payload:**

Positions and pending orders optionally include signed decimal strings
`stop_loss_profit` and `take_profit_profit`. The EA uses read-only `OrderCalcProfit`
with the actual open/resting price, volume and exit level, in account currency,
excluding commissions and swap. Unset exits or unavailable calculations are `null`;
older payloads may omit them. Live labels prefer these broker amounts and fall back
to converted tick estimates when absent. No order is sent by these calculations.

```json
{
  "account_login": "12345678", "captured_at_ms": 1770000001690,
  "positions": [
    {
      "position_id": "9001", "ticket": "9001", "symbol": "NAS100", "side": "buy",
      "volume": "0.10", "price_open": "25000.1", "price_current": "25001.7",
      "stop_loss": "24900.0", "take_profit": null, "profit": "16.00", "swap": "-0.10",
      "time_ms": 1770000000000, "magic": "42"
    }
  ],
  "orders": [
    {
      "order_id": "7001", "symbol": "NAS100", "order_type": "buy_limit", "state": "placed",
      "volume_initial": "0.10", "volume_current": "0.10", "price_open": "24900.0",
      "price_current": "24900.0", "stop_loss": null, "take_profit": "25100.0",
      "time_setup_ms": 1770000000100, "expiration_ms": null, "magic": "42"
    }
  ]
}
```

Account/portfolio checks run independently at 500/250 ms and after
`OnTradeTransaction`. Emit a snapshot only when stable state changes;
`captured_at_ms` alone does not trigger publication. Each category has at most
500 records with unique IDs. Position/order prices use instrument precision,
volumes use 8 decimal places, and monetary values use account currency
precision. SL, TP, and expiration may be `null`.

## Reconciliation

`reconcile_request` reads positions, active orders, and bounded broker history.
Its payload `request_id` is distinct from the envelope `id` and must be echoed.
History-order and history-deal limits are each `1..=1000`.

**`reconcile_request` payload:**

```json
{
  "request_id": "reconcile-1", "account_login": "12345678", "broker_server": "Broker-Demo",
  "history_from_ms": 1769900000000, "max_history_orders": 500, "max_history_deals": 1000
}
```

**`reconcile_snapshot` payload:**

```json
{
  "request_id": "reconcile-1", "account_login": "12345678", "broker_server": "Broker-Demo",
  "snapshot_id": "snapshot-42", "history_from_ms": 1769900000000,
  "history_to_ms": 1770000002200, "sequence_before": 42, "sequence_after": 42, "complete": true,
  "captured_at_ms": 1770000002200, "positions": [], "active_orders": [],
  "history_orders": [
    {
      "order_id": "7001", "position_id": "9001", "time_setup_ms": 1769999000000,
      "time_done_ms": 1769999010000, "symbol": "NAS100", "magic": "42", "order_type": "buy",
      "state": "filled", "volume_initial": "0.10", "volume_current": "0.10",
      "price_open": "25000.1", "price_current": "25000.1", "stop_loss": null,
      "take_profit": null, "comment": null
    }
  ],
  "history_deals": [
    {
      "deal_id": "8001", "order_id": "7001", "position_id": "9001", "time_ms": 1769999010000,
      "symbol": "NAS100", "magic": "42", "deal_type": "buy", "entry": "in", "volume": "0.10",
      "price": "25000.1", "profit": "0", "commission": "-0.20", "swap": "0", "fee": "0",
      "comment": null
    }
  ]
}
```

`positions` uses the portfolio position schema; `active_orders` uses its order
schema. Validate account identity, exact requested `history_from_ms`, record
IDs/uniqueness, limits, and timestamps. Historical order completion and deal
time must lie in the requested window; order setup may precede it. The EA
includes trading deals with an order/symbol association and positive
volume/price, excluding balance/credit records without those associations.
Only profit, commission, swap, and fee may be negative; historical order
remaining volume/current price may be zero. Optional comments are at most
256 characters.

`sequence_after >= sequence_before`; `complete=true` additionally requires
equal sequence values and no truncation. `history_to_ms` is the end actually
read; `captured_at_ms >= history_to_ms`. `reconcile_error` contains
`request_id`, `code`, and `message` and does not satisfy the reconciliation gate.

Reconciliation is observation: missing records, incomplete snapshots, and
sequence gaps cannot prove non-execution or automatically reject a command.
The protocol does not automatically match command IDs to broker records.

## Risk preview and OrderCheck

Both paths are read-only and never call `OrderSend`. A new draft replaces the
pending request; accept only results matching the active draft, account,
symbol, and session.

### Risk preview

**`risk_quote_request` payload:**

```json
{
  "draft_id": "draft-12-4", "symbol": "NAS100", "side": "buy", "entry": "25000.0",
  "stop_loss": "24950.0", "take_profit": "25100.0"
}
```

SL is required for risk calculations; TP is optional. For Stop Limit, this
path's `entry` is the resting `limit_price`. The EA may normalize to tick size
only while preserving geometry and differing by less than one tick.

**`risk_quote_result` payload:**

```json
{
  "draft_id": "draft-12-4", "symbol": "NAS100", "side": "buy", "entry": "25000.0",
  "stop_loss": "24950.0", "take_profit": "25100.0", "reference_volume": "1.0",
  "loss_at_reference": "240.0", "reward_at_reference": "480.0", "margin_at_reference": "1200.0",
  "currency": "USD", "tick_size": "0.1", "volume_min": "0.01", "volume_max": "100",
  "volume_step": "0.01", "quoted_at_ms": 1770000001705
}
```

The EA uses `OrderCalcProfit` and `OrderCalcMargin` at `reference_volume`.
Loss, reward, and margin scale with normalized volume. Margin is nonnegative;
zero is valid. `reward_at_reference` is nullable when no TP is present.
Rust sizes against both the risk budget and the latest session-bound account
snapshot's `free_margin`, in the quote's matching account currency. The desktop
`request_risk_preview` command accepts an optional decimal-string
`equityAllocationPercent` (greater than 0, at most 100; absent defaults to
`100`). Rust computes the margin budget as
`min(account.equity × equityAllocationPercent / 100, account.free_margin)`
using checked decimal arithmetic and positive equity. This allocation stays
attached to the correlated pending/expected preview, and uses the latest bound
account snapshot when the quote arrives. It applies to automatic money/% risk
sizing. In Risk % mode the desktop derives `riskAmount` from
`account.equity × equityAllocationPercent / 100 × riskPercent / 100`;
therefore 50% allocation with 1% risk uses a 0.5%-of-total-equity SL budget.
The command receives that already allocated risk amount and does not scale
it again. Explicit money risk stays fixed; allocation caps its margin only.
Manual Units keeps its explicit volume and broker OrderCheck. Editing
the allocation invalidates the preview and accepted review. The percentage
is a maximum margin budget per order, not a promise to spend it: SL risk and
broker volume limits can produce a smaller order. This is desktop policy; the
EA wire quote request/result are unchanged. Volume is
capped by broker maximum and rounded down to the broker step; estimated loss
and margin must remain within their budgets. A missing account, currency
mismatch, or unaffordable minimum volume yields a preview error. The margin
estimate inherits MT5's price, contract and leverage rules through
`OrderCalcMargin`; it is not a reservation and does not include existing
positions/orders in that calculation. Every new quote uses current cached
free margin; `OrderCheck` remains the final broker affordability check.
`risk_quote_error` contains `draft_id`, `code`, and `message`; it leaves the
session connected.

The read-only desktop command `project_risk_preview` accepts the same draft
fields as `request_risk_preview` (allocation is required) and returns a nullable
`RiskPreview` view. An optional decimal-string `targetVolume` selects inverse
risk fitting: retain that preferred volume on the broker lot grid, capped by
margin and the risk possible at the supplied seed SL; move SL outward from
that seed to the nearest price tick whose estimated loss does not exceed the
budget. The caller must supply a valid seed, including the market spread and
minimum-distance guard. This optional inverse-fitting command remains available,
but the ticket does not use it when entering money/% risk: it seeds SL inside the
visible chart range and sizes volume at that stop. Known symbols use the closest
permitted stop; without metadata, the seed uses a quarter of the visible price
span. If no valid seed fits, the UI requests zooming out or a manual SL instead
of changing the price scale. Existing user stops are preserved. Margin and lot
caps reduce achievable risk; they never move SL outward to consume the budget.
Automatic market-quote following translates entry and exits together to preserve
distance. Projections never satisfy preview freshness or OrderCheck; wire quotes
remain unchanged.
Without `targetVolume`, it projects the last accepted broker quote from the current
session, symbol and side using checked Decimal SL/TP distance ratios, then runs
the same sizing function with the latest equity/free-margin allocation and lot
limits. Cached currency conversion and margin estimates are approximate until
MT5 requotes. No cache or a mismatched session/symbol/side returns `null`.
The frontend uses this immediately for automatic money/% volume/labels while
dragging; it remains separate from the broker preview and never satisfies
submission freshness. Stale local results, results arriving during review and
results superseded by a fresh MT5 preview are ignored. The command neither
queues broker traffic nor changes the validated-check slot; EA wire is unchanged.
While a staged level is being dragged, quote updates do not shift its market
entry or exits, and broker SL normalization is deferred. Release/cancel resumes
following the latest quote, translating exits to preserve the edited distances.
In money/% modes the grabbed SL account-currency label is held until release, even if a
fresh broker result refines volume during the drag. The hold is display-only;
release shows the latest actual estimate and all preview/check gates remain.

### OrderCheck

**`order_check_request` payload:**

```json
{
  "draft_id": "draft-12-9", "account_login": "12345678", "broker_server": "Demo-Server",
  "symbol": "NAS100", "side": "buy", "order_kind": "limit", "volume": "0.10",
  "entry": "25000.0", "stop_loss": "24950.0", "take_profit": "25100.0", "time_in_force": "gtc",
  "limit_price": null
}
```

`side` is `buy|sell`; `order_kind` is `market|limit|stop|stop_limit`.
Volume/entry and any supplied limit or exit price must be positive decimals.
Missing or `null` SL/TP means no level on check/submit; absent levels skip
exit-distance validation. The EA interprets an empty string as absent, but
Rust rejects a present empty decimal string.

For each present exit, minimum distance is strictly greater than
`max(stops_level × point_size, 20 × tick_size)`. Reference prices are:

| Kind | Exit reference |
| --- | --- |
| Market buy | SL: current bid; TP: current ask. |
| Market sell | SL: current ask; TP: current bid. |
| Limit / Stop | Future `entry`. |
| Stop Limit | Resting `limit_price`. |

**`order_check_result` payload:**

```json
{
  "draft_id": "draft-12-9", "account_login": "12345678", "broker_server": "Demo-Server",
  "symbol": "NAS100", "side": "buy", "order_kind": "limit", "volume": "0.10",
  "requested_entry": "25000.0", "check_price": "25000.0", "stop_loss": "24950.0",
  "take_profit": "25100.0", "check_passed": true, "retcode": 0, "last_error": 0,
  "balance": "10000.00", "equity": "10000.00", "profit": "0.00", "margin": "120.00",
  "free_margin": "9880.00", "margin_level": "8333.33", "comment": "Request validated",
  "checked_at_ms": 1770000001805, "time_in_force": "gtc", "limit_price": null
}
```

The result echoes draft/account fields exactly as text, using
`requested_entry` for the requested entry. `check_price` is positive.
`balance`, `equity`, `profit`, `free_margin`, and `margin_level` may be negative;
`margin` cannot. `comment` is at most 256 characters; `checked_at_ms`
is nonnegative. `time_in_force` and `limit_price` echo supplied draft values
and are `null` when absent. `order_check_error` contains `draft_id`, `code`,
and `message`. Tauri publishes `order-check-result` / `order-check-error` with
`draftVersion` so the UI can reject stale responses.
Order review pins sizing inputs, prices and volume. Floating account equity
and free-margin updates do not create a new reviewed draft or invalidate an
in-flight check for the same account. Account currency, leverage, margin mode
and trading permission changes still invalidate it. The EA rechecks the exact
submission against current broker/account state immediately before sending.

### Time-in-force and Stop Limit

`time_in_force` is optional (`gtc|day|ioc|fok`); omission means `gtc`.
`limit_price` is required for Stop Limit, ignored for other kinds but still
validated when present. For Stop Limit, `entry` is the trigger and
`limit_price` is the resting price. MT5 maps these to `price` and `stoplimit`
respectively; the EA normalizes both to symbol precision. Risk and exit
geometry use the resting price; OrderCheck's `check_price` uses the trigger.

Reject unknown kinds/TIF, missing or nonpositive required prices, and triggers
on the wrong side of the quote. Relative resting-price/trigger validity is
left to the broker's OrderCheck/OrderSend validation.

| Kind | TIF | Expiration | Filling preference (first allowed) |
| --- | --- | --- | --- |
| Market | omitted / `gtc` / `day` | GTC | FOK → IOC → RETURN |
| Market | `ioc` | GTC | IOC → RETURN → FOK |
| Market | `fok` | GTC | FOK → IOC → RETURN |
| Limit / Stop / Stop Limit | omitted / `gtc` | GTC | RETURN |
| Limit / Stop / Stop Limit | `day` | DAY | RETURN |
| Limit / Stop / Stop Limit | `ioc` | GTC | IOC → RETURN |
| Limit / Stop / Stop Limit | `fok` | GTC | FOK → IOC → RETURN |

For market orders, RETURN is disallowed with `SYMBOL_TRADE_EXECUTION_MARKET`;
FOK/IOC availability follows `SYMBOL_FILLING_MODE`. Exhausted market choices
produce `UNSUPPORTED_FILLING`; pending orders fall back to RETURN. Fallbacks
are reported in check comments/command messages. DAY requires broker
expiration support; there is no expiration fallback. Pending IOC/FOK sets
filling preference without making the resting order expire immediately.

Omitted optional TIF/limit fields do not change canonical request identity or
journal serialization; replay defaults TIF to GTC. Stored journal fields and
schema remain compatible; replay preserves stored intent semantics.

## Execution

Rust sends submit/modify/close/cancel commands; only the EA calls MT5 trading
APIs. Dispatch requires all three gates: `DISPATCH_ENABLED=true`, active
handshake `trading_enabled=true`, and complete reconciliation. Journal
availability, the immutable app startup trading permission, and active-session
binding are also required when claiming a
queued command. Account/broker identity must agree with the session.

The Rust queue holds at most 32 pending commands, with one in flight. Session
loss/change drains it; reconnect never replays or automatically retries
commands. The EA keeps a bounded registry of 512 commands, evicting inactive
records when needed, and journals acceptance before broker submission. Rust's
journal is append-only and fail-closed.

`command_id` is persistent and idempotent: the same ID/payload returns known
state without redispatch. A changed payload is a conflict: frame-level
`INVALID_MESSAGE`, or registry-level `DUPLICATE_CONFLICT`. Do not reuse an ID
or rely on reconnect to submit again. An `unknown` outcome needs broker
evidence; absence from reconciliation alone cannot resolve it.

### Requests

**`order_submit_request` payload:**

```json
{
  "command_id": "cmd-7f3a9c2e", "draft_id": "draft-12-9", "account_login": "12345678",
  "broker_server": "Broker-Demo", "symbol": "NAS100", "side": "buy", "order_kind": "limit",
  "volume": "0.10", "entry": "25000.0", "stop_loss": "24950.0", "take_profit": "25100.0"
}
```

Submit must reference a successful OrderCheck for the current `draft_id`.
The EA revalidates quote, instrument, permissions, and OrderCheck before
sending. Submit shares the check path's TIF/Stop Limit and optional SL/TP
rules: missing/null SL means an order without SL.

**`order_modify_request` payload:**

```json
{
  "command_id": "cmd-7f3a9c2f", "account_login": "12345678", "broker_server": "Broker-Demo",
  "target_kind": "pending_order", "target_id": "7001", "stop_loss": "24940.0",
  "take_profit": "25100.0", "price": "24980.0"
}
```

`target_kind` is `position|pending_order`. Each `null` level means **unchanged**;
SL/TP removal is unsupported. `price` is valid only for a pending order and
must be `null` for a position. This null rule differs from check/submit.

**`order_close_request` payload:**

```json
{
  "command_id": "cmd-7f3a9c30", "account_login": "12345678", "broker_server": "Broker-Demo",
  "position_id": "9001", "volume": null
}
```

`volume:null` requests full close. Only full close is supported.

**`order_cancel_request` payload:**

```json
{
  "command_id": "cmd-7f3a9c31", "account_login": "12345678", "broker_server": "Broker-Demo",
  "order_id": "7001"
}
```

Cancel identifies a pending order by `order_id`. Partial close and Break Even
are unsupported.

### Updates and errors

**`order_command_update` payload:**

```json
{
  "command_id": "cmd-7f3a9c2e", "status": "server_accepted", "retcode": 10009, "last_error": 0,
  "broker_order_id": "7005", "deal_id": null, "position_id": null, "filled_volume": null,
  "message": "pending order placed", "updated_at_ms": 1770000001980, "at_update": 2
}
```

`accepted` confirms EA registration; `dispatching` precedes broker submission.
Updates reflect OrderSend results and OnTradeTransaction facts;
`OrderSend()==true` alone is not proof of a fill. `at_update` increases
monotonically per command. Retcode, last error, broker/deal/position IDs,
filled volume, and message are nullable; present filled volume is a decimal
string and message is at most 256 characters.

State flow: `accepted → dispatching → server_accepted → partially_filled →
filled`, with repeated partial fills allowed. Dispatching/server-accepted
commands may become `rejected`. Any active state may become `unknown`, which
requires broker evidence to resolve. A pending order's `server_accepted`
releases the queue slot while the order can remain pending.

`order_command_error` contains `command_id`, `code`, and `message` and does not
end the session. Codes: `UNKNOWN_COMMAND`, `DUPLICATE_CONFLICT`,
`PREFLIGHT_FAILED`, `INVALID_REQUEST`, `BROKER_UNAVAILABLE`,
`JOURNAL_UNAVAILABLE`, `SESSION_CLOSED`. Errors before dispatch leave state
`accepted`, record completion without dispatch, and never trigger retries.
`rejected` is a broker decision after dispatch.

## Tick history

Ranges are half-open `[from_ms,to_ms)`, with bounded page size and frame bytes.
Tick history is read-only and must not block heartbeats or command handling.

**`tick_history_request` payload:**

```json
{"symbol": "NAS100", "from_ms": 1769999400000, "to_ms": 1770000000000, "max_ticks": 5000}
```

`max_ticks` is `1..=negotiated max_ticks_per_page`; missing `price_counts`
means `false`. Request `price_counts:true` only when both peers negotiated
`tick_price_counts:true`.

**`tick_history_snapshot` payload:**

```json
{
  "request_id": "rust-ticks-1", "symbol": "NAS100", "from_ms": 1769999400000,
  "to_ms": 1770000000000, "tick_size": "0.1", "complete": true,
  "ticks": [
    {
      "time_ms": 1769999400123, "bid": "25000.1", "ask": "25000.3", "last": "0", "volume": 0,
      "volume_real": "0", "flags": 6
    }
  ]
}
```

Response request ID, symbol, and range must match. Prices/real volume are
decimal strings; flags preserve `MqlTick.flags`. `tick_size` is positive.
Records are ordered, with equal timestamps allowed, and contain the oldest
continuous prefix, never a sample. Reject out-of-range or invalid records.
`complete=false` means a tick-count or UTF-8 byte budget truncated the page;
`complete=true` covers the whole requested range, including empty ranges.
Ticks exactly at `to_ms` are excluded.

### Exact price summaries

**`tick_price_history_snapshot` payload:**

```json
{
  "request_id": "rust-ticks-1", "symbol": "NAS100", "from_ms": 1000, "to_ms": 2000,
  "tick_size": "0.1", "complete": false, "through_ms": 1500, "loaded_ticks": 3,
  "rejected_ticks": 0, "min_quote": "100.0", "max_quote": "100.1",
  "prices": [
    {"price": "100.0", "total": 3, "bid": 2, "ask": 0, "bid_seen": true},
    {"price": "100.1", "total": 0, "bid": 0, "ask": 2, "bid_seen": false}
  ]
}
```

`through_ms` is the exclusive accepted-prefix boundary. Complete pages have
`through_ms=to_ms`; incomplete pages exclude their final millisecond so the
next request starts at `through_ms`. No certified progress means
`through_ms=from_ms`, zero loaded ticks, and no prices; split the range.
`loaded_ticks <= max_ticks`, `rejected_ticks <= loaded_ticks`; prices are
unique and validated against quote bounds/count budgets. Quote bounds are
both `null` for an empty page.

Contribution rules: flags `2` (BID) / `4` (ASK). Total counts each tick with
either flag once at its BID price; BID counts at BID, ASK at ASK. Invalid
nonpositive contributions increment `rejected_ticks`; `bid_seen` retains
BID prices from unflagged/rejected ticks for the grid fallback. Quote bounds
include all accepted amounts. `min_quote`/`max_quote` preserve
quote bounds. A wide price set can fall back to a raw snapshot for the same
page; accept either format without double counting.

### Pagination and request errors

For an incomplete raw page, retain only ticks before its final timestamp and
request that final millisecond again. Do not append both copies of that
millisecond. If no complete prefix exists, split the range. A 1 ms range that
still exceeds capacity remains an incomplete fragment; never sample it.

The hidden `BetterChartsTickHistoryReader` performs synchronized reads, and
the EA chunks serialization so heartbeats remain responsive. A failed reader
or 120-second synchronization timeout produces a correlated `error` whose
envelope `id` matches the tick request, code `INTERNAL_ERROR` or
`FRAME_TOO_LARGE`, and `retryable=false`. Rust ends the profile without
resetting the session; stale correlated errors are ignored. Other protocol
errors remain fail-closed; failed requests are not retried automatically.

## Desktop tick-profile events

These are camelCase Tauri events, not additional TCP message types. Sequential
pagination preserves request/session/symbol/generation identity.

**`tick-profile-progress` payload:**

```json
{
  "symbol": "NAS100", "fromMs": 1769999400000, "endMs": 1770000000000, "completedPages": 4,
  "pendingPages": 3, "loadedTicks": 17321
}
```

`loadedTicks` counts accepted prefixes/complete pages and terminal 1 ms
fragments; it excludes discarded split pages and final timestamps awaiting
reread. After 250,000 accepted ticks, exact per-price aggregation replaces raw
storage and fetching continues to the range end without sampling.

| Safeguard | Limit / behavior |
| --- | --- |
| Raw cache | 100,000 ticks / 128 ranges, trimmed after each page. |
| Summary cache | 250,000 price records / 128 complete ranges; reuse contained segments, fetch edges again; clear on session change. |
| Active fetch | 512 processed pages. |
| Accumulator | 250,000 contribution prices and 250,000 BID prices. |
| Exceeded work/price limit | Nonfatal `tick-profile-error`; never render a histogram of only the range's beginning. |

Summaries are not interpolated or trimmed; overlapping cache entries are
replaced and future data is not cached. Terminal incomplete fragments yield
`complete=false` after the full range is processed.

`cancel_tick_profile` invalidates the active generation and emits:

**`tick-profile-cancelled` payload:**

```json
{"symbol": "NAS100", "fromMs": 1769999400000, "endMs": 1770000000000}
```

Cancellation preserves the bridge session. With no active profile, the
command succeeds without emitting an event. Late snapshots are ignored.

## Protocol errors

**`error` payload:**

```json
{"code": "UNSUPPORTED_VERSION", "message": "unsupported protocol version", "retryable": false}
```

Codes: `MALFORMED_FRAME`, `FRAME_TOO_LARGE`, `INVALID_MESSAGE`,
`UNSUPPORTED_VERSION`, `AUTH_FAILED`, `HANDSHAKE_REQUIRED`, `SESSION_MISMATCH`,
`INTERNAL_ERROR`. Protocol/auth/session errors close the connection; the
correlated tick-page errors described above affect only the active request.
Request-specific risk/check/reconciliation/command errors carry their own
correlation IDs and do not by themselves authorize execution or retry.

## Runtime setup

Installation paths, token/port configuration, and native Windows/Wine startup
are documented in the [bridge guide](../../mql5/bridge/README.md#optional-mt5-startup) and
[EA setup guide](../../mql5/bridge/README.md). Process management is outside the
TCP protocol; starting MT5 does not attach the EA or satisfy dispatch gates.
