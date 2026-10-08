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

## Review and validation

Implemented on `refactor/typescript-react-findings` in separate commits for the foundation, chart cleanups, context syntax, bridge domains, secondary providers, and ticket domains. Chart state hooks now live in `features/chart/state`; lifecycle, gesture, diagnostics, and overlay effects live in `features/chart/effects`. The folder move changes imports only and preserves lifecycle registration order.

Review retained the existing request/session/account/draft acceptance policies and execution gates. Stable callbacks use the existing `useEventCallback` helper; ticket display calculations use pure functions with current selector inputs. No derived context snapshots are mirrored into stores.

Validation:

- `pnpm check`: passed (TypeScript, ESLint, Prettier).
- `pnpm build`: passed.
- `pnpm test:e2e`: 261 tests passed after the store migration. Coverage includes independent provider scopes, functional updates, unchanged-value notification suppression, grouped subscriptions, ticket entry edits, settings races, reconnect, and guarded trading gestures.
- Every implementation commit runs the unchanged pre-commit gate, including offline Rust workspace tests, browser E2E, tick-reader validation, and mock/capture self-tests.
- `git diff --check`: passed.

Two test updates address the observed behavior directly: the live-candle harness waits for its probe to exist, and quote isolation asserts both unchanged-price inactivity and changed-price redraws. Browser checks use the Tauri stub; real Tauri/MT5 reconnection and live broker interaction were not exercised.
