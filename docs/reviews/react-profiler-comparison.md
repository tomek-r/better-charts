# React profiler comparison — 8 October 2026

The lifecycle coordinator now passes explicit non-quote props to ordered child components. During pure changing-price quote updates, the coordinator, initialization, account/check/reset, and bootstrap/gesture children do no render work; the four quote-dependent children remain live. Against the previous branch commit, timestamp-only quotes improve from 8.9 to 7.3 ms with non-overlapping ranges. Performance parity with main remains unproven: changing-price quote medians are 8.9 versus 7.9 ms (+12.7%), with overlapping ranges.

## Retained implementation

`useOrderTicketActionsProducer` composes draft, broker, pricing, and sizing commands and returns only actions. Each producer owns its canonical inputs. Error notifications belong to the broker producer; editor state stays with editor consumers.

Lifecycle consumers use focused interfaces for entry synchronization, check invalidation, preview requests, and chart overlays. They read cached canonical domain snapshots and project only the consumer's inputs. Stable chart controls and bridge-response refs/setters are separate dependencies. The old `useOrderTicketRuntime`, `useOrderTicketState`, and their full-ticket types are deleted. Effect registration order, account/session correlation, stale-response handling, review pinning, and dispatch gates are preserved.

## Reproducible comparison

- Baseline: `main`, `e3ec86da4af14f1d6d3998fd9b59999fcd7af1cc`.
- Candidate: `refactor/typescript-react-findings`, HEAD `9b0bc7d` plus captured lifecycle-boundary working changes.
- Candidate source hash: `b966e7cf7d84a533a914690cbaba67e5a2eb13167ff4eb97eca03a3173785a48`.
- Production React profiling build, React 19.3.0, compiler enabled, StrictMode disabled; Chromium 153.0.8010.12; viewport 1440 × 1000.
- Five alternating rounds per build. Each run creates a fresh browser context/page: no assets, storage, or app state from the previous run. Browser process, built bundles, and local preview servers are reused. Full-app scenarios share state within each run, in a fixed sequence. Ticket-only runs have four warmup operations.
- Command: `PROFILE_MODE=production PROFILE_SUITE=full PROFILE_ROUNDS=5 pnpm profiler:compare`.
- Focused ticket report is an earlier capture of the focused interfaces with lifecycle field projections, before switching them to cached canonical snapshots. It is not the retained timing capture.

The candidate includes the owner's source/style/copy edits, committed in 9b0bc7d; the direct previous-branch comparison includes them on both sides. Comparing separate captures is not a controlled estimate of one optimization's effect.

## Full-app results

