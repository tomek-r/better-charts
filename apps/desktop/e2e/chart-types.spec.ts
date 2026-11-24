import { expect, test, type Page } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { chartTypeAppearanceOf } from '../src/features/chart/engine/barStyle/chartTypeAppearance';
import { barStyleAppearanceOf } from '../src/features/chart/chartSettings/barStyleAppearanceSetting';
import type { BarStyleSettingValues } from '../src/features/chart/chartSettings/chartSettings';
import { chartTypeCandles } from '../src/features/chart/chartTypes/chartTypeCandles';
import type { ChartTypeBar } from '../src/features/chart/chartTypes/chartTypeCommands';
import { chartTypeSpecOf, decimalSetting } from '../src/features/chart/chartTypes/chartTypeSpecs';
import type { Candle } from '../src/shared/bridge/types';
import { chooseBarStyle } from './helpers/barStyleMenu';
import { openChartSettingsDialog } from './helpers/chartSettingsDialog';
import { openChart } from './helpers/openChart';
import { chooseOption } from './helpers/select';
import {
  STUB_M5_INTERVAL_MS,
  STUB_NOW,
  chartScopeKey,
  eurusdFormingBar,
  expectNoErrors,
  gotoWithStub,
  setStubResponse,
  stubInvocations,
  windowCandles,
  type RecordedInvoke,
} from './helpers/tauriStub';

/**
 * The chart types the backend draws from the chart's own candles: the bars Renko bricks and Line Break lines are
 * computed into, the specs the settings map onto, and the chart's history replaced by those bars — beside the
 * candles the chart keeps for the next request.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** The candles the chart is asked for, which every request of a chart type carries. */
const BASE_CANDLES = windowCandles(STUB_BAR_COUNT);
/** The open time of the newest of them, from which the bricks and lines are stamped. */
const NEWEST_BASE_MS = STUB_NOW;

/** The defaults the Renko settings map onto, which is TradingView's own set. */
const DEFAULT_RENKO_SPEC = {
  type: 'renko',
  boxMethod: 'atr',
  atrLength: 14,
  boxSize: '10',
  percentage: '1',
  wicks: true,
};
/** How many lines the close has to turn against before a Line Break line is drawn, which the default is. */
const DEFAULT_LINE_BREAK_SPEC = { type: 'lineBreak', lines: 3 };

/** One bar the backend reports for a chart type: its prices are the decimal strings the chart parses. */
function chartTypeBarAt(timeMs: number, prices: [string, string, string, string], volume: string): ChartTypeBar {
  const [open, high, low, close] = prices;
  return { timeMs, open, high, low, close, volume };
}

/** Three bricks, two of them drawn inside the same base candle a millisecond apart. */
const BRICKS: readonly ChartTypeBar[] = [
  chartTypeBarAt(NEWEST_BASE_MS, ['1.0850', '1.0860', '1.0845', '1.0855'], '120'),
  chartTypeBarAt(NEWEST_BASE_MS + 1, ['1.0855', '1.0870', '1.0850', '1.0865'], '240'),
  chartTypeBarAt(NEWEST_BASE_MS + STUB_M5_INTERVAL_MS, ['1.0865', '1.0880', '1.0860', '1.0875'], '360'),
];
/** The bricks after the live candle the burst below carries, one more than the window first drew. */
const BRICKS_AFTER_LIVE: readonly ChartTypeBar[] = [
  ...BRICKS,
  chartTypeBarAt(NEWEST_BASE_MS + 2 * STUB_M5_INTERVAL_MS, ['1.0875', '1.0890', '1.0870', '1.0885'], '480'),
];
/** The two lines a Line Break chart of the stub's candles draws. */
const LINES: readonly ChartTypeBar[] = [
  chartTypeBarAt(NEWEST_BASE_MS, ['1.0850', '1.0860', '1.0845', '1.0860'], '120'),
  chartTypeBarAt(NEWEST_BASE_MS + STUB_M5_INTERVAL_MS, ['1.0860', '1.0875', '1.0855', '1.0875'], '240'),
];

/** One candle as the chart draws it: the bar the library plots, with its prices read off the decimal text. */
function renderBarOf(candle: Candle): RenderBar {
  return {
    time: candle.timeMs / 1000,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.tickVolume,
  };
}

/** The chart bars those bars draw: their own second, and one second on wherever two of them share it. */
function drawnBars(bars: readonly ChartTypeBar[]): RenderBar[] {
  return chartTypeCandles(bars).map((candle) => renderBarOf(candle));
}

/** The chart bars the stub's own window draws, which the chart holds again once the candles are back. */
const BASE_BARS: readonly RenderBar[] = BASE_CANDLES.map((candle) => renderBarOf(candle));

