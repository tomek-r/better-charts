# React 19 domain-store migration

Owner decision, 2026-10-08: retain context for stable injected dependencies and rare changes. Move frequently changing data to separate Zustand stores per domain. This supersedes the earlier recommendation to preserve the ticket and bridge value-context trees.

## Required behavior

- Store instances belong to the mounted workspace/provider; do not share account, quote, or draft state through module globals.
- A context can inject a stable bundle of named store APIs. The bundle is not itself an observable application store.
- Quote, accepted market history/live candle, account, portfolio, and ticket domains have independent subscriptions. Views select the fields they use.
- Keep canonical mutable data in stores. Compute formatted values, risk estimates, and execution eligibility from current canonical inputs; do not mirror derived provider packets into stores.
- Preserve session, request, symbol, account/server, and draft-version acceptance checks, execution dispatch gates, and existing lifecycle registration order.
- Keep chart instances, request generations, animation-frame batching, and mutable overlay hit geometry in their existing imperative owners.
- Use one shared required-context hook and React 19 context syntax. Low-frequency local animation state may remain in React.
- Move chart effects into `features/chart/effects` and state hooks into `features/chart/state`. Merge nested conditions only when the outer branch has no other behavior.

## Documentation basis

React documents external-store subscriptions, immutable/cached snapshots, and stable subscription functions in [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore). React 19 supports rendering the context itself as the provider ([createContext](https://react.dev/reference/react/createContext)).

Zustand recommends vanilla stores plus React context for scoped dependency injection ([initialize state with props](https://pmndrs.github.io/zustand/learn/guides/initialize-state-with-props)). Its v5 selectors must return stable references; use primitives, existing references, or shallow-stable projections ([useShallow](https://pmndrs.github.io/zustand/reference/hooks/use-shallow)).

## Store boundaries and selection

| Owner                               | Observable domains                                       |
| ----------------------------------- | -------------------------------------------------------- |
| Bridge session                      | Connection, market/history, quote, account, portfolio    |
| Order ticket                        | Draft inputs, broker responses/loading, editor expansion |
| App settings                        | Settings, modal and notice state                         |
| Execution                           | Queue presentation and close/cancel progress             |
| Panel, symbol search, notifications | Their own local store instances                          |

The provider creates its store instances once with a lazy React initializer. React holds the stable store identity; Zustand owns the mutable data and subscriptions. Context injects those instances and stable actions. Chart resources, drawing-tool selection, and notification closing animation retain their existing low-frequency context/local state.

Select related fields together from the same store. Use `useShallow` for object/tuple selections so unrelated updates do not rerender the consumer. The bridge market and connection selector helpers apply it internally; account and quote selectors and direct `useStore` calls apply it at the call site when needed. Grouping does not combine independent domains into a global store.

For write-only access, `useFieldSetterSelector(store, selector)` selects from the store's stable typed setter map without subscribing to state. The bridge groups setters once per domain. Ticket stores reuse the same setter generation; functional updates and unchanged-value suppression retain their existing behavior.

## Bridge session responsibilities

`useBridgeSession.ts` owns scoped session coordination refs and symbol/history/profile actions. `effects/useBridgeBootstrapEffects.ts` owns startup reads, the single subscription scope, listener registration order, and cleanup. `effects/useBridgeStreamEffects.ts` synchronizes portfolio overlays. `bridgeMarketRuntime.ts` owns accepted market events, paging, live-candle batching, and profile responses; `bridgeTicketResponseHandlers.ts` owns risk-preview and OrderCheck acceptance guards.

The extraction reduced the session file from 978 to 213 lines. Review compared the 16 listener registrations and moved executable bodies against the prior implementation, preserving registration order, acceptance policies, adapter capture before awaits, candle cancellation, and cleanup. The existing 261 browser tests passed after extraction.

## Order ticket responsibilities

`OrderTicketProvider.tsx` now owns only scoped store creation, the ticket producer, stable action bindings, and context injection. The extraction reduces it from 680 to 98 lines without adding stores or providers.

`state/orderTicketContext.ts` owns injection types and required store/action accessors. `useOrderTicketRuntime` and `useOrderTicketState` have been removed. `state/useOrderTicketActionsProducer.ts` composes the draft, pricing, sizing, and broker command hooks and returns only actions. Each producer reads its own canonical domain inputs; error notifications belong to the broker producer. Editor hooks are grouped by purpose: `editor/useOrderTicketHeader.ts`, `editor/useOrderTicketGates.ts` (shared eligibility projection), `editor/useOrderTicketStage.ts`, `editor/useOrderTicketAction.ts`, `editor/useOrderTicketReviewProps.ts`, `editor/useOrderTicketQuotes.ts`, `editor/useOrderTicketPricing.ts`, `editor/useOrderTicketSizing.ts` (sizing/risk basis/tick value), `editor/useOrderTicketExits.ts`, and `editor/useOrderTicketExtraSettings.ts`. Consumers import hooks directly from these modules.

Review compared all 16 moved function bodies against the previous provider and found no executable changes. Selectors, coordination refs, action identities, and trading eligibility calculations retain their existing behavior. Type checking, linting, formatting, the frontend build, and the browser regression suite verify the extraction.

The profiler review found excessive subscription setup in consumers that already read every field. The bridge lifecycle subscribes once per bridge domain. Draft and sizing command producers read current draft snapshots when invoked, without subscribing to callback-only inputs. This also keeps sequential commands fresh before React rerenders. Pricing retains reactive inputs for its offset effect, and the broker producer retains its current selections and error notifications. Editor state stays with editor consumers. Ticket lifecycle hooks read cached canonical domain snapshots and project focused consumer inputs. Stable setter maps remain write-only. Focused UI consumers retain field selections.

`AppLifecycle` passes its already-subscribed bridge inputs into focused entry, order-check, risk-preview, and chart-display hooks. Stable chart controls/actions and bridge-response refs are separate dependencies. The chart hook retains the held drag label; the preview hook supplies risk-basis and stop-distance inputs.

The Action hook subscribes to a read-only selector adapter over the canonical ticket and bridge stores. Its cached snapshot contains only eligibility, loading, and side, and notifications occur only when those outputs change. It has no writable derived state. Regression checks cover unchanged eligibility after entry/time-in-force edits and fresh output after account, connection, volume, side, and loading changes.

`domain/ticketDerivation.ts` supplies the shared input mapping for broker commands and gate selectors. Each ticket scope also owns a bounded, one-entry memo of the pure eligibility derivation. Broker commands and gate selectors pass their subscribed snapshots explicitly; the memo reads no stores, accepts every domain input, and recomputes on any input change. It introduces no observable derived store. The existing policy matrix verifies cached check/submit decisions and blocked reasons, including stale checks and account mismatches.

The Exits hook selects draft-version and broker-preview changes only while both exits are enabled, when its risk/reward label can exist. With that label absent, those changes cannot affect the returned display. A regression checks zero renders for version-only changes with exits disabled and verifies that an enabled label changes when a preview becomes stale. Chart monetary labels retain their separate lifecycle derivation.

`useBridgeQuotePresentation` selects only bid, ask, and last, then formats those values outside the external-store selector. Chart and ticket quote views share it. Timestamp-only updates leave these views idle; changes to last-price precision still update formatting. The ticket supplies its instrument point size explicitly for spread points, while the chart retains its existing spread-text policy.

## Frontend console removal

Subsequent owner decision: remove production frontend `console.*` calls. The frontend had no forwarding to a Tauri file logger. Logging-only execution-safety/recovery/reconciliation reads and the reconciliation log listener are removed rather than retained as unused work. The remaining listener order and mounted-session effect are preserved. Backend readers and durable execution journaling are unchanged.

Command rejection/error notifications, chart/search/risk errors, queue updates, promise rejection handling, response acceptance checks, and execution gates remain active. Profile requests no longer take the unused logging-reason argument. Browser regressions assert visible rejection/error notifications and dispatch-lock recovery with no frontend info logs, and confirm the three logging-only snapshot commands are no longer requested.

## Review and validation

The subsequent [inline ESLint suppression audit](eslint-suppression-audit.md) removes all 21 frontend directives while preserving stable listener lifetimes and intentional nonreactive volume synchronization.

Implemented on `refactor/typescript-react-findings` in separate commits for the foundation, chart cleanups, context syntax, bridge domains, secondary providers, and ticket domains. Chart state hooks now live in `features/chart/state`; lifecycle, gesture, diagnostics, and overlay effects live in `features/chart/effects`. The folder move changes imports only and preserves lifecycle registration order.

Review retained the existing request/session/account/draft acceptance policies and execution gates. Stable callbacks use the existing `useEventCallback` helper; ticket display calculations use pure functions with current selector inputs. No derived context snapshots are mirrored into stores.

Validation:

- `pnpm check`: passed (TypeScript, ESLint, Prettier).
- `pnpm build`: passed.
- `pnpm test:e2e`: 261 tests passed after the store migration. Coverage includes independent provider scopes, functional updates, unchanged-value notification suppression, grouped subscriptions, ticket entry edits, settings races, reconnect, and guarded trading gestures.
- Every implementation commit runs the unchanged pre-commit gate, including offline Rust workspace tests, browser E2E, tick-reader validation, and mock/capture self-tests.
- `git diff --check`: passed.

Two test updates address the observed behavior directly: the live-candle harness waits for its probe to exist, and quote isolation asserts both unchanged-price inactivity and changed-price redraws. Browser checks use the Tauri stub; real Tauri/MT5 reconnection and live broker interaction were not exercised.

### Focused ticket interfaces

The provider injects scoped stores and stable actions. It does not publish a full ticket-state object. Lifecycle outputs contain only the consumer's inputs: entry synchronization (15 fields), order-check invalidation (31 fields), risk preview (its focused input plus risk basis), and chart overlay (12 fields). Chart setters/actions and the bridge-response port are separate stable dependencies. Editor panel state remains in editor selectors.

Chart, gesture, and bridge consumers declare their own small contracts using domain types and setters. The gesture engine owns the shared gesture-action contract. All lifecycle effects remain in the same AppLifecycle component and registration order. Canonical draft/broker stores and per-ticket coordination refs retain account/session correlation, stale-response rejection, review pinning, and dispatch gating. Browser coverage verifies sizing, review, dragging, reconnect, listener cleanup, and instance isolation.

This structural refactor does not establish performance parity by itself. The current measured comparison and remaining regressions are recorded in [the profiler review](react-profiler-comparison.md).
