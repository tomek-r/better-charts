import { test, chromium, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HISTORY_BARS } from '../src/shared/bridge/limits';
import { installTauriStub } from '../e2e/helpers/tauriStub';
import { DEFAULT_MAX_BARS, loadRecordings } from './lighthouseData';

/**
 * Lighthouse audit of the production web build (served by the webServer in
 * `playwright.lighthouse.config.ts`). Asserts nothing about scores; it writes
 * the reports and prints the headline metrics.
 *
 * The app needs Tauri APIs, so the deterministic E2E stub is installed on the
 * browser CONTEXT. Lighthouse drives the same Chromium over its remote
 * debugging port, and the pages it navigates belong to that context, so the
 * init script runs before app scripts. The spec fails if the audited page did
 * not render the dashboard (see `inspectAuditedPage`).
 *
 * Env:
 * - LIGHTHOUSE_OUT        parent output dir (default `.lighthouse/` in apps/desktop)
 * - LIGHTHOUSE_RUNS       number of runs (default 1); with N > 1 the median of
 *                         each metric is printed
 *
 * Output layout: each run gets its own folder under LIGHTHOUSE_OUT, named
 * `<ISO timestamp with - for : and .>-run<N>`, containing `report.html` and
 * `report.json`, e.g. `.lighthouse/2026-10-10T13-17-04-730Z-run3/report.html`.
 * - LIGHTHOUSE_CATEGORIES comma list of categories (default `performance`)
 * - LIGHTHOUSE_DATA       directory of recorded MT5 bars (default `captures/lighthouse/`
 *                         at the repo root; `captures/` is gitignored)
 * - LIGHTHOUSE_MAX_BARS   older bars kept beyond the initial HISTORY_BARS window, per
 *                         file (default 20000); large exports are tail-read, never loaded whole
 * - LIGHTHOUSE_SYMBOL / LIGHTHOUSE_TIMEFRAME  pick the primary recording the app
 *                         opens (default: the app's default timeframe, else the first file)
 *
 * Recorded data: without it the stub feeds 10 synthetic candles, which makes
 * the audit unrealistically light. To replay real candles, export them from
 * MetaTrader 5: View -> Symbols (Ctrl+U) -> Bars tab -> pick the symbol,
 * timeframe and date range -> Request -> Export. Save each file as
 * `<SYMBOL>_<TIMEFRAME>.csv` (e.g. `EURUSD_M5.csv`, wire timeframe codes from
 * config/timeframes.json) into LIGHTHOUSE_DATA. Tab/comma separated, UTF-8 or
 * UTF-16LE, MT5 server time read as UTC; OHLC are kept as exact strings. Bad
 * rows fail the run with file:line. The stub serves the most recent
 * HISTORY_BARS (config/bridge.json) as the app asks, then older pages until
 * the file is exhausted. The data source is printed and written to `meta.json`
 * next to each report. Not mimicked: live ticks/quotes after load.
 *
 * NOTE the app opens ONE timeframe on start (the default in config/timeframes.json,
 * M1) and only that file's depth is exercised unless the timeframe is switched.
 * Without LIGHTHOUSE_TIMEFRAME the default timeframe's file is the primary; if
 * the primary is not the pair the app requests, the run fails loudly.
 */

const METRICS = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS'],
  ['speed-index', 'Speed Index'],
  ['interactive', 'TTI'],
] as const;

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => res(port));
    });
  });
}

interface AuditedPage {
  stub: boolean;
  deliveredBars: number;
  requestedBars: number | null;
  requestedKey: string | null;
  dashboard: boolean;
  chartCanvas: boolean;
  canvases: number;
}