Values are cumulative root React `actualDuration` milliseconds per phase, median [minimum, maximum] across five rounds. Commit counts are medians, main / candidate. React rendering time excludes browser painting and external-store work outside rendering; see [React Profiler](https://react.dev/reference/react/Profiler).

| Phase | Main ms | Candidate ms | Commits |
| --- | --- | --- | --- |
| startup | 11.8 [11.6, 12.0] | 13.4 [13.2, 13.5] | 5 / 7 |
| idle | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0 / 0 |
| quoteTimeOnly | 10.1 [9.7, 10.4] | 7.8 [6.9, 7.9] | 40 / 40 |
| quotePriceChanging | 7.9 [6.4, 8.8] | 8.9 [7.6, 9.1] | 40 / 40 |
| liveCandle | 3.3 [2.7, 3.4] | 2.7 [2.2, 3.1] | 20 / 20 |
| panelToggles | 0.4 [0.2, 0.4] | 0.5 [0.3, 0.6] | 8 / 8 |
| settingsEdits | 1.6 [1.4, 2.1] | 1.9 [1.4, 2.0] | 12 / 12 |
| toolsCrosshair | 0.4 [0.3, 0.6] | 0.7 [0.6, 1.0] | 3 / 3 |
| ticketStage | 0.7 [0.4, 0.8] | 1.0 [0.9, 1.1] | 6 / 6 |
| ticketEntryEdits | 4.3 [3.9, 5.0] | 4.1 [3.6, 4.9] | 40 / 40 |
| ticketTimeInForce | 4.3 [3.8, 5.1] | 4.6 [4.2, 5.2] | 40 / 20 |
| timeframeSwitches | 0.8 [0.6, 1.3] | 0.9 [0.6, 1.0] | 10 / 10 |
| symbolSearch | 0.5 [0.3, 0.5] | 0.5 [0.3, 0.6] | 4 / 4 |
| reconnect | 0.5 [0.3, 0.6] | 0.6 [0.6, 0.8] | 6 / 6 |

All expected scenario steps completed. Captures reported no browser errors or order submissions. The previous AppLifecycle quote cost is now attributed to four quote-aware children; the coordinator and three non-quote children remain idle. These are private Fiber diagnostics supporting the unchanged root Profiler measurements. Component-count sums are not directly comparable after splitting one component into multiple boundaries.

## Pricing and Exits render counts

The ticket probe distinguishes consumer function executions from Profiler boundary callbacks. For 40 entry edits, Pricing and Exits each execute 40 times on both builds. Candidate boundary callbacks remain 80 versus main's 40. A callback also occurs when React visits that boundary while the consumer bails out. Both applications have 80 root commits for this ticket-only sequence; existing draft-version invalidation needs a follow-up commit. In the full-app entry phase, actual Pricing/Exits executions are 20 on both builds for 20 edits.

The boundary counter is retained. Eliminating it by weakening preview invalidation would change behavior. Full-app reports show each build's component list independently, avoiding false “Unavailable” rows from joining unrelated minified names. Missing measurements remain explicitly unavailable; they are never treated as zero.

## Profiling artifacts

Production profiling builds preserve component names and source maps. Bundle directories use the captured commit hash, with `-working` for a dirty candidate: `e3ec86d-bundle` and `9b0bc7d-working-bundle`. Metadata retains the branch name and full source hash. Maps are beside the JavaScript under each bundle's `assets` directory. Ordinary release build settings are unchanged. See [Vite source maps](https://vite.dev/config/build-options.html#build-sourcemap) and [esbuild keepNames](https://esbuild.github.io/api/#keep-names).

Artifacts are local and ignored by Git. Run `PROFILE_MODE=production PROFILE_SUITE=both PROFILE_ROUNDS=5 pnpm profiler:compare` to regenerate both reports.

## Experiments reviewed

| Experiment | Decision |
| --- | --- |
| Memoize risk basis | Reverted: no reliable improvement. |
| Replace the runtime with an explicit 125-field projection | Removed: preserved the oversized interface. |
| Focus lifecycle inputs while reading cached canonical snapshots | Retained: eliminates full-ticket contracts and repeated shallow projections in the integration coordinator. |
| Cache bridge runtime fragments | Reverted: no reliable improvement. |
| Memoize staged chart display | Reverted: latest capture gave quotes 11.2 ms versus main 8.8 ms; no reliable gain over the retained candidate. |

The 17:09 experimental capture includes the now-reverted chart display memo. Later experiments are recorded below; the table above describes the latest lifecycle-boundary capture. The earlier retained 16:55 capture measured 10.9 versus 9.2 ms for changing-price quotes; comparing its timing with a later capture cannot isolate the command change from run-to-run variation.

## Validation and limits

- `pnpm check`: passed (TypeScript, ESLint, Prettier).
- `pnpm build`: passed.
- `pnpm test:e2e`: 267 passed with the lifecycle boundaries; earlier captures used 266 tests.
- `git diff --check`: passed.
- Unchanged pre-commit gate: passed (offline Rust workspace tests, 266 browser tests, tick-reader validation, Python tool self-tests).
- `node --check` on all six profiler modules, Prettier check, and ticket/full report renderer smoke checks: passed.
- Browser testing uses the Tauri stub; real Tauri/MT5 and live broker interaction were not exercised.

The browser suite covers sizing, review, broker-response correlation, chart gestures, reconnect, scoped provider isolation, and stale previews. Five rounds and small cumulative timings warrant caution; quote parity remains unresolved and requires further investigation.

## structuredClone experiment — 18:08 UTC

Tested cloning the plain draft snapshots after `useStore` in the entry, order-check, risk-preview, and chart lifecycle hooks. This keeps the external-store snapshot stable and leaves refs, setters, commands, and broker-response identities intact. Draft values are primitive scalars or `undefined`. `structuredClone` creates an independent copy; it does not merge objects or preserve their identity ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)).

