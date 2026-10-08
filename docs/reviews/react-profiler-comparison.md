# React profiler comparison — 8 October 2026

The ticket's broad runtime and state facades have been removed. Performance parity with main remains unresolved: changing-price quote updates take 10.9 ms versus 9.2 ms (+18%) in the retained candidate's five-round full-app capture. Entry edits also remain slower. These results do not justify claiming the store migration is faster overall.

## Retained implementation

`useOrderTicketActionsProducer` composes draft, broker, pricing, and sizing commands and returns only actions. Each producer owns its canonical inputs. Error notifications belong to the broker producer; editor state stays with editor consumers.

Lifecycle consumers use focused interfaces for entry synchronization, check invalidation, preview requests, and chart overlays. They read cached canonical domain snapshots and project only the consumer's inputs. Stable chart controls and bridge-response refs/setters are separate dependencies. The old `useOrderTicketRuntime`, `useOrderTicketState`, and their full-ticket types are deleted. Effect registration order, account/session correlation, stale-response handling, review pinning, and dispatch gates are preserved.

## Reproducible comparison

- Baseline: `main`, `e3ec86da4af14f1d6d3998fd9b59999fcd7af1cc`.
- Candidate: `refactor/typescript-react-findings`, HEAD `b47fe04b7af92098f66554ba6ebd4b9989520608` plus captured working changes.
- Candidate source hash: `fe5515fbd1b122d8d0344e273a8ecb7d898b9653e15db07a3cad275de2121376`.
- Production React profiling build, React 19.3.0, compiler enabled, StrictMode disabled; Chromium 153.0.8010.12; viewport 1440 × 1000.
- Five alternating rounds per build. Each run creates a fresh browser context/page: no assets, storage, or app state from the previous run. Browser process, built bundles, and local preview servers are reused. Full-app scenarios share state within each run, in a fixed sequence. Ticket-only runs have four warmup operations.
- Command: `PROFILE_MODE=production PROFILE_SUITE=full PROFILE_ROUNDS=5 pnpm profiler:compare`.
- [Retained full-app report](../../.react-profiler/2026-10-08T16-55-34-307Z/full-report.html), [capture metadata](../../.react-profiler/2026-10-08T16-55-34-307Z/metadata.json).
- [Focused ticket report](../../.react-profiler/2026-10-08T16-48-52-448Z/report.html) is an earlier capture of the focused interfaces with lifecycle field projections, before switching them to cached canonical snapshots. It is not the retained timing capture.

Captures include the owner's working source/style/copy edits. Comparing separate captures is not a controlled estimate of one optimization's effect.

## Full-app results