/** Evidence that the audited document ran with the Tauri stub and drew a chart. */
async function inspectAuditedPage(page: Page): Promise<AuditedPage> {
  const chartCanvas = await page
    .waitForSelector('.chart-frame canvas', { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  return page
    .evaluate(() => ({
      stub: '__E2E_TAURI_STUB__' in window,
      dashboard: document.querySelector('main.dashboard') !== null,
      canvases: document.querySelectorAll('.chart-frame canvas').length,
      ...(() => {
        const stub = (
          window as unknown as {
            __E2E_TAURI_STUB__?: {
              invocations: Array<{ cmd: string; args: { symbol?: string; timeframe?: string; bars?: number } }>;
              deliveries: Array<{ event: string; candles: number }>;
            };
          }
        ).__E2E_TAURI_STUB__;
        const request = stub?.invocations.find((i) => i.cmd === 'request_history');
        return {
          deliveredBars: stub?.deliveries.find((d) => d.event === 'market-snapshot')?.candles ?? 0,
          requestedBars: request?.args.bars ?? null,
          requestedKey: request ? `${request.args.symbol}_${request.args.timeframe}` : null,
        };
      })(),
    }))
    .then((state) => ({ ...state, chartCanvas }))
    .catch(() => ({
      stub: false,
      dashboard: false,
      chartCanvas: false,
      canvases: 0,
      deliveredBars: 0,
      requestedBars: null,
      requestedKey: null,
    }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fmt(id: string, value: number): string {
  if (id === 'cumulative-layout-shift') {
    return value.toFixed(3);
  }
  return `${Math.round(value)} ms`;
}

test('lighthouse production audit', async ({ baseURL }) => {
  const url = baseURL ?? 'http://127.0.0.1:4173';
  const outDir = resolve(process.env.LIGHTHOUSE_OUT ?? join(process.cwd(), '.lighthouse'));
  const runs = Math.max(1, Number(process.env.LIGHTHOUSE_RUNS ?? 1) || 1);
  const categories = (process.env.LIGHTHOUSE_CATEGORIES ?? 'performance')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  mkdirSync(outDir, { recursive: true });

  const dataDir = resolve(process.env.LIGHTHOUSE_DATA ?? join(process.cwd(), '..', '..', 'captures', 'lighthouse'));
  // MAX_BARS counts the older bars beyond the initial HISTORY_BARS window.
  const maxBars = HISTORY_BARS + (Number(process.env.LIGHTHOUSE_MAX_BARS) || DEFAULT_MAX_BARS);
  const recordings = loadRecordings(dataDir, process.env.LIGHTHOUSE_SYMBOL, process.env.LIGHTHOUSE_TIMEFRAME, maxBars);
  const primary = recordings.history[0];
  const source = primary
    ? {
        kind: 'files' as const,
        dir: dataDir,
        maxBars,
        primary: `${primary.symbol}_${primary.timeframe}`,
        recordings: recordings.history.map((h) => ({
          symbol: h.symbol,
          timeframe: h.timeframe,
          bars: h.candles.length,
        })),
      }
    : { kind: 'synthetic' as const, dir: dataDir, primary: 'EURUSD_M5', recordings: [] };
  console.log(
    primary
      ? `data source: recorded files in ${dataDir} -> ${source.recordings.map((r) => `${r.symbol}_${r.timeframe}=${r.bars} bars (cap ${maxBars})`).join(', ')}; primary ${source.primary}`
      : `data source: SYNTHETIC (10 candles); no *.csv in ${dataDir}`,
  );

  const port = await freePort();
  const profileDir = mkdtempSync(join(tmpdir(), 'bc-lighthouse-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    args: [`--remote-debugging-port=${port}`],
    viewport: { width: 1350, height: 940 },
  });
  try {
    await installTauriStub(context, { recordedHistory: recordings.history, recordedSnapshotBars: HISTORY_BARS });

    // Lighthouse navigates a page of this context (a persistent context is the
    // browser's default context, which is where its CDP target lives). Record
    // what the audited document actually contained, once it has loaded.
    const proofs: Promise<AuditedPage>[] = [];
    context.on('page', (page) => {
      page.on('load', () => {
        if (page.url().startsWith(url)) {
          proofs.push(inspectAuditedPage(page));
        }
      });
    });

    const { default: lighthouse } = await import('lighthouse');
    const { default: desktopConfig } = await import('lighthouse/core/config/desktop-config.js');

    const samples: Record<string, number[]> = {};
    const scores: number[] = [];
    for (let run = 1; run <= runs; run += 1) {
      const result = await lighthouse(
        url,
        { port, output: ['html', 'json'], onlyCategories: categories, logLevel: 'error' },
        desktopConfig,
      );
      if (!result) {
        throw new Error('Lighthouse returned no result');
      }
      const lhr = result.lhr;
      const attempts = await Promise.all(proofs.splice(0));
      const audited = attempts.find((a) => a.stub && a.dashboard && a.chartCanvas) ?? attempts.at(-1);
      if (!audited?.stub || !audited.dashboard || !audited.chartCanvas) {
        throw new Error(`Audited page did not render the stubbed app: ${JSON.stringify(audited)}`);
      }
      console.log(
        `  audited page: stub=${audited.stub} dashboard=${audited.dashboard} chart canvases=${audited.canvases} ` +
          `requested=${audited.requestedKey} x${audited.requestedBars} delivered=${audited.deliveredBars} bars`,
      );
      if (primary) {
        // The app asks for the first view's window (`initialHistoryBars`), not a whole page.
        const requested = audited.requestedBars ?? 0;
        const expected = Math.min(primary.candles.length, requested);
        if (
          audited.requestedKey !== source.primary ||
          requested < 1 ||
          requested > HISTORY_BARS ||
          audited.deliveredBars !== expected
        ) {
          throw new Error(
            `Recorded data not replayed: app requested ${audited.requestedKey}, delivered ${audited.deliveredBars} bars; ` +
              `expected ${source.primary} with ${expected}. The app opens the default timeframe (M1) of its symbol: export that file (e.g. EURUSD_M1.csv).`,
          );
        }
      }
      if (lhr.runtimeError) {
        throw new Error(`Lighthouse runtime error: ${lhr.runtimeError.message}`);
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const runDir = join(outDir, `${stamp}-run${run}`);
      mkdirSync(runDir, { recursive: true });
      const [html, json] = result.report as string[];
      writeFileSync(join(runDir, 'report.html'), html!);
      writeFileSync(join(runDir, 'report.json'), json!);
      writeFileSync(
        join(runDir, 'meta.json'),
        `${JSON.stringify({ source, app: { requested: audited.requestedKey, requestedBars: audited.requestedBars, deliveredBars: audited.deliveredBars, canvases: audited.canvases } }, null, 2)}
`,
      );

      const perf = lhr.categories.performance?.score;
      if (perf != null) {
        scores.push(perf * 100);
      }
      const line = [`run ${run}/${runs}`];
      if (perf != null) {
        line.push(`performance ${Math.round(perf * 100)}`);
      }
      for (const [id, label] of METRICS) {
        const value = lhr.audits[id]?.numericValue;
        if (value == null) {
          continue;
        }
        (samples[id] ??= []).push(value);
        line.push(`${label} ${fmt(id, value)}`);
      }
      console.log(line.join(' | '));
      console.log(`  report: ${join(runDir, 'report.html')}\n  json:   ${join(runDir, 'report.json')}`);
    }

    if (runs > 1) {
      const line = [`median of ${runs}`];
      if (scores.length) {
        line.push(`performance ${Math.round(median(scores))}`);
      }
      for (const [id, label] of METRICS) {
        const values = samples[id];
        if (values?.length) {
          line.push(`${label} ${fmt(id, median(values))}`);
        }
      }
      console.log(line.join(' | '));
    }
  } finally {
    await context.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
