# Architecture

```text
React + Lightweight Charts
        │ Tauri commands and events
Rust desktop backend ── trading-core
        │ authenticated loopback TCP
MT5 bridge EA ── MT5 trading API
        └─ hidden tick-history reader
```

## Responsibilities

| Location | Responsibility |
| --- | --- |
| `apps/desktop/src/` | React features, shared UI/contracts and chart rendering |
| `apps/desktop/src-tauri/` | TCP transport, journal, order queue and process management |
| `crates/trading-core/` | OS-independent validation, risk, profiles and execution state |
| `mql5/bridge/` | Market/account observations and MT5 trading API calls |
| `config/` | Shared timeframe and transfer-limit contracts |

The frontend communicates through Tauri. Only the EA calls the MT5 trading API.
Domain logic belongs in `trading-core`, without UI, Tauri or system dependencies.
The [protocol specification](../protocol/bridge-v1.md) defines the wire contract.

## Frontend ownership

`App.tsx` composes the workspace. Feature folders own their providers, views,
hooks, rules and styles. `shared/ui` contains generic primitives and does not
import features. Chart controllers, primitives and overlays belong in
`features/chart/engine/`; bridge normalization belongs in the bridge adapter.

Providers are scoped to their consumers. Separate market, account, portfolio
and connection contexts limit updates from quotes. Search owns its query,
results and persistence; ticket state is scoped to the ticket feature.

Views consume domain state; presentation components accept props. Providers
own shared state, and lifecycle components register effects without rendering.
Cross-domain synchronization is composed in `AppLifecycle.tsx`. Preserve effect
registration order: chart initialization and ticket/execution effects depend
on their existing placement and closure behavior.

Streaming chart rendering uses the imperative adapter. Candle updates are
batched per animation frame, and a history/session replacement cancels pending
work. Palette changes follow the [color conventions](color-palette.md).
The optional React measurement harness runs with
`pnpm --filter better-charts profiler`.

## Identity and observations

Accept snapshots only for the current session, symbol and request. A newer
draft or selection supersedes older work. Search records recent symbols after
an accepted selection, not merely a click.

Risk preview scales reference margin in Rust; `OrderCheck` observes a versioned
draft. Neither submits an order. Portfolio P&L requires account currency but
must not depend on instrument metadata being available.

## Execution persistence

Rust durably records intent before enqueueing a command. The queue holds at
most 32 entries and allows one command in flight. The EA journals commands
before `OrderSend` and reports facts from that call and `OnTradeTransaction`.
Neither side retries commands automatically after a session change.

The desktop journal is append-only, versioned and protected by an exclusive
process lock. Writes are synced before in-memory state advances. Corrupt or
unavailable storage prevents dispatch; it does not prevent read-only charting.
Old records must replay deterministically. Preserve stored fields and variants
unless a schema migration is provided.

Claims and lifecycle updates are session-bound. Dispatch requires the enabled
local gate and app permission, EA handshake permission, complete reconciliation
and journal availability. See [project status](../CURRENT_STATE.md) and
[contributor rules](../../AGENTS.md) for the current scope and safety constraints.