For this experiment, the baseline is the committed **uncloned refactor**, `31b203ef166facc35547a68e2a693373932541c1`, rather than main. The report's baseline/“main” series represents that commit. The working candidate also contains the owner's previously described edits. Command: `PROFILE_BASE_REF=31b203e PROFILE_MODE=production PROFILE_SUITE=full PROFILE_ROUNDS=5 pnpm profiler:compare`.

Clone experiment candidate source hash: `18f0699acb8a58afb584d643f80cb51671401eb2aec3c53751b170729d0390ab`.

| Phase | Uncloned ms | structuredClone ms |
| --- | --- | --- |
| Changing-price quotes | 10.9 [9.9, 11.3] | 12.9 [11.9, 13.3] |
| Timestamp-only quotes | 9.1 [8.4, 9.2] | 10.9 [10.2, 11.4] |
| Entry edits | 5.1 [4.7, 5.4] | 6.1 [5.4, 6.5] |
| Time-in-force edits | 4.3 [4.2, 5.6] | 5.8 [5.2, 6.6] |

Changing-price quotes became 18.3% slower than the uncloned refactor, with non-overlapping ranges. AppLifecycle's estimated self time increased from 3.0 [2.6, 3.8] ms to 4.9 [4.1, 5.3] ms. Root commits and component work counts stayed at 40 for the quote phase. ChartQuotes and OrderTicketQuotes self times were approximately unchanged.

Compiled-bundle inspection shows React Compiler caches entry/check clones by the draft snapshot reference. Preview/chart clones execute on each render. This experiment therefore adds copying work without reducing renders; it is not a remedy for the measured quote regression. The four code changes were reverted. After that experiment, the source hash again matched the retained 16:55 capture; later changes are recorded below.

`pnpm check`, `pnpm build`, and `pnpm test:e2e` (266 passed) all passed for the clone variant. Every profiling step completed, with no browser errors or order submissions. Browser testing uses the Tauri stub; no real MT5 runtime was started.

## Shallow-copy and allocation audit — 19:05 UTC

The candidate performs more explicit spread-source evaluations but copies far fewer top-level properties than main. Additional selector comparisons and their temporary allocations are a stronger lead than the amount of data copied by spreads. This is allocation-count evidence, not proof of the timing cause.

Temporary Vite diagnostics instrumented application object literals, spread sources, and Object.assign source arguments **after React Compiler**. A second pass also counted the installed Zustand shallow comparator, Object.entries results, and Map construction. All diagnostics lived under `/tmp` and isolated profiler snapshots; application files and installed dependencies were not edited. Compiler-generated cache branches remain before the counters. Counter overhead makes the resulting timing report unsuitable for performance comparisons.

Two alternating rounds per build replayed 40 changing-price quotes. Baseline: main `e3ec86da4af14f1d6d3998fd9b59999fcd7af1cc`. That candidate source hash matches the earlier retained 16:55 capture. The following counts were identical across both rounds for each build:

| Executed during 40 changing-price quotes | Main | Candidate |
| --- | ---: | ---: |
| Explicit spread-source evaluations in application code | 520 | 640 |
| Enumerable top-level properties read by those spreads | 22,720 | 3,200 |
| Application object-literal evaluations, excluding chart engine and profiler probes | 2,081 | 2,243 |
| Zustand shallow-comparator calls | 0 | 960 |
| Object.entries result arrays inside that comparator | 0 | 1,760 |
| Key/value pair arrays produced by those Object.entries calls | 0 | 10,400 |
| Map constructions inside that comparator | 0 | 1,760 |

Spread sources per quote increase from 13 to 16 (+23%); copied properties decrease about 86%. These counts track explicit source spreads, rather than every implicit React/library copy. Object literals include JSX props and field projections, which are allocations rather than clones. Object-rest copies in function parameters, React internals, and other dependency allocations are outside this coverage. No explicit application Object.assign source evaluations occurred in this phase. Nested candles, account objects, and arrays are referenced by spreads, not recursively cloned.

The source-level bridge hotspot is `useBridgeSessionRuntime`: it merges 11 sources on every quote render, copying 39 properties. That contributes 440 source evaluations / 1,560 properties over 40 quotes, whereas main returns its context object directly. Candidate actions add four sources / 18 properties per quote; the derivation-cache input copy adds one source / 23 properties. Main's removed broad ticket composer alone copies 21,760 properties across 440 spread-source evaluations.

Candidate quote presentation creates 240 three-field selector projections across the two mounted quote consumers (six evaluations per quote combined). Other grouped selectors contribute additional projections and shallow comparisons. The installed Zustand comparator uses Object.entries and Maps to compare plain objects, including equal projections that are later discarded. This can cost allocation and comparison time even when no extra render occurs. Uninstrumented profiles still identify AppLifecycle and ChartQuotes as the largest regression contributors; a focused experiment reducing repeated selector projections/comparisons is needed to establish causality.

Copy/selector counters were captured at 19:05 UTC; earlier application-only counters were captured at 19:03 UTC. All scenario steps completed with no browser errors, observer errors, or order submissions. The experiment uses the browser Tauri stub and does not start MT5.


## Selector-cache and native subscription experiments — 19:16–19:44 UTC

