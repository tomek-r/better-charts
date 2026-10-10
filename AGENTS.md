# AGENTS.md

Instructions for agents working in this repository. They apply throughout the
project tree unless a nested directory contains its own `AGENTS.md`.

## Project Purpose

Better Charts is a desktop trading terminal built with React, Lightweight
Charts, Tauri/Rust, and an MQL5 Expert Advisor. The app receives data from
MetaTrader 5 through a local, versioned TCP protocol and has an active order
submission pipeline. The software operates on account state, so execution
safety and contract compatibility take priority over implementation convenience.

## Repository Map and Responsibility Boundaries

- `apps/desktop/src/` — React + TypeScript features, shared UI/contracts, chart
  adapter, and overlays. The frontend does not connect directly to MT5; it uses
  Tauri commands and events.
- `apps/desktop/src-tauri/` — application process, bridge TCP server,
  transport, execution journal, order queue, and MT5 process management.
- `crates/trading-core/` — UI- and OS-independent domain models, validation,
  risk calculations, volume profile, and execution state machine. Do not add
  Tauri, React, or system API dependencies here.
- `mql5/bridge/` — EA running inside MT5; it is the local TCP client and the
  only layer that calls the MT5 trading API.
- `docs/protocol/bridge-v1.md` — EA ↔ Rust contract specification.
- `apps/desktop/e2e/` — Playwright tests run in a browser with the Tauri v2
  stub in `tauriStub.ts`.
- `scripts/` — bridge mock, diagnostic tools, and startup scripts.

Do not bypass these boundaries for convenience. Domain logic shared by
transport and UI belongs in `trading-core`, not a React component or Tauri
handler.

## Sources of Truth

1. Current scope and feature state: `docs/CURRENT_STATE.md`.
2. Intended protocol format and semantics: `docs/protocol/bridge-v1.md`.
   Shared configuration both languages read at compile time — currently the
   timeframes in `config/timeframes.json`, the transfer limits in
   `config/bridge.json`, and the required MQL5 component versions in
   `config/mq5-versions.json` — is contract, not a copy.
3. Current runtime behavior: production code and regression tests.
4. Other architecture and performance notes provide supporting context; check
   their dates and scope before treating them as descriptions of current
   behavior.

If the snapshot, contract, and implementation disagree, do not silently choose
one version. Determine the intended behavior, preserve compatibility, and
synchronize code, tests, and documentation in the same task.

## Absolute Trading-Safety Rules

- Treat every execution change as high risk. Do not accidentally disable,
  bypass, or weaken any of the three dispatch gates: `DISPATCH_ENABLED`,
  handshake `trading_enabled`, and complete reconciliation.
- Do not change `DISPATCH_ENABLED`, retry semantics, queue draining on session
  changes, or the one-in-flight-order rule without explicit task scope and
  regression tests. The system intentionally does not retry commands
  automatically.
- Never automatically start MT5, the EA, or manual order submission flows
  during agent work. Use them only when the user explicitly asks.
- By default use unit tests, the mock, and a demo account. Testing on a real
  account is outside the normal scope and requires explicit user consent.
- `OrderCheck`, risk preview, and reconciliation are observations, not proof
  that an order was not executed. The absence of a broker record cannot by
  itself determine a command's state.
- The journal is append-only and fail-closed. Do not rename or remove stored
  fields or variants without a migration and `SCHEMA_VERSION` update. Replay of
  old journals must remain deterministic.
- Do not log or commit tokens, account data, local captures, `.set` files,
  `.env` files, MT5 logs, or `.ex5` artifacts.

## Protocol Invariants

- Protocol v1 framing: 4-byte big-endian length + UTF-8 JSON; payload size must
  be `1..=1 MiB`.
- Amounts, prices, and volumes remain decimal strings. Do not convert them to
  `f32`/`f64` or silently change their serialization.
- Preserve `request_id`, `session_id`, account binding, and last-wins/stale
  response semantics. Reject data from an old session or symbol.
- A contract change usually requires synchronizing at least:
  `crates/trading-core/src/protocol.rs`, Tauri backend,
  `apps/desktop/src/shared/bridge/types.ts`, MQL5 EA, protocol docs, mock, and E2E
  stubs/tests. Do not stop after updating one layer.
- Prefer additive extensions. Do not silently change existing field names,
  casing, or the meaning of `null`. Follow the serde and TypeScript conventions
  already used at each boundary.