/** The spec the settings ask the command for, for a chart type drawn from `values`. */
function specOf(style: 'renko' | 'lineBreak', values: BarStyleSettingValues = {}) {
  const appearance = chartTypeAppearanceOf(barStyleAppearanceOf(style, values));
  if (appearance === null) {
    throw new Error(`${style} is not a chart type`);
  }
  return chartTypeSpecOf(appearance);
}

const chartBars = (page: Page) => page.evaluate(() => window.__chartTest?.data() ?? []);

/** The bar style series as the hook shows it. */
const barStyleState = (page: Page) => page.evaluate(() => window.__chartTest!.barStyle());

/** Every chart-type request the app sent, oldest first. */
async function chartTypeRequests(page: Page): Promise<RecordedInvoke[]> {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'compute_chart_type_bars');
}

/** The spec of the newest chart-type request, as the command received it. */
async function lastChartTypeSpec(page: Page): Promise<Record<string, unknown> | undefined> {
  const spec = (await chartTypeRequests(page)).at(-1)?.args.chart;
  return typeof spec === 'object' && spec !== null ? (spec as Record<string, unknown>) : undefined;
}

type EmitProbe = { __E2E_TAURI_STUB__: { emit: (event: string, payload: unknown) => void } };

/**
 * Pushes `count` forming candles of the series on screen in one go, as a burst of broker bars reaches the app:
 * every one of them is newer than the last bar, and no frame runs between them.
 */
async function pushFormingBarBurst(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (burst) => {
      const stub = (window as unknown as EmitProbe).__E2E_TAURI_STUB__;
      for (let step = 1; step <= burst.count; step += 1) {
        const candle = { ...burst.candle, timeMs: burst.candle.timeMs + step };
        stub.emit('bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
      }
    },
    { candle: eurusdFormingBar, count },
  );
}

/** The errors the stub's page collected, which every test of the file asserts empty. */
type CollectedErrors = Awaited<ReturnType<typeof gotoWithStub>>;

/**
 * Opens the chart on `style`, which the stub answers with `bars`: the base candles the chart asks for, and the
 * bricks or lines its chart type request draws from them, which are on screen once the poll returns.
 */
async function openOnChartType(
  page: Page,
  style: 'Renko' | 'Line break',
  bars: readonly ChartTypeBar[],
): Promise<CollectedErrors> {
  const collected = await gotoWithStub(page, {
    historyByTimeframe: { M5: BASE_CANDLES },
    responses: { compute_chart_type_bars: bars },
  });
  await openChart(page);
  await chooseBarStyle(page, style);
  await expect.poll(async () => (await chartBars(page)).length).toBe(bars.length);
  return collected;
}

/** Opens a chart the backend already has saved on Renko, whose bricks it asks for as soon as the candles arrive. */
async function openSavedRenkoChart(page: Page): Promise<CollectedErrors> {
  const collected = await gotoWithStub(page, {
    historyByTimeframe: { M5: BASE_CANDLES },
    responses: { compute_chart_type_bars: BRICKS },
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'renko' } },
  });
  await expect.poll(async () => (await chartBars(page)).length).toBe(BRICKS.length);
  return collected;
}

test('a chart type bar takes its own second, and one second on where two of them share it', () => {
  const candles = chartTypeCandles(BRICKS);

  expect(candles.map((candle) => candle.timeMs / 1000)).toEqual([
    NEWEST_BASE_MS / 1000,
    NEWEST_BASE_MS / 1000 + 1,
    NEWEST_BASE_MS / 1000 + STUB_M5_INTERVAL_MS / 1000,
  ]);
  expect(candles[0]).toEqual({
    timeMs: NEWEST_BASE_MS,
    open: '1.0850',
    high: '1.0860',
    low: '1.0845',
    close: '1.0855',
    tickVolume: 120,
    spread: 0,
    realVolume: 0,
  });
});

test('the Renko and Line break defaults map onto the specs the command reads', () => {
  expect(specOf('renko')).toEqual(DEFAULT_RENKO_SPEC);
  expect(specOf('lineBreak')).toEqual(DEFAULT_LINE_BREAK_SPEC);
  // A saved method and its own distance travel as the decimal text the command parses.
  expect(specOf('renko', { boxMethod: 'traditional', boxSize: 0.0005, percentage: 0.5 })).toMatchObject({
    boxMethod: 'traditional',
    boxSize: '0.0005',
    percentage: '0.5',
  });
  // A plain number would switch to exponent notation here, which is not a decimal the command reads.
  expect(decimalSetting(0.0000001)).toBe('0.0000001');
  // The counts the command reads as whole numbers travel rounded, whatever the dialog let through.
  expect(specOf('renko', { atrLength: 14.5 })).toMatchObject({ atrLength: 15 });
  expect(specOf('lineBreak', { lines: 2.5 })).toMatchObject({ lines: 3 });
});

