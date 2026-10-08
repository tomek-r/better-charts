# TypeScript and React simplification review

Date: 2026-10-07. Reviewed checkout: `4dd4d40162d82208c85cb16849794c2aac1c2299`.

Snapshot note: `main` was subsequently pulled to `e3ec86d` (account-currency
changes). Original evidence and source line references describe the reviewed
checkout. Each implementation is reassessed against the current code and recorded
below; remaining proposals retain their original review scope.

Status: implementation authorized after owner review, on
`refactor/typescript-react-findings`, with a separate commit per finding. F01's
documentation correction is resolved; implementation and validation notes track
the subsequent findings.

## Assessment

The frontend's biggest maintenance cost is synchronization between the bridge,
ticket, and imperative chart. Several flows maintain the same facts through
state, refs, effect dependencies, and renderer caches. The useful simplifications
are clearer ownership and fewer duplicated policies, rather than fewer files.

The existing feature boundaries, chart controllers, split contexts, and broker
freshness gates generally serve useful purposes. I would keep those foundations.
The removal contract documentation has been corrected. I would first address
the asynchronous failure paths below, then make small DRY changes, and only then
consider lifecycle restructuring.

## Scope and evidence

The production inventory contains 117 `.ts`/`.tsx` files and 14,330 lines under
`apps/desktop/src`. This was a static review focused on bridge events, ticket
state and effects, chart data and overlays, providers, search, settings, and
portfolio UI. Related browser regressions and the current-state, architecture,
and protocol documents were read. Rust/MQL5 were checked where necessary to
understand a contract discrepancy; this is not a full backend audit.

Priorities describe suggested implementation order, not a merge verdict:

- **P1:** correctness or execution-contract issue to resolve first.
- **P2:** worthwhile structural simplification or avoidable work.
- **P3:** optional, local cleanup.

Confidence distinguishes **confirmed in source** from **runtime impact unmeasured**.
Original failure scenarios were identified statically; implementation notes
record which have since been reproduced with browser or domain regressions.
Effort is relative: small means a local change; medium means several related
modules; large means a staged architectural change.

## Findings at a glance

| ID  | Priority | Finding                                                          | Effort             | Change risk |
| --- | -------- | ---------------------------------------------------------------- | ------------------ | ----------- |
| F01 | Resolved | Stale documentation for supported live SL/TP removal             | Documentation only | Low         |
| F02 | P1       | Partly failed listener registration loses cleanup handles        | Small–medium       | Medium      |
| F03 | P1       | Canonical percentage-risk budget uses UI floating-point rounding | Medium             | High        |
| F04 | P1       | Old search failures can overwrite a newer search                 | Small              | Low         |
| F05 | P1       | Settings reads have inconsistent stale-response protection       | Small–medium       | Low         |
| F06 | P2       | Live candles copy a growing history into React state             | Medium–large       | Medium      |
| F07 | P2       | Candle validation is duplicated and disagrees at a boundary      | Small              | Low         |
| F08 | P2       | Symbol selection duplicates the same request lifecycle           | Small–medium       | Medium      |
| F09 | P2       | Ticket eligibility and blocked reasons duplicate policy          | Medium             | High        |
| F10 | P2       | Lifecycle integration exposes oversized mutable interfaces       | Large              | High        |
| F11 | P2       | Some consumers still subscribe to broader data than they use     | Small–medium       | Low         |
| F12 | P2       | Signed-money and quote presentation repeat existing logic        | Small              | Low         |
| F13 | P2       | Shared drawing primitives belong to a specific renderer          | Medium             | Medium      |
| F14 | P3       | History coordination contains a needless asynchronous helper     | Small              | Medium      |
| F15 | P3       | Search derives the same favorite/recent list in state and JSX    | Small              | Low         |
| F16 | Bug      | Reconnect can move the chart to a different point in time        | Small              | Medium      |

## Detailed findings