Values are cumulative root React `actualDuration` milliseconds per phase, median [minimum, maximum] across five rounds. Commit counts are medians, main / candidate. React rendering time excludes browser painting and external-store work outside rendering; see [React Profiler](https://react.dev/reference/react/Profiler).

| Phase | Main ms | Candidate ms | Commits |
| --- | --- | --- | --- |
| startup | 12.1 [11.5, 12.2] | 13.2 [12.8, 13.4] | 5 / 7 |
| idle | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0 / 0 |
| quoteTimeOnly | 10.8 [9.7, 11.3] | 9.2 [8.8, 11.1] | 40 / 40 |
| quotePriceChanging | 9.2 [8.6, 9.9] | 10.9 [10.4, 12.4] | 40 / 40 |
| liveCandle | 3.6 [3.0, 3.8] | 3.4 [3.0, 3.7] | 20 / 20 |
| panelToggles | 0.3 [0.1, 0.7] | 0.4 [0.1, 0.6] | 8 / 8 |
| settingsEdits | 1.7 [1.5, 1.7] | 1.6 [1.4, 2.0] | 12 / 12 |
| toolsCrosshair | 0.4 [0.3, 0.5] | 0.6 [0.5, 0.7] | 3 / 3 |
| ticketStage | 0.7 [0.6, 0.8] | 1.0 [0.5, 1.3] | 6 / 6 |
| ticketEntryEdits | 4.4 [3.7, 5.1] | 5.3 [4.8, 5.7] | 40 / 40 |
| ticketTimeInForce | 4.6 [3.9, 5.4] | 4.6 [4.3, 5.2] | 40 / 20 |
| timeframeSwitches | 0.8 [0.7, 1.0] | 1.1 [1.0, 1.4] | 10 / 10 |
| symbolSearch | 0.6 [0.4, 0.7] | 0.4 [0.4, 0.5] | 4 / 4 |
| reconnect | 0.6 [0.4, 0.8] | 0.7 [0.4, 0.9] | 6 / 6 |

All expected scenario steps completed. Captures reported no browser errors or order submissions. Changing-price quotes still spend more time in AppLifecycle: estimated self duration 3.1 ms on candidate versus 1.2 ms on main. Private Fiber measurements are supporting diagnostics, not public API timing guarantees.

## Pricing and Exits render counts

The ticket probe distinguishes consumer function executions from Profiler boundary callbacks. For 40 entry edits, Pricing and Exits each execute 40 times on both builds. Candidate boundary callbacks remain 80 versus main's 40. A callback also occurs when React visits that boundary while the consumer bails out. Both applications have 80 root commits for this ticket-only sequence; existing draft-version invalidation needs a follow-up commit. In the full-app entry phase, actual Pricing/Exits executions are 20 on both builds for 20 edits.

The boundary counter is retained. Eliminating it by weakening preview invalidation would change behavior. Full-app reports show each build's component list independently, avoiding false “Unavailable” rows from joining unrelated minified names. Missing measurements remain explicitly unavailable; they are never treated as zero.

## Profiling artifacts

Production profiling builds preserve component names and source maps. Bundle directories use the captured commit hash, with `-working` for a dirty candidate: `e3ec86d-bundle` and `b47fe04-working-bundle`. Metadata retains the branch name and full source hash. Maps are beside the JavaScript under each bundle's `assets` directory. Ordinary release build settings are unchanged. See [Vite source maps](https://vite.dev/config/build-options.html#build-sourcemap) and [esbuild keepNames](https://esbuild.github.io/api/#keep-names).

Artifacts are local and ignored by Git. Run `PROFILE_MODE=production PROFILE_SUITE=both PROFILE_ROUNDS=5 pnpm profiler:compare` to regenerate both reports.

## Experiments reviewed

| Experiment | Decision |
| --- | --- |
| Memoize risk basis | Reverted: no reliable improvement. |
| Replace the runtime with an explicit 125-field projection | Removed: preserved the oversized interface. |
| Focus lifecycle inputs while reading cached canonical snapshots | Retained: eliminates full-ticket contracts and repeated shallow projections in the integration coordinator. |
| Cache bridge runtime fragments | Reverted: no reliable improvement. |
| Memoize staged chart display | Reverted: latest capture gave quotes 11.2 ms versus main 8.8 ms; no reliable gain over the retained candidate. |

The latest experimental capture is [17:09](../../.react-profiler/2026-10-08T17-09-42-423Z/full-report.html); it includes the now-reverted chart display memo. The table above intentionally uses the matching retained candidate capture.

## Validation and limits

- `pnpm check`: passed (TypeScript, ESLint, Prettier).
- `pnpm build`: passed.
- `pnpm test:e2e`: 266 passed with the focused interfaces, and again during each final experiment.
- `git diff --check`: passed.
- Unchanged pre-commit gate: passed (offline Rust workspace tests, 266 browser tests, tick-reader validation, Python tool self-tests).
- `node --check` on all six profiler modules, Prettier check, and ticket/full report renderer smoke checks: passed.
- Browser testing uses the Tauri stub; real Tauri/MT5 and live broker interaction were not exercised.

The browser suite covers sizing, review, broker-response correlation, chart gestures, reconnect, scoped provider isolation, and stale previews. Five rounds and small cumulative timings warrant caution; the quote regression remains measurable and requires further investigation.

## structuredClone experiment — 18:08 UTC

Tested cloning the plain draft snapshots after `useStore` in the entry, order-check, risk-preview, and chart lifecycle hooks. This keeps the external-store snapshot stable and leaves refs, setters, commands, and broker-response identities intact. Draft values are primitive scalars or `undefined`. `structuredClone` creates an independent copy; it does not merge objects or preserve their identity ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)).

For this experiment, the baseline is the committed **uncloned refactor**, `31b203ef166facc35547a68e2a693373932541c1`, rather than main. The report's baseline/“main” series represents that commit. The working candidate also contains the owner's previously described edits. Command: `PROFILE_BASE_REF=31b203e PROFILE_MODE=production PROFILE_SUITE=full PROFILE_ROUNDS=5 pnpm profiler:compare`.

[Clone experiment report](../../.react-profiler/2026-10-08T18-08-19-574Z/full-report.html) · [metadata](../../.react-profiler/2026-10-08T18-08-19-574Z/metadata.json). Candidate source hash: `18f0699acb8a58afb584d643f80cb51671401eb2aec3c53751b170729d0390ab`.

| Phase | Uncloned ms | structuredClone ms |
| --- | --- | --- |
| Changing-price quotes | 10.9 [9.9, 11.3] | 12.9 [11.9, 13.3] |
| Timestamp-only quotes | 9.1 [8.4, 9.2] | 10.9 [10.2, 11.4] |
| Entry edits | 5.1 [4.7, 5.4] | 6.1 [5.4, 6.5] |
| Time-in-force edits | 4.3 [4.2, 5.6] | 5.8 [5.2, 6.6] |

Changing-price quotes became 18.3% slower than the uncloned refactor, with non-overlapping ranges. AppLifecycle's estimated self time increased from 3.0 [2.6, 3.8] ms to 4.9 [4.1, 5.3] ms. Root commits and component work counts stayed at 40 for the quote phase. ChartQuotes and OrderTicketQuotes self times were approximately unchanged.

Compiled-bundle inspection shows React Compiler caches entry/check clones by the draft snapshot reference. Preview/chart clones execute on each render. This experiment therefore adds copying work without reducing renders; it is not a remedy for the measured quote regression. The four code changes were reverted. The current source hash again matches the retained 16:55 capture.

`pnpm check`, `pnpm build`, and `pnpm test:e2e` (266 passed) all passed for the clone variant. Every profiling step completed, with no browser errors or order submissions. Browser testing uses the Tauri stub; no real MT5 runtime was started.