## Working Practices

1. Before editing, read the files directly related to the change, their tests,
   and the relevant section of `docs/protocol/bridge-v1.md`.
2. Check `git status`; preserve user changes and do not format or clean up
   unrelated areas.
3. Make the smallest coherent change. For a bug, first add or strengthen a
   regression test at the lowest sensible layer.
4. For public behavior changes, update the contract, docs, and stubs in the
   same task.
5. Run validation appropriate to the scope. In the summary, list exact
   commands, results, and anything you could not verify.
6. Do not commit while any test fails, including failures reproduced on the
   existing baseline. Do not bypass the pre-commit hook with `--no-verify`,
   `HUSKY=0`, or a hooks-path override, or weaken tests to obtain a passing gate.

Do not add dependencies without a need. If a dependency is necessary, update
the correct manifest and lockfile (`pnpm-lock.yaml` or `Cargo.lock`). Do not
edit generated `target/`, `dist/`, `node_modules/`, `.vite/`, `test-results/`,
`playwright-report/`, or `src-tauri/gen/` directories.

## Implementation Conventions

- Follow `.editorconfig`: 2 spaces by default, 4 in Rust, 3 in MQL5, LF, and a
  final newline.
- TypeScript uses strict mode. Use existing domain types, avoid `any`, keep
  bridge data transformations in the adapter, and keep chart-rendering logic in
  `features/chart/engine/` modules.
- Rust must be `rustfmt`-clean and pass Clippy without warnings. Validate at
  boundaries, use typed errors, and keep state transitions deterministic.
  `unsafe_code` is prohibited at workspace level.
- In MQL5, keep buffers bounded, collection limits in place, and validation
  fail-closed. Do not add DLLs; transport must remain local.
- Comments should explain an invariant or reason, not repeat the code.
- Do not change UI copy/layout marked as an owner decision or chart behavior
  without checking the corresponding E2E tests and latest summary.
- The app version is defined once, in `apps/desktop/package.json`. The Tauri
  config reads that file for the bundle (`"version": "../package.json"`, and
  `src-tauri/build.rs` declares it to cargo so a bump rebuilds), and the UI
  reads it at build time. `apps/desktop/src-tauri/Cargo.toml` must carry the
  same version; the `version_tests` guard in `src-tauri/src/lib.rs` fails until
  it does.

## Validation

The full baseline gate, run from the repository root:

```bash
cargo fmt --all -- --check
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
pnpm check
pnpm build
pnpm test:e2e
python3 -m py_compile scripts/mock_mt5_bridge.py scripts/capture_reconcile_snapshot.py
```

Frontend tooling is enforced with `pnpm check` (typecheck + ESLint + Prettier)
from both workspace levels. During `pnpm dev`, vite-plugin-checker shows
TypeScript and ESLint errors in an overlay. The pre-commit hook (husky +
lint-staged) formats and lints staged files, then runs the full typecheck,
offline Rust workspace tests, browser E2E suite, tick-reader check, and Python
tool self-tests. Any failure aborts the commit.

Python is pinned to 3.12 in `.python-version`. When uv is installed, run the
Python commands as `uv run --no-project python …` (the hook does this and falls
back to `python3`); on Windows `python3` may resolve to the Microsoft Store stub.

Choose the minimum checks appropriate to the change:

- Documentation only: inspect the diff, links, filenames, and consistency with
  the code.
- `trading-core`: `cargo fmt --all -- --check`, the relevant package tests, and
  Clippy; run the full workspace for public type changes.
- Tauri backend/protocol/execution: full Rust gate, frontend build, and
  relevant E2E tests.
- React, CSS, or chart: `pnpm build` and `pnpm test:e2e`.
- Mock/Python scripts: `py_compile` and any relevant self-test.
- MQL5: in addition to Rust/TS checks, compile in MetaEditor with 0 errors / 0
  warnings. If that environment is unavailable, report it explicitly.

Playwright starts Vite on port `1420` and uses the browser Tauri stub. It does
not replace testing in the real Tauri/MT5 runtime. Installing Chromium
(`npx playwright install chromium`) requires network access and is a one-time
environment setup, not part of normal code changes.

## Completion Criteria

A change is ready when it respects architecture boundaries and execution
invariants, includes a regression test for new behavior, synchronizes all
affected contract layers, and passes the appropriate gates. The final report
should be brief and say what changed, what was verified, and any known risk or
missing manual verification.