The suggested [DEV article](https://dev.to/devgrana/avoid-performance-issues-when-using-zustand-12ee) warns about fresh object selectors and recommends scalar selections or useShallow. Grouped selectors here already use useShallow. The [Medium article](https://philipp-raab.medium.com/zustand-state-management-a-performance-booster-with-some-pitfalls-071c4cbee17a) highlights the cost of selectors and equality checks even when they prevent renders. The installed Zustand 5.0.15 React hook already delegates to React useSyncExternalStore; a native adapter changes projection/getter overhead rather than React's subscription mechanism. Immutable cached snapshots and Object.is comparison follow the [React contract](https://react.dev/reference/react/useSyncExternalStore).

| Experiment | Baseline | Changing-price quotes, baseline → experiment ms | Decision |
| --- | --- | --- | --- |
| Explicit bid/ask/last reference cache | Committed refactor d4ccbff | 10.9 [9.8, 11.6] → 11.0 [10.3, 11.2] | Reverted; neutral |
| Producer snapshot cache inside useShallow | Committed refactor d4ccbff | 10.5 [9.5, 12.0] → 11.1 [10.2, 11.6] | Replaced; neutral and outer comparator still repeated work |
| Stable producer cache keyed by snapshot and selector identity | Main e3ec86d | 8.7 [8.1, 9.2] → 10.1 [9.3, 11.3] | Superseded by native experiment; no controlled improvement estimate |
| Native useSyncExternalStore plus the same bounded cache | Committed refactor d4ccbff | 10.3 [9.3, 11.7] → 9.6 [7.8, 10.0] | Timing improvement inconclusive; ranges overlap |
| Same native adapter | Main e3ec86d | 8.2 [7.0, 8.8] → 9.5 [9.3, 10.0] | Still 15.9% slower than main; reverted |

Each timing comparison uses five alternating rounds, production profiling builds, and fresh browser contexts. Four of five native rounds were faster than the corresponding refactor round; this small sample does not establish reliable latency improvement. The native adapter preserved all five focused producer selections, per-consumer cache ownership, store identity changes, selector changes with captured props, shallow-equivalent output identity, and the server's initial snapshot. No full-state subscriptions were added.

Native versus main also measured timestamp-only quotes at 9.7 [9.3, 10.4] → 8.9 [8.0, 9.5] ms; entry edits at 4.3 [4.2, 4.6] → 4.7 [4.1, 5.1] ms; time-in-force edits at 4.5 [4.2, 5.4] → 4.7 [4.3, 5.5] ms. Quote root commits remained 40 per build.

Temporary allocation diagnostics confirmed that the native cache reduced shallow-comparator calls from 960 to 640 per 40 changing-price quotes, Object.entries result arrays and Map constructions from 1,760 to 1,120 each, and generated entry-pair arrays from 10,400 to 4,800. Counts repeated exactly in both rounds. These are comparisons with the earlier counter capture, not instrumented timing claims. Application spread counts stayed at 640 sources / 3,200 properties. The reduction demonstrates avoidable comparator work, but does not establish it as the whole quote regression. The custom helper and its producer changes were removed in favor of testing a simpler subscription reduction.

The state-shape audit found 24 flat ticket-draft fields, 10 broker fields, and two editor fields. Bridge stores already separate connection (two fields), market (seven), quote, account, and portfolio. The quote payload has eight fields. Shallow equality compares top-level references; it does not recursively inspect candles, account objects, or portfolio arrays. Whole-quote subscriptions in AppLifecycle and OrderTicketProvider still receive every accepted quote. Making the payload smaller while keeping the same subscription scope would not eliminate that work. Callback-only producer subscriptions are a smaller target: they can read current draft values when commands run.

Local captures cover quote cache, cache inside useShallow, stable cache versus main, native versus refactor, native versus main, and native allocation counters. Native source hash: 1441b7eb3627cc02f2799f7d6af8ea0b3fe9d718171b7d5493dda936a4c443af.

For the native variant, pnpm check and pnpm build passed without lint warnings; pnpm test:e2e passed all 266 tests. Browser/profiler runs reported no errors or order submissions. All testing used the Tauri stub.


## Retained command-only subscription removal — 19:51 UTC

Draft and sizing producers no longer subscribe to state that they use only inside commands. Their commands read the current canonical draft at invocation. Staging passes one captured draft to its stop-loss helper, while side switching stages after its synchronous reset. Pricing effects, broker derivation/submission handlers, store boundaries, and lifecycle effect order are unchanged. No custom selector cache remains.

A regression runs multiple sizing commands in one event before React rerenders: switch to equity, enter 150, switch to money, enter 50, and switch to units. The previous implementation reads stale units mode, returning `150:units:50`; the fix returns `100:units:` (equity clamped to 100, units clears risk). The new test failed against HEAD in an isolated temporary archive and passes with the fix.

The 19:51 five-round comparison measured changing-price quotes 13.9% slower than main, with non-overlapping ranges. This is retained for the demonstrated correctness fix and removal of unnecessary subscriptions; it does not establish full performance parity. Separate earlier captures cannot establish a causal timing improvement.

A two-round allocation audit found the following counts per 40 changing-price updates; counts repeated exactly in both rounds:

| Candidate operation | Previous retained candidate | Current candidate |
| --- | ---: | ---: |
| Application object literals, excluding chart engine and profiler probes | 2,243 | 2,083 |
| Shallow-comparator calls | 960 | 800 |
| Object.entries result arrays | 1,760 | 1,440 |
| Entry-pair arrays | 10,400 | 8,160 |
| Map constructions | 1,760 | 1,440 |

Both command-only draft projections disappear. Spread counts remain 640 sources / 3,200 top-level properties. Main remains at zero Zustand comparisons/Map constructions in this phase. Instrumented timings are not used. Counters were recorded in the local capture.

Validation: pnpm check, pnpm build, pnpm test:e2e (266 passed), and git diff --check pass. An initial browser run hit a Vite checker warning caused by a callback's closure-based type query; using the canonical OrderTicketDraftStore type resolved it without a suppression. Browser and profiler captures report no errors or order submissions. Only the browser Tauri stub was exercised.


## Explicit lifecycle child props — 20:14–20:15 UTC

AppLifecycle now owns non-quote bridge state, execution state, stable ticket controls/actions, and shared account refs. It passes focused session projections into seven ordered sibling components in lifecycle/AppLifecycleEffects.tsx. It contains no effects itself. Only portfolio-stream, chart-market, ticket-entry, and preview/mirror children subscribe to quotes. Initialization, account/check/reset, and bootstrap/gesture children receive non-quote props. No new store, selector cache, provider, or blanket memo wrapper was introduced; React Compiler retains stable child props.

Effect groups keep their original order. The first child's mounted flag updates before bootstrap; the account refs mirror before bootstrap registration. Chart initialization, OrderCheck layout reset, callback-ref layout refreshes, and chart symbol/timeframe layout resets precede the final staged-overlay mirror. Effect callbacks, listener order, cleanup functions, broker acceptance guards, and dispatch gates are unchanged. Check/reset children still respond when a quote-driven entry update changes the canonical draft.

Every candidate round recorded the following executions during 40 changing-price quote updates:

| Boundary | Executions |
| --- | ---: |
| AppLifecycle coordinator | 0 |
| Initialization | 0 |
| Account/check/reset | 0 |
| Bootstrap/gestures | 0 |
| Portfolio stream | 40 |
| Chart market | 40 |
| Ticket entry | 40 |
| Ticket preview/mirror | 40 |

All eight components were observed during startup. The quote phase has complete Fiber timing coverage and no observer errors; the four idle components are absent from performed work rather than unavailable timers. Both builds retain 40 root commits in the quote phase. Counts describe boundary isolation, not a claim that four child executions equal four times the old combined effect work.

The main comparison is the table above. A second five-round alternating comparison used the previous branch commit, 9b0bc7d, as the baseline (the report's baseline/“main” series represents that commit):

| Phase | Previous branch ms | Child boundaries ms |
| --- | --- | --- |
| Changing-price quotes | 9.6 [8.9, 10.2] | 8.3 [7.9, 9.2] |
| Timestamp-only quotes | 8.9 [8.5, 9.2] | 7.3 [6.7, 7.6] |
| Entry edits | 5.0 [4.2, 5.2] | 3.9 [3.6, 4.4] |
| Time-in-force edits | 5.0 [4.3, 5.1] | 5.1 [3.9, 5.4] |

Changing-price quote medians decrease 13.5% versus the prior branch, but ranges overlap. Timestamp-only quotes decrease 18.0%, with non-overlapping ranges. This change is retained for the demonstrated render isolation and timestamp improvement; it does not establish full parity with main. No benchmark instrumentation or thresholds changed.

Commands: PROFILE_MODE=production PROFILE_SUITE=full PROFILE_ROUNDS=5 pnpm profiler:compare; PROFILE_BASE_REF=9b0bc7d PROFILE_MODE=production PROFILE_SUITE=full PROFILE_ROUNDS=5 pnpm profiler:compare. Both captures use the same candidate source hash listed above.

Validation: pnpm check, pnpm build, pnpm test:e2e (267 passed), and git diff --check pass. New assertions guard zero quote renders in the lifecycle input projection and fresh status/account/market updates; the existing broad runtime projection remains live. Initial ref-mutation lint warnings were resolved using typed, destructured refs, without suppressions. All profiling steps completed with no browser errors, observer errors, or submissions. Real Tauri/MT5 was not exercised.