### F01 — Resolved: document supported live SL/TP removal

**Evidence:** [live clear drafts](../../apps/desktop/src/features/chart/useChartModificationDrafts.ts#L90),
[gesture dispatch](../../apps/desktop/src/features/chart/engine/tradingOverlayGestures.ts#L359),
[renderer description](../../apps/desktop/src/features/chart/engine/positionOverlay.ts#L43),
[current scope](../CURRENT_STATE.md), and
[modify contract](../protocol/bridge-v1.md#execution).

**Owner confirmation:** live SL/TP removal is implemented, intended, and works
correctly. The discrepancy was stale documentation, not an execution defect.
Chart clear chips build a modify draft with the decimal string `"0"` and dispatch
through the existing guarded execution path. [Rust validation and tests](../../crates/trading-core/src/protocol/tests.rs#L1572)
and [EA parsing](../../mql5/bridge/Experts/BetterChartsBridge.mq5#L792) accept this
removal sentinel.

**Resolution:** corrected the README, current-state page, protocol specification,
and stale inline documentation. Positive SL/TP values set a level, `"0"` removes
it, and omitted/null levels stay unchanged, for both positions and pending orders.
No execution behavior, dispatch gate, stub, or test was changed. No execution
refactor is proposed by this finding.

### F02 — P1: listener registration is not safe under partial failure

**Implemented:** bridge and execution effects share `SubscriptionScope`, which
owns each registration as it resolves and disposes successful/late subscriptions
on failure or unmount. Bridge initialization distinguishes a subscription failure
from an unavailable Tauri runtime. Both failure regressions failed before the fix;
all three listener-lifetime tests now pass. `pnpm check` and `pnpm build` pass.

**Evidence:** [bridge setup](../../apps/desktop/src/features/bridge/useBridgeSession.ts#L601)
and [execution setup](../../apps/desktop/src/features/execution/useExecutionCommands.ts#L210).

**Confirmed failure path:** both aggregate `listen(...)` calls with
`Promise.all`, and only save unlisten handles after every registration succeeds.
If one registration rejects after another succeeds, the successful listener's
handle never reaches the cleanup array. Unmount sets `disposed`, but cannot
unsubscribe that listener. A remount can accumulate retained listeners.
The bridge catch also labels any bootstrap failure as Tauri being unavailable,
even if the actual failure was one subscription.

**Proposal:** use a small subscription-lifetime helper that owns each handle as
soon as registration succeeds, including success after disposal. On group
failure, release successful subscriptions and report the failed stage. Preserve
parallel registration and the existing effect slot. This is a justified shared
helper because the same defect occurs in two places.

**Validation needed:** make one listener fail while another succeeds; unmount
while registration is pending; remount and assert exactly one active listener.
The existing chart listener-count regression covers successful setup only.
React requires cleanup to undo the effect's external subscriptions; see
[the official effect lifecycle](https://react.dev/reference/react/useEffect).

### F03 — P1: distinguish a display estimate from the canonical risk budget

**Implemented:** an additive `riskPercent` desktop command argument selects
checked Decimal budgeting in `trading-core` from native account equity. The
rounded hint remains display-only; money-mode callers retain explicit budgets.
Domain and native adapter tests cover sub-cent budgets, allocation, invalid input,
precision loss, and account updates. The browser regression reproduces and
guards sizing requests for a positive budget below currency display precision.

**Evidence:** [risk basis](../../apps/desktop/src/features/order-ticket/domain/riskBasis.ts#L41),
[preview request](../../apps/desktop/src/features/order-ticket/effects/useOrderTicketRiskPreviewEffects.ts#L140),
and [risk contract](../protocol/bridge-v1.md#risk-preview).

**Confirmed:** Risk % converts equity, allocation, and percentage to JavaScript
numbers, multiplies them, and rounds to two decimals. That result is used both
as the approximate hint and as the actual `riskAmount` sent to native sizing.
The hint and executable budget therefore share a presentation rounding policy.
For example, equity `100`, allocation `100`, risk percent `0.004` produces
`"0.00"` despite positive inputs. Whether sub-cent budgets should be valid is an
owner/domain policy question; the rounding is currently implicit.

**Proposal:** keep the approximate hint in TypeScript, but place canonical
percentage-budget calculation and its precision policy in `trading-core` using
checked Decimal arithmetic. Use a read-only native boundary for the resulting
decimal string. This requires an additive command/contract design, not an
incidental rewrite of `deriveOrderRiskBasis`.

**Validation needed:** tiny percentages, halfway rounding, non-USD currencies,
allocation limits, manual money risk, and review pinning across account ticks.
No claim is made that the native dispatch gates are bypassed by this calculation.

### F04 — P1: stale search errors are not guarded like stale successes

**Implemented:** each debounced request uses its effect lifetime to ignore
failures after query changes, closure, or cleanup. Result subscriptions exist
only while the dialog is open. Regressions cover a newer successful query and
closing/reopening the same query before an old rejection; the stale-error case
failed before the fix and passed afterward.

**Evidence:** [result listener](../../apps/desktop/src/features/symbol-search/SymbolSearchView.tsx#L44)
and [debounced request](../../apps/desktop/src/features/symbol-search/SymbolSearchView.tsx#L84).

**Confirmed failure path:** successful result events compare their query with
the latest query. The invoke rejection handler always clears loading and sets an
error. If search A starts, the user starts B, B succeeds, and A later rejects,
A can replace B's successful state with an error. Clearing a timeout does not
cancel an invoke that has already started.

**Proposal:** give each dispatched search a generation and invalidate it on
query change, closure, and cleanup. Guard errors as well as accepted results.
Keep the existing debounce and backend correlation; query equality alone cannot
distinguish repeated queries.

**Validation needed:** delayed failure A after successful B; close/reopen while
a request is pending. Extend `symbol-search.spec.ts`, whose current stale test
checks successful events from different queries.

### F05 — P1: unify settings load acceptance

**Implemented:** initial and explicit-open reads share generation-checked
acceptance for values and errors. New reads, saves, availability changes, and
unmount invalidate earlier responses. Initial-load restart/first-launch handling
remains explicit; opening still preserves restart-notice dismissal. Regressions
reproduced older reads overwriting both a newer response and a completed save.

**Evidence:** [initial load and open](../../apps/desktop/src/features/settings/useAppSettings.ts#L16)
and [save acceptance](../../apps/desktop/src/features/settings/useAppSettings.ts#L85).

**Confirmed failure path:** the initial load has an `active` cleanup guard;
`open()` starts another read with an unconditional `.then(setSettings)`. Repeated
opens can finish out of order, and an older read can overwrite state accepted
from a newer save. The reads also differ in how they update restart state.

**Proposal:** keep both load triggers, but route them through one acceptance
function and request generation. A save should invalidate older reads. Specify
which notification fields refresh on opening instead of accidentally changing
notification behavior while sharing the implementation.

**Validation needed:** out-of-order reads; an old read after save; unmount;
first-launch opening and restart notice dismissal. Existing `settings.spec.ts`
animation/focus tests must remain unchanged.

### F06 — P2: remove whole-history work from live React updates

**Implemented:** accepted history stays stable between snapshot replacements;
live frames update one raw `latestCandle` value. The chart engine continues to own
rendered and paged bars. Draft and staged-price fallbacks consume the latest raw
candle, including same-bar changes. Browser regressions cover stable history
identity, exact raw decimals, and first-live-bar staging after empty history.
The history-array copy is removed from the flush; no measured speedup is claimed.

**Evidence:** [frame flush](../../apps/desktop/src/features/bridge/useBridgeSession.ts#L419),
[chart cache](../../apps/desktop/src/features/chart/engine/barSeriesController.ts#L17),
and [older-page acceptance](../../apps/desktop/src/features/bridge/useBridgeSession.ts#L715).

**Confirmed structure, impact unmeasured:** batching already reduces work to
one state copy per candle frame, but the flush still copies `previous.candles`
even when only the final candle changed. Work grows with the React history length.
The chart also keeps its own render-bar cache. Older pages extend that cache
without extending `snapshot.candles`, so these collections already have different
coverage; React's array is not the complete history on screen.

**Proposal:** document each cache's responsibility, then give React consumers
the chart identity, has-data flag, and latest raw candle they actually need.
Keep paged render history in the engine. Preserve the bridge snapshot contract
and raw decimal data where required; do not simply delete or cap historical
chart bars.

**Validation needed:** initial empty history followed by the first bar; burst
updates; paging; staged entry fallback; session cancellation; provider isolation.
Measure allocation and render work with long histories before claiming a speedup.

### F07 — P2: use one candle rendering-validation policy

**Implemented:** live candle acceptance delegates to the chart adapter's existing
conversion policy. A regression reproduces the sub-second timestamp disagreement
and covers the accepted boundary, malformed values, and exact raw price strings.

**Evidence:** [bridge predicate](../../apps/desktop/src/features/bridge/normalizers.ts#L47)
and [render conversion](../../apps/desktop/src/features/chart/engine/mt5DataAdapter.ts#L19).

**Confirmed duplication:** both parse OHLC/volume and check finite numbers,
nonnegative values, and candle geometry. They differ for time: `isValidCandle`
accepts a positive `timeMs` below 1000, while `toRenderBar` rejects it after
flooring to zero seconds. The live listener can accept a candle into React state
that the chart declines to render. History also converts candles for filtering,
then converts them again when installing series data.

**Proposal:** define one conversion/validation result at the rendering adapter
boundary, and let acceptance and rendering consume that decision. Keep raw
decimal strings in bridge models. Do not replace boundary validation with trust
in TypeScript types.

**Validation needed:** sub-second epoch values, malformed OHLC, volume, duplicate
seconds, and ordering. Extend the malformed-bar cases in `chart-migration.spec.ts`.

### F08 — P2: collapse duplicated symbol-selection orchestration

**Implemented:** the public metadata and name-only selection callbacks share a
local request lifecycle. Name-only trimming and same-selection no-ops remain in
that entry point; eager metadata and its failure cleanup remain explicit.
Recents still record accepted history only. Characterization covers dispatch
failure through both entry points and a delayed failure after a newer selection.

**Evidence:** [metadata selection](../../apps/desktop/src/features/bridge/useBridgeSession.ts#L133)
and [name-only selection](../../apps/desktop/src/features/bridge/useBridgeSession.ts#L173).

**Confirmed duplication:** both set a target, clear quotes, mark loading, bump
a generation, resolve the adapter/timeframe, request history, and handle current
request failure. Their important differences are eager metadata and the
name-only same-symbol/pending-symbol no-op.

**Proposal:** keep the two public entry points, but share the internal request
lifecycle through a selection input with optional metadata. Preserve those
differences explicitly, including accepted-history recording of recents.
Do not introduce a general request framework for two local callers.

**Validation needed:** rapid symbol/timeframe changes, same portfolio symbol,
send failure, timeout, and stale metadata. Use `symbol-search.spec.ts`, the
portfolio selection cases in `execution-flow.spec.ts`, and history regressions.

### F09 — P2: ticket gates and explanations should consume named policy results

**Implemented:** named local predicates now feed check eligibility, submission,
and ordered blocked reasons. The policies retain their different requirements,
including preview freshness, exact volume echo, account/check identity, nullable
exits, TIF, and the empty blocked reason. A 26-case characterization matrix passed
on both the original and refactored derivation; execution gates are unchanged.

**Evidence:** [ticket derivation](../../apps/desktop/src/features/order-ticket/domain/ticketRules.ts#L266).

**Confirmed duplication:** check eligibility, submit eligibility, and blocked
reason selection independently repeat account, volume, stop, allocation, and
preview-freshness conditions. This makes a rule change easy to apply to a gate
without updating its explanation. Some failures, including mismatched check
identity or prices, reach the generic `Order panel is not ready` message.

**Proposal:** compute named validation results once, then compose distinct
check and submit policies from them. Keep explanation precedence explicit.
Broker validation stays authoritative; any policy shared with transport belongs
in `trading-core`. First extract a few predicates, rather than introducing an
entire validation engine.

**Validation needed:** preserve the intentional differences: market checks may
inspect explicit volume while sizing refreshes; submission still requires fresh
sizing where applicable and an accepted matching check. Preserve the empty-string
blocked reason, nullable exits, volume echo, account/server, TIF, and Stop Limit
rules. This is a high-risk refactor despite its DRY motivation.

### F10 — P2: reduce lifecycle coupling without flattening providers

**Implemented:** bridge bootstrap accepts a named response port limited to its
11 ticket refs/setters. The existing ticket object satisfies that port without
new forwarding boilerplate. Staged display declares an independent domain input
instead of importing a React state-hook type. Lifecycle order, listeners,
effect dependencies, and provider state ownership are unchanged.

**Evidence:** [central lifecycle](../../apps/desktop/src/AppLifecycle.tsx#L29),
[bridge bootstrap inputs](../../apps/desktop/src/features/bridge/useBridgeSession.ts#L336),
[ticket state](../../apps/desktop/src/features/order-ticket/state/useOrderTicketState.ts#L111),
and [display input](../../apps/desktop/src/features/order-ticket/domain/stagedOrderDisplay.ts#L3).

**Confirmed structure:** providers return large bags of state, setters, and refs;
`AppLifecycle` passes them across domains. Bridge bootstrap takes the entire
ticket runtime even though it primarily needs response-acceptance operations.
The pure staged display module derives its input type from a React state hook,
reversing the natural type dependency. Many effect comments refer to former
monolithic slots and frozen dependency arrays rather than current invariants.

**Proposal:** retain `AppLifecycle` as the ordered composition root, but narrow
integration inputs to explicit market/ticket-response/chart operations. Define
pure domain input types independently of React hooks. Over time, group cohesive
ticket transitions such as reset or check acceptance into actions so callers
cannot update only half the related fields. Start with one boundary; replacing
all ticket state with one reducer is not automatically simpler.

**Validation needed:** preserve effect registration order, latest committed
callbacks, layout/passive timing, drag holds, stale-response rejection, and
review pinning. Do not add omitted effect dependencies wholesale: some omissions
encode deliberate event semantics. Use existing provider isolation and execution
regressions before changing each boundary.

### F11 — P2: narrow the remaining broad subscriptions where measurements justify it

**Implemented and measured:** a quote-only bridge context keeps chart quotes
idle on candle updates. The ticket header consumes stable environment data and
sizing consumes currency, instead of whole account snapshots. Profiler regressions
changed candle-only chart-quote and balance-only ticket-header render counts from
1 to 0; sizing is also idle on balance changes. Currency and environment changes
still update their relevant consumers. The provider-isolation suite passed 11/11.

**Evidence:** [chart quotes](../../apps/desktop/src/features/chart/ChartQuotes.tsx#L5),
[market context](../../apps/desktop/src/features/bridge/BridgeSessionProvider.tsx#L67),
and [ticket header/sizing](../../apps/desktop/src/features/order-ticket/OrderTicketProvider.tsx#L50).

**Confirmed subscription breadth, impact unmeasured:** `ChartQuotes` only reads
the quote but subscribes to a context also containing candle snapshots,
instrument metadata, loading, and errors. Ticket header and sizing values retain
the entire account snapshot, even though their views use selected fields. The
full runtime lifecycle also receives every update; split view contexts do not
eliminate that orchestration work.

**Proposal:** consider a quote-only bridge context and smaller account-derived
view values. Preserve existing focused contexts and stable values; do not merge
them into one global store for shorter provider JSX. React propagates changed
context values to readers; see [official context semantics](https://react.dev/reference/react/useContext).
React Compiler is already enabled, so measure emitted runtime behavior before
adding manual memoization.

**Validation needed:** extend `provider-isolation.spec.ts` to count the chart
quote consumer on candle-only updates and ticket header/sizing consumers on
irrelevant account updates. Use the existing profiler for subsequent before/after
measurements; development timings are not production latency evidence.

### F12 — P2: reuse money formatting and quote presentation

**Implemented:** chart and ticket consume one pure quote presentation helper,
including precision, formatted sides, spread, and optional points. Ticket view
props contain formatted values and one spread field. A parity table covers no
quote, last-price precision, the precision cap, malformed prices, and missing,
zero, or invalid point size; existing quote UI tests pass. The pulled main had
already delegated P&L formatting to the shared currency-aware formatter, so that
part needed no additional change.

**Evidence:** [P&L formatting](../../apps/desktop/src/features/chart/engine/overlayLines.ts#L40),
[shared signed-money formatter](../../apps/desktop/src/shared/format.ts#L42),
[chart quote derivation](../../apps/desktop/src/features/chart/ChartQuotes.tsx#L6),
and [ticket quote derivation](../../apps/desktop/src/features/order-ticket/OrderTicketProvider.tsx#L70).

**Confirmed duplication:** after checking missing/invalid input, `pnlMoneyText`
repeats the shared formatter's currency formatting, fallback, and sign handling.
Chart and ticket independently derive quote precision and spread. Ticket quote
props also carry both `spread` and `spreadBadge` with the same value.

**Proposal:** retain P&L's input guards and delegate formatting to
`formatSignedMoney`. Share a small pure quote presentation helper if both views
continue to need the same fields. Collapse the duplicated spread prop if the
views do not need separate meanings. A currency-formatter cache is optional;
profile before adding cache management.

**Validation needed:** invalid/missing currency, negative and zero P&L, variable
quote precision, unknown point size. Preserve live P&L's widest-observed column
behavior and account-currency regressions.

### F13 — P2: put shared overlay primitives in a neutral engine module

**Implemented:** shared geometry, colors, row anchors, and drawing helpers now live in `tradingOverlayDrawing.ts`. Staged and live rendering policies remain separate. Overlay layering and gesture regressions pass.

**Evidence:** [live overlay imports](../../apps/desktop/src/features/chart/engine/positionOverlay.ts#L10),
[live quantity tag](../../apps/desktop/src/features/chart/engine/positionOverlay.ts#L229),
and [staged quantity tag](../../apps/desktop/src/features/chart/engine/stagedOrderOverlay.ts#L306).

**Confirmed:** live positions/orders import generic drawing and hit-geometry
primitives from the staged-order renderer. Quantity tags repeat font, measuring,
path, fill, border, and text placement. Shared drawing ownership is therefore
mixed with a specific feature's rendering/state definitions.

**Proposal:** move shared row drawing/geometry helpers to a neutral module in
`features/chart/engine`, and reuse one quantity-tag painter. Keep staged and live
renderers separate: their floating exits, P&L width retention, and interaction
semantics differ. Do not build a universal overlay renderer with many flags.

**Validation needed:** pixel geometry, Retina coordinates, hit rectangles,
collision layout, close buttons, staged/live visual continuity, and overlay order.
Use trading gesture, z-order, and fixed-range profile regressions.

### F14 — P3: simplify the history helper's asynchronous structure carefully

**Implemented:** pending creation is synchronous and the explicit microtask boundary preserves same-turn last-selection dispatch. A/B/A, duplicate, reset, and disposal regressions pass.

**Evidence:** [history request](../../apps/desktop/src/features/chart/engine/mt5DataAdapter.ts#L85)
and [ensurePending](../../apps/desktop/src/features/chart/engine/mt5DataAdapter.ts#L197).

**Confirmed:** `ensurePending` is declared async but contains no await or
asynchronous operation. Its caller has already returned if `existing` is truthy,
yet still uses `existing ?? await ensurePending(...)` and checks pending state
after the resulting microtask boundary.

**Proposal:** make pending creation synchronous, remove the unreachable
coalescing arm, and retain checks that protect real dispatch/session races.
The removed await changes interleaving, so this is not merely deleting a keyword.
Understand simultaneous selection calls before removing generation checks.

**Validation needed:** same-selection deduplication; rapid A/B/A selections;
dispose/reset while a request starts; dispatch rejection; ten-second timeout;
no automatic retry. Avoid simplifying page and window requests into one policy:
they intentionally have different cancellation behavior.

### F15 — P3: derive favorite/recent search presentation once

**Evidence:** [combined-list effect](../../apps/desktop/src/features/symbol-search/SymbolSearchView.tsx#L94)
and [dialog list branches](../../apps/desktop/src/features/symbol-search/SymbolSearchDialog.tsx#L78).

**Confirmed:** with an empty query, an effect stores favorites plus deduplicated
recents in `searchResults`, while JSX separately builds and renders those same
groups. The stored list also determines the Enter-key selection. Three row
branches repeat symbol/description buttons and favorite actions.

**Proposal:** derive the grouped list and first keyboard selection from the
same pure presentation data. Reserve state for actual asynchronous search
results. Extract a small symbol row if it preserves group labels and accessible
favorite wording. The lists are bounded to ten items each, so replacing every
`.some()` with a Map would have little practical value.
React recommends calculating render-derived data directly rather than syncing
another state variable; see [its guidance on unnecessary effects](https://react.dev/learn/you-might-not-need-an-effect).

**Validation needed:** favorites persistence, duplicate recents, Enter with an
empty query, no results, toggling favorites, and recents recorded only after
accepted history.

### F16 — Bug: chart position changes after MT5 reconnect

**Owner report:** exiting MT5 and reconnecting after relaunch restores the
connection but moves the chart to a different point in time.

**Reproduced with the browser stub:** replacing a longer history with a shorter
window and refilling older pages can move a previously viewed candle off-screen.
Disconnect also leaves the older-page request guard active after the adapter's
requests are reset.

**Owner decision:** reconnect should load candles like the initial app load and
reset the chart to the latest bars. Do not preserve the previous historical
viewport or add absolute-time restoration and refill machinery. Keep normal
older-history paging and the existing timeframe-change viewport behavior.
Regression coverage must include reconnect from a panned view, shorter history,
and recovery while an older-page request is pending. Real MT5 relaunch has not
been tested.

**Implementation:** invalidate the accepted history key and clear older-page
request bookkeeping on bridge-session reset. The next accepted history uses the
same end-view reset as initial loading. The shared reset rebuilds time-scale
padding at the default zoom before anchoring the view, and cancels a queued
helper rebuild that could carry over a stale range. `HistoryViewportMode` names
reset and bars-from-end behavior; absolute-time restoration is unnecessary.
The browser regression compares reconnect framing with a fresh app load, checks
real timestamp gaps are preserved, and verifies stale pages cannot refill the
new history. The initial-load comparison failed without key invalidation.

## Additional small cleanups

- [PortfolioCard](../../apps/desktop/src/features/portfolio/PortfolioCard.tsx#L32)
  returns for zero positions, then checks `hasPositions` repeatedly. Remove the
  always-true conditions and flatten the fragment while preserving the account
  condition and eight-row limit.
- [ChartController.setCurrentPrice](../../apps/desktop/src/features/chart/engine/chartController.ts#L318)
  ignores its price and only refreshes overlays. Its caller/comment still implies
  a distinct lighter scheduling path. Call the actual refresh operation and
  update the explanation; do not invent another price owner.
- [priceToTicks](../../apps/desktop/src/features/order-ticket/state/useOrderTicketPricing.ts#L83)
  ignores its `kind` parameter. Remove that parameter and update callers if the
  conversion is intentionally absolute-distance-only.
- [UnitsSizingRow](../../apps/desktop/src/features/order-ticket/editor/UnitsSizingRow.tsx#L177)
  repeats three menu items with the same structure. A local typed three-item
  description can remove repetition; keep focus restoration, keyboard controls,
  and mode-specific copy explicit. This does not justify a new menu library.
- [OrderTicketProvider](../../apps/desktop/src/features/order-ticket/OrderTicketProvider.tsx#L352)
  uses repeated null guards for some hooks and a shared guard for others. Use
  one local convention. Provider factories or generated dependency lists would
  add more abstraction than this cleanup needs.

## What I would preserve

- Separate bridge, account, portfolio, chart identity, and ticket view contexts:
  existing isolation tests make their purpose concrete.
- Imperative chart updates, requestAnimationFrame candle batching, and mutable
  overlay geometry captured by long-lived gesture handlers.
- Broker preview, local projection, accepted check, and display estimate as
  distinct concepts. Combining them could allow an estimate to appear fresh.
- Request generations, account/server/symbol checks, checked-volume echoes,
  queue gates, no automatic retries, and the append-only journal.
- The shared timeframe/transfer configuration and bounded search lists.
- Focus and animation lifetimes. Settings' delayed close and independent draft
  are intentional; deleting those states would change behavior.
- The label collision-placement algorithm. Its mathematics buys a specific
  approved result; it is not complex merely because it is unfamiliar.

## Suggested implementation order for review

1. F01 is resolved by documentation correction; retain the supported removal
   behavior and its existing execution gates.
2. Fix F02, F04, and F05 independently, adding failure-path regressions first.
3. Specify the precision policy for F03 before designing its native boundary.
4. Take local DRY changes: F07, F08, F12, F15, and the small cleanups.
5. Measure F06/F11 on the current baseline. Use that evidence to select one
   narrow subscription or cache improvement.
6. Refactor F09/F10/F13 in separate, bounded steps. Preserve ordering and
   compare behavior after each step. Handle F14 with explicit race tests.

No new dependencies or global state-management framework are recommended.

## Verification and limits

Performed: source and regression-test inspection; protocol cross-checks;
production file/line inventory; clean-working-tree check before review; report
formatting, relative-link checks, and whitespace validation after writing.
Document checks:

- `pnpm --filter better-charts exec prettier --ignore-path /dev/null --check ../../docs/reviews/typescript-react-simplification-review.md`: passed.
- `python3` relative-link/line-reference validation: 47 local links, zero errors
  in the original review.
- `git diff --check`: passed. The follow-up changes documentation and source
  comments only; application behavior and tests are unchanged.
- Follow-up: `cargo fmt --all -- --check` and
  `pnpm --filter better-charts exec prettier --ignore-path /dev/null --check src/features/chart/engine/positionOverlay.ts src/features/execution/useExecutionCommands.ts ../../docs/reviews/typescript-react-simplification-review.md`
  passed. Source diffs were checked to contain only comment changes.

No build, application test suite, profiler, browser session, native Tauri
session, or MetaEditor compilation was run for this document-only task.
No MT5 process or account interaction was started. Performance findings describe
observable code work, not measured frame-rate or latency improvements.

Future implementation should run the repository gates appropriate to each
change. Execution/contract changes require synchronized Rust, TypeScript, EA,
mock, docs, and regression coverage; browser stubs cannot establish live broker
behavior.
