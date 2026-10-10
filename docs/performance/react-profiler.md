# React comparison profiler

`pnpm profiler:compare` compares the local `main` checkout with the current
working tree using the same browser scenario. It is useful for checking whether
a React refactor changes which consumers render and how much React work the
scenario performs. It measures development-mode React rendering; it does not
measure production performance or browser paint latency.

## Run a comparison

Install the locked workspace dependencies first. Playwright Chromium must also
be available once for the desktop package:

```sh
pnpm install --frozen-lockfile
pnpm --filter better-charts exec playwright install chromium
pnpm profiler:compare
```

The comparison needs Git, `tar`, and a reachable local `main` ref. It does not
fetch `main`; fetch or update that ref yourself if you want to compare against
a newer remote commit. The candidate snapshot overlays the working tree's
`apps/desktop/src`, `apps/desktop/e2e`, and `config` directories, plus
`apps/desktop/package.json`, `apps/desktop/tsconfig.json`, and
`apps/desktop/index.html`, onto the baseline snapshot. This includes untracked
files in those copied paths.

The profiler loads the browser Tauri stub from the working tree
(`apps/desktop/e2e/helpers/tauriStub.ts`) for both snapshots, so the baseline
snapshot's older `e2e` layout (before the helpers folder existed) does not
matter.

The default run uses five alternating rounds and 40 measured interactions per
scenario, after four warm-up interactions. It profiles quote updates with an
idle ticket, staged Buy Limit entry edits, and GTC/Day settings toggles. The
browser uses the Tauri stub. No MT5 process starts and no orders are submitted.

For a quick smoke run:

```sh
PROFILE_ROUNDS=1 PROFILE_OPERATIONS=4 pnpm profiler:compare
```

The defaults can be changed with these environment variables:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PROFILE_BASE_REF` | `main` | Local Git ref used as the baseline |
| `PROFILE_ROUNDS` | `5` | Alternating measured runs per snapshot |
| `PROFILE_OPERATIONS` | `40` | Measured interactions per scenario and run |
| `PROFILE_PORT_BASE` | `1431` | First of two consecutive free Vite ports; the working snapshot uses the next port |

The command prepares isolated baseline and working-tree snapshots under a
temporary directory, applies React Profiler instrumentation only to those
copies, and starts two Vite servers. Its `finally` cleanup stops the servers
and removes the temporary source copies. The repository source is not modified
for instrumentation. Reports and captured results are local artifacts and must not be committed.
Each run writes `report.html`, `raw.json`, `summary.json`, and
`metadata.json` under an ignored, timestamped directory in `apps/desktop/.react-profiler/`.
The raw file contains per-run profiler samples, the summary contains aggregate
statistics, and the metadata file records revisions and runtime details.

Open `report.html` from the output directory in a browser. It is a standalone
report with timing ranges, consumer commit counts, and capture metadata; it
needs no server or external assets.

To regenerate HTML from saved data:

```sh
node scripts/react-profiler/report.cjs path/to/summary.json path/to/report.html path/to/metadata.json
```

The metadata argument is optional.

## Read the results carefully

The report includes consumer commit counts, whole-app and ticket-scope
`actualDuration`, run ranges, source revisions, and runtime metadata. Compare
the scenario and consumer counts before interpreting timing differences.
Consumer probes count commits at those probes; they do not represent every DOM
element that painted. Whole-app measurements include probe and lifecycle work.
Development mode, instrumentation, and local machine load affect timings, so
overlapping ranges or a small percentage change should not be treated as a
production performance claim.

The existing `pnpm --filter better-charts profiler` command remains a separate
single-snapshot profiler scenario. Use it to inspect a run of the current
working tree. Use `pnpm profiler:compare` to alternate the same interactions
across a baseline snapshot and the working tree.

## Lighthouse (production web build)

`pnpm lighthouse` builds and serves the production bundle, installs the browser
Tauri stub, and runs a Lighthouse desktop-preset performance audit in headless
Chromium. Each run writes `apps/desktop/.lighthouse/<timestamp>-run<N>/report.html` and
`report.json` (folder ignored by Git), with the headline metrics printed. Knobs: `LIGHTHOUSE_OUT`,
`LIGHTHOUSE_RUNS` (median over N runs), `LIGHTHOUSE_CATEGORIES`. Numbers come
from headless Chromium, not the Tauri WebView2 runtime; compare runs with each
other. The harness lives in `apps/desktop/scripts/lighthouse.spec.ts` and never
joins `pnpm test:e2e`.

### Recorded MT5 candles

Without data the stub feeds only 10 synthetic candles, so the audit is
unrealistically light. To replay real candles:

1. In MetaTrader 5 open View -> Symbols (Ctrl+U) -> Bars tab, pick the symbol,
   timeframe and date range, press Request, then Export.
2. Save as `<SYMBOL>_<TIMEFRAME>.csv` (for example `GOLD_M1.csv`; timeframe codes
   as in `config/timeframes.json`) in `captures/lighthouse/` (gitignored), or in
   the directory named by `LIGHTHOUSE_DATA`. Tab or comma separated, UTF-8 or
   UTF-16LE; MT5 server time is read as UTC; OHLC stay exact decimal strings.
   Bad rows abort the run with `file:line`.
3. The app opens the default timeframe (M1), so export that one; set
   `LIGHTHOUSE_SYMBOL` / `LIGHTHOUSE_TIMEFRAME` to choose among several files.

The initial history request is `historyBars` (1000, `config/bridge.json`) and the
audit asserts exactly that many bars were delivered. Older pages are served from
earlier recorded bars; `LIGHTHOUSE_MAX_BARS` (default 20000) caps those extra
bars, and large files are tail-read rather than loaded whole. The data source
(synthetic or files, bar counts) is printed and saved as `meta.json` next to
each report. Live ticks are not simulated.