test('picking Renko asks for bricks from the base candles and draws them', async ({ page }) => {
  const collected = await openOnChartType(page, 'Renko', BRICKS);

  const [request] = await chartTypeRequests(page);
  expect(request.args.candles).toEqual(BASE_CANDLES);
  expect(request.args.chart).toEqual(DEFAULT_RENKO_SPEC);
  expect(await chartBars(page)).toEqual(drawnBars(BRICKS));
  // A Renko brick shows the wick its base candle had, because the Wicks setting defaults to on.
  expect((await barStyleState(page)).options.wickVisible).toBe(true);
  expectNoErrors(collected);
});

test('choosing Candles again brings the base candles back', async ({ page }) => {
  const collected = await openOnChartType(page, 'Renko', BRICKS);

  await chooseBarStyle(page, 'Candles');

  await expect.poll(async () => (await chartBars(page)).length).toBe(STUB_BAR_COUNT);
  expect(await chartBars(page)).toEqual(BASE_BARS);
  expect((await barStyleState(page)).seriesType).toBeNull();
  expectNoErrors(collected);
});

test('a burst of live candles asks once, and the brick it added is drawn', async ({ page }) => {
  const collected = await openOnChartType(page, 'Renko', BRICKS);
  const requestsBefore = (await chartTypeRequests(page)).length;
  await setStubResponse(page, 'compute_chart_type_bars', BRICKS_AFTER_LIVE);

  await pushFormingBarBurst(page, 3);

  await expect.poll(async () => (await chartBars(page)).length).toBe(BRICKS_AFTER_LIVE.length);
  const bars = await chartBars(page);
  expect(bars).toEqual(drawnBars(BRICKS_AFTER_LIVE));
  expect(bars.every((bar, index) => index === 0 || bar.time > bars[index - 1].time)).toBe(true);
  // The three candles of the burst are the one request a 250 ms window allows.
  expect(await chartTypeRequests(page)).toHaveLength(requestsBefore + 1);
  expectNoErrors(collected);
});

test('picking Line break asks for three lines by default and draws them', async ({ page }) => {
  const collected = await openOnChartType(page, 'Line break', LINES);

  const [request] = await chartTypeRequests(page);
  expect(request.args.chart).toEqual(DEFAULT_LINE_BREAK_SPEC);
  expect(await chartBars(page)).toEqual(drawnBars(LINES));
  // A line has no wick, whatever the candle settings of its own say.
  expect((await barStyleState(page)).options.wickVisible).toBe(false);
  expectNoErrors(collected);
});

test('a chart saved on Renko asks for its bricks as soon as the candles arrive', async ({ page }) => {
  const collected = await openSavedRenkoChart(page);

  // Two histories replace each other on the way in: the snapshot the chart mounts with, then the window it asks
  // for. Each replacement asks for the bricks of the candles it holds, so the last request is the one the chart
  // keeps — it carries that window, and the bars on screen are its answer.
  await expect.poll(async () => (await chartTypeRequests(page)).at(-1)?.args.candles).toEqual(BASE_CANDLES);
  const requests = await chartTypeRequests(page);
  for (const request of requests) {
    expect(request.args.chart).toEqual(DEFAULT_RENKO_SPEC);
  }
  expect(await chartBars(page)).toEqual(drawnBars(BRICKS));
  expect((await barStyleState(page)).style).toBe('renko');
  expectNoErrors(collected);
});

test('the Renko settings show their defaults, and a traditional box asks for the bars again', async ({ page }) => {
  const collected = await openSavedRenkoChart(page);
  const requestsBefore = (await chartTypeRequests(page)).length;

  const dialog = await openChartSettingsDialog(page);

  await expect(dialog.getByLabel('Box size assignment method', { exact: true })).toHaveText('ATR');
  await expect(dialog.getByLabel('ATR length', { exact: true })).toHaveValue('14');
  await expect(dialog.getByLabel('Box size', { exact: true })).toHaveValue('10');
  await expect(dialog.getByLabel('Percentage', { exact: true })).toHaveValue('1');
  await expect(dialog.getByLabel('Wicks', { exact: true })).toBeChecked();

  await chooseOption(dialog.getByLabel('Box size assignment method', { exact: true }), 'Traditional');

  await expect.poll(async () => (await lastChartTypeSpec(page))?.boxMethod).toBe('traditional');
  expect(await chartTypeRequests(page)).toHaveLength(requestsBefore + 1);
  expectNoErrors(collected);
});
