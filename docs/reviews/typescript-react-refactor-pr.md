# Refactor React state boundaries, simplify ticket logic, and fix lifecycle regressions

## Summary

Replace frequently changing Context values with scoped Zustand stores and focused selectors. Contexts retain stable dependencies, while components subscribe to the state they consume. Extract bridge and order-ticket responsibilities into smaller modules and remove the broad ticket state/runtime interfaces.

The changes also:

- Isolate quote-dependent lifecycle effects so initialization, account/check, and bootstrap components remain idle during pure quote updates.
- Share quote presentation, ticket eligibility rules, candle validation, overlay drawing, context guards, and field setters.
- Organize chart hooks into `effects` and `state` folders; adopt React 19 Context syntax and current ref types.
- Fix reconnect history loading, obsolete search/settings responses, partial subscription cleanup, and stale draft reads during consecutive commands.
- Calculate percentage risk budgets with checked Rust decimal arithmetic, preserving sub-cent values.
- Correct documentation for supported live SL/TP removal.
- Extend production profiling with full-app coverage, source maps, component names, and commit-labelled bundles.

## Measurements against main

Compared candidate **`6a15317`** with main **`e3ec86d`** using five alternating production rounds, fresh browser contexts, and 40 quote updates per round. Values below are median cumulative React render times.

| Scenario | Main | Candidate | Change |
| --- | ---: | ---: | ---: |
| Timestamp-only quotes | 10.6 ms | 7.2 ms | **32.1% faster** |
| Changing-price quotes | 8.0 ms | 8.6 ms | **7.5% slower** |
| Live candle updates | 3.2 ms | 2.6 ms | 18.8% faster |
| Entry edits | 4.0 ms | 4.2 ms | 5.0% slower |
| Time-in-force edits | 4.3 ms | 4.6 ms | 7.0% slower |
| Startup | 11.5 ms | 13.0 ms | 13.0% slower |

Timestamp-only ranges do not overlap. Changing-price ranges overlap: main **7.4–8.7 ms**, candidate **8.4–9.0 ms**. The branch does **not** establish overall performance parity with main.

A separate two-round diagnostic recorded identical copy counts in both rounds:

| Per 40 changing-price updates | Main | Candidate |
| --- | ---: | ---: |
| Explicit spread-source evaluations | 520 | 200 |
| Top-level properties copied | 22,720 | 1,640 |
| Application object literals | 2,161 | 3,523 |

Explicit property copying decreased **92.8%**, while object allocations increased. These counters exclude React internals and do not establish the cause of timing differences.

## Validation

- `pnpm check` — passed.
- `pnpm build` — passed.
- `pnpm test:e2e` — **267 passed**.
- Normal pre-commit checks — passed, including offline Rust workspace tests and Python self-tests.
- Profiler comparison — all scenarios completed without browser or observer errors.

## Compatibility and remaining verification

Dispatch gates, reconciliation requirements, and stale-response protections remain intact. The optional percentage-risk input extends desktop commands; the EA wire protocol remains unchanged.

Browser tests and profiling use the Tauri stub. Native Tauri/MT5 verification remains outstanding.
