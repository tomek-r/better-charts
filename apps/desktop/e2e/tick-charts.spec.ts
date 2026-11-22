import { expect, test, type Page } from '@playwright/test';
import { TickMarkType } from 'lightweight-charts';
import { TICKS_PER_PAGE } from '../src/shared/bridge/config';
import {
  TICK_INTERVALS,
  intervalLabel,
  intervalLongLabel,
  intervalSection,
  isTickInterval,
} from '../src/shared/bridge/chartIntervals';
import { lastChartSelectionKey } from '../src/features/bridge/lastChartSelection/lastChartSelection';
import { ChartTickBars, CHART_TICK_BUDGET, INITIAL_TICK_BARS } from '../src/features/bridge/market/chartTickBars';
import type { ChartTickBarsDeps } from '../src/features/bridge/market/chartTickBars';
import {
  foldTick,
  heldTickBars,
  joinedTickBars,
  tickBarTimeline,
} from '../src/features/chart/engine/bars/tickBarTimeline';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import type {
  IndicatorTicksAnswer,
  IndicatorTicksQuery,
  IndicatorTickSource,
} from '../src/features/chart/engine/indicators/indicatorTickSource';
import { indicatorSettingsSchema } from '../src/features/chart/engine/indicators/indicatorDisplaySettings';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import type { ChartController } from '../src/features/chart/engine/surface/chartController';
import { DEFAULT_CHART_TIME_LABELS, createChartTimeFormat } from '../src/features/chart/timeZone/chartTimeFormat';
import { EXCHANGE_TIME_ZONE } from '../src/features/chart/timeZone/chartTimeZones';
import { isHigherTimeframe } from '../src/features/indicators/calculation/calculationChoice';
import { CalculationIndicator } from '../src/features/indicators/calculation/calculationIndicator';
import { withCalculation } from '../src/features/indicators/calculation/withCalculation';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import type { Candle, IndicatorTick } from '../src/shared/bridge/types';
import { averageOf } from './helpers/averageValues';
import {
  assembleGlyphRows,
  canvasPaints,
  clearCanvasPaints,
  clearPriceAxisPaints,
  priceAxisPaints,
  recordCanvasText,
  recordPriceAxisText,
  type CanvasPaint,
} from './helpers/canvasText';
import { openSmaSettingsFromRow } from './helpers/indicatorObjectTree';
import { openChart } from './helpers/openChart';
import { readStoredJson } from './helpers/pageStorage';
import { EURUSD_CHART } from './helpers/savedIndicators';
import {
  STUB_NOW,
  brokerSymbolFixture,
  eurusdFormingBar,
  eurusdQuote,
  gotoWithStub,
  pushEvent,
  stubInvocations,
  type RecordedInvoke,
  type RecordedTicks,
} from './helpers/tauriStub';

/**
 * The chart's tick intervals: the interval model the selector offers, the N-tick
 * bars built from the symbol's raw ticks, and those bars kept live from the quotes.
 */

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
/** Ten o'clock UTC, on a whole second, so every bar time of the pure cases is exact. */
const FIRST_TICK_MS = Date.UTC(2024, 4, 14, 10, 0);
const FIRST_TICK_SECONDS = FIRST_TICK_MS / MILLISECONDS_PER_SECOND;
/** The stub's bridge account, which owns the saved chart selection. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** The ticks one bar of the interval these cases read groups. */
const TICKS_PER_BAR = 10;
const COUNTDOWN_TEXT = /^\d{2}:\d{2}(:\d{2})?$/;

/** A tick of `timeMs` quoting `price` on both sides, so the bar it builds carries that price. */
function tickAt(timeMs: number, price: string): IndicatorTick {
  return { timeMs, bid: price, ask: price, last: price, volume: 1 };
}

/** The price these cases rise by, as the wire's decimal string. */
function priceOf(index: number): string {
  return (1.085 + index * 0.001).toFixed(4);
}

/** `count` ticks a second apart from `startMs`, each a step above the one before. */
function risingTicks(count: number, startMs: number): IndicatorTick[] {
  return Array.from({ length: count }, (_, index) => tickAt(startMs + index * MILLISECONDS_PER_SECOND, priceOf(index)));
}

const quote = (timeMs: number, bid?: string) => eurusdQuote(timeMs, bid);

const chartBars = (page: Page) => page.evaluate(() => window.__chartTest?.data() ?? []);

/** Every `mm:ss` the price axis painted since the paints were last cleared. */
async function countdownTexts(page: Page): Promise<string[]> {
  const rows = assembleGlyphRows(await priceAxisPaints(page));
  return rows.map((row) => row.text).filter((text) => COUNTDOWN_TEXT.test(text));
}

async function invocationsOf(page: Page, cmd: string): Promise<RecordedInvoke[]> {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === cmd);
}

const intervalButton = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button', { name: label, exact: true });

/** Picks the interval that `label` names from the menu the chevron opens. */
async function chooseInterval(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'More timeframes' }).click();
  const menu = page.getByRole('dialog', { name: 'Timeframes' });
  await menu.getByRole('button', { name: label, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

/** The chart selection the app stored for the stub's account. */
async function storedSelection(page: Page): Promise<unknown> {
  const stored = (await readStoredJson(page, lastChartSelectionKey)) as Record<string, unknown>;
  return stored[ACCOUNT_KEY];
}

test.describe('the interval model', () => {
  test('the four tick intervals carry the codes, labels and section the selector shows', () => {
    expect(TICK_INTERVALS.map((interval) => interval.code)).toEqual(['T1', 'T10', 'T100', 'T1000']);
    expect(TICK_INTERVALS.map((interval) => interval.ticksPerBar)).toEqual([1, 10, 100, 1000]);
    expect(TICK_INTERVALS.map((interval) => interval.label)).toEqual(['1T', '10T', '100T', '1000T']);
    expect(TICK_INTERVALS.map((interval) => interval.longLabel)).toEqual([
      '1 tick',
      '10 ticks',
      '100 ticks',
      '1000 ticks',
    ]);
    const sections = TICK_INTERVALS.map((interval) => intervalSection(interval.code));
    expect(sections).toEqual(['ticks', 'ticks', 'ticks', 'ticks']);
    expect(['T1', 'T10', 'T100', 'T1000'].every(isTickInterval)).toBe(true);
  });

  test('an MT5 code keeps its own labels and section, and is never read as ticks', () => {
    expect(isTickInterval('M10')).toBe(false);
    expect(isTickInterval(undefined)).toBe(false);
    expect(intervalLabel('M15')).toBe('15m');
    expect(intervalLongLabel('H1')).toBe('1 hour');
    expect(intervalSection('D1')).toBe('days');
    expect(intervalSection('H4')).toBe('hours');
    expect(intervalLabel('T1000')).toBe('1000T');
    expect(intervalLongLabel('T1')).toBe('1 tick');
  });
});

test.describe('building the chart’s N-tick bars', () => {
  test('bars whose ticks all arrive inside one second are still given strictly increasing times', () => {
    // Twenty ticks a tenth of a second apart: every group of two opens inside the same second.
    const ticks = Array.from({ length: 20 }, (_, index) => tickAt(FIRST_TICK_MS + index * 100, '1.0850'));

    const timeline = tickBarTimeline(ticks, 2);

    const expectedTimes = Array.from({ length: 10 }, (_, index) => FIRST_TICK_SECONDS + index);
    expect(timeline.bars.map((bar) => bar.time)).toEqual(expectedTimes);
    expect(timeline.formingPrices).toEqual([]);
  });

  test('a bar whose ticks are seconds apart keeps the second its first tick arrived in', () => {
    const timeline = tickBarTimeline(risingTicks(4, FIRST_TICK_MS), 2);

    expect(timeline.bars).toEqual([
      { time: FIRST_TICK_SECONDS, open: 1.085, high: 1.086, low: 1.085, close: 1.086, volume: 2 },
      { time: FIRST_TICK_SECONDS + 2, open: 1.087, high: 1.088, low: 1.087, close: 1.088, volume: 2 },
    ]);
  });

  test('a live tick extends the forming bar, and the tick after N closes it with a bar of its own', () => {
    const closed = tickBarTimeline(risingTicks(TICKS_PER_BAR, FIRST_TICK_MS), TICKS_PER_BAR);
    expect(closed.bars).toHaveLength(1);
    expect(closed.formingPrices).toEqual([]);

    let forming = foldTick(closed, tickAt(FIRST_TICK_MS + 30_000, '1.2000'), TICKS_PER_BAR);
    expect(forming.bars).toHaveLength(2);
    expect(forming.bars[1]).toEqual({
      time: FIRST_TICK_SECONDS + 30,
      open: 1.2,
      high: 1.2,
      low: 1.2,
      close: 1.2,
      volume: 1,
    });

    for (let taken = 2; taken <= TICKS_PER_BAR; taken += 1) {
      const price = (1.2 + taken * 0.001).toFixed(4);
      forming = foldTick(forming, tickAt(FIRST_TICK_MS + 30_000 + taken, price), TICKS_PER_BAR);
    }
    expect(forming.bars).toHaveLength(2);
    expect(forming.formingPrices).toEqual([]);
    expect(forming.bars[1]).toMatchObject({ volume: TICKS_PER_BAR, open: 1.2, high: 1.21, close: 1.21 });

    const eleventh = foldTick(forming, tickAt(FIRST_TICK_MS + 40_000, '1.3000'), TICKS_PER_BAR);
    expect(eleventh.bars).toHaveLength(3);
    expect(eleventh.bars[2]).toEqual({
      time: FIRST_TICK_SECONDS + 40,
      open: 1.3,
      high: 1.3,
      low: 1.3,
      close: 1.3,
      volume: 1,
    });
  });

  test('a tick carrying no price leaves the timeline as it was', () => {
    const timeline = tickBarTimeline(risingTicks(2, FIRST_TICK_MS), TICKS_PER_BAR);

    expect(foldTick(timeline, tickAt(FIRST_TICK_MS + 5000, '0'), TICKS_PER_BAR)).toBe(timeline);
  });
});

/** Twenty ticks a second apart inside the newest minute, which build two whole bars of ten. */
const FEED_TICKS = risingTicks(20, STUB_NOW - 19 * MILLISECONDS_PER_SECOND);
const FEED: RecordedTicks[] = [{ symbol: 'EURUSD', ticks: FEED_TICKS }];
/** The chart times of the two bars the feed builds. */
const FEED_BAR_TIMES = [STUB_NOW / MILLISECONDS_PER_SECOND - 19, STUB_NOW / MILLISECONDS_PER_SECOND - 9];

const eurusd = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar');

test('the interval menu lists a Ticks section first with its four choices', async ({ page }) => {
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'More timeframes' }).click();
  const menu = page.getByRole('dialog', { name: 'Timeframes' });
  const rows = menu.locator('.timeframe-menu-select');

  await expect(menu.locator('.timeframe-menu-heading').first()).toHaveText('Ticks');
  await expect(rows.nth(0)).toHaveText('1 tick');
  await expect(rows.nth(1)).toHaveText('10 ticks');
  await expect(rows.nth(2)).toHaveText('100 ticks');
  await expect(rows.nth(3)).toHaveText('1000 ticks');
  // The MT5 sections follow, as they did before ticks were offered.
  await expect(rows.nth(4)).toHaveText('1 minute');
});

test('choosing 10 ticks reads the chart symbol’s ticks and draws the bars they build', async ({ page }) => {
  await gotoWithStub(page, { recordedTicks: FEED });
  await openChart(page);
  // The start window's own request is the last history read; a tick interval must add none.
  await expect.poll(async () => (await invocationsOf(page, 'request_history')).length).toBeGreaterThan(0);
  const historyBefore = (await invocationsOf(page, 'request_history')).length;

  await chooseInterval(page, '10 ticks');

  await expect.poll(async () => (await chartBars(page)).length).toBe(2);
  expect(await chartBars(page)).toEqual([
    { time: FEED_BAR_TIMES[0], open: 1.085, high: 1.094, low: 1.085, close: 1.094, volume: TICKS_PER_BAR },
    { time: FEED_BAR_TIMES[1], open: 1.095, high: 1.104, low: 1.095, close: 1.104, volume: TICKS_PER_BAR },
  ]);
  const [read] = await invocationsOf(page, 'request_indicator_ticks');
  expect(read.args).toMatchObject({ key: 'chart-ticks', symbol: 'EURUSD' });
  // The read starts at the newest minute and asks for no more than the negotiated page bound.
  expect(Number(read.args.toMs) - Number(read.args.fromMs)).toBe(MILLISECONDS_PER_MINUTE);
  expect(Number(read.args.maxTicks)).toBe(Math.min(TICKS_PER_PAGE, CHART_TICK_BUDGET));
  expect((await invocationsOf(page, 'request_history')).length).toBe(historyBefore);
  await expect(intervalButton(page, '10T')).toHaveAttribute('aria-pressed', 'true');
});

test('each quote adds a tick to the forming bar and the eleventh opens a new bar', async ({ page }) => {
  await gotoWithStub(page, { recordedTicks: FEED });
  await openChart(page);
  await chooseInterval(page, '10 ticks');
  await expect.poll(async () => (await chartBars(page)).length).toBe(2);
  const firstQuoteMs = STUB_NOW + 5 * MILLISECONDS_PER_SECOND;

  await pushEvent(page, 'quote-update', quote(firstQuoteMs, priceOf(0)));
  await expect.poll(async () => (await chartBars(page)).length).toBe(3);
  expect((await chartBars(page)).at(-1)).toMatchObject({ open: 1.085, high: 1.085, close: 1.085, volume: 1 });

  for (let index = 1; index < TICKS_PER_BAR; index += 1) {
    await pushEvent(page, 'quote-update', quote(firstQuoteMs + index * MILLISECONDS_PER_SECOND, priceOf(index)));
  }
  await expect.poll(async () => (await chartBars(page)).at(-1)?.volume).toBe(TICKS_PER_BAR);
  expect((await chartBars(page)).at(-1)).toMatchObject({ open: 1.085, low: 1.085, close: 1.094, volume: 10 });

  await pushEvent(page, 'quote-update', quote(firstQuoteMs + TICKS_PER_BAR * MILLISECONDS_PER_SECOND, '1.3000'));
  await expect.poll(async () => (await chartBars(page)).length).toBe(4);
  expect((await chartBars(page)).at(-1)).toMatchObject({ open: 1.3, high: 1.3, low: 1.3, close: 1.3, volume: 1 });
});

test('a tick interval draws no bar countdown, and 5 minutes requests its history again', async ({ page }) => {
  await recordPriceAxisText(page);
  await gotoWithStub(page, { recordedTicks: FEED });
  await openChart(page);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
  // Light the countdown on the M5 window first, so its absence afterwards is the tick interval's doing.
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle: eurusdFormingBar });
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 14_500));
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 15_500));
  await expect.poll(async () => (await countdownTexts(page)).length).toBeGreaterThan(0);

  await chooseInterval(page, '10 ticks');
  await expect.poll(async () => (await chartBars(page)).length).toBe(2);
  await clearPriceAxisPaints(page);
  // A quote repaints the axis; the tag it carried on the M5 window must not come back.
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 16_500, '1.0900'));
  await expect.poll(async () => (await priceAxisPaints(page)).length).toBeGreaterThan(0);
  expect(await countdownTexts(page)).toEqual([]);

  const historyBefore = (await invocationsOf(page, 'request_history')).length;
  await intervalButton(page, '5m').click();
  await expect.poll(async () => (await invocationsOf(page, 'request_history')).length).toBeGreaterThan(historyBefore);
  expect((await invocationsOf(page, 'request_history')).at(-1)?.args).toMatchObject({
    symbol: 'EURUSD',
    timeframe: 'M5',
  });
  await expect.poll(async () => (await chartBars(page)).length).toBe(10);
});

test('a reload reopens the tick interval the chart was last on', async ({ page }) => {
  await gotoWithStub(page, { recordedTicks: FEED, brokerSymbols: [eurusd] });
  await openChart(page);
  await chooseInterval(page, '10 ticks');
  await expect.poll(async () => (await chartBars(page)).length).toBe(2);
  await expect.poll(() => storedSelection(page)).toEqual({ symbol: 'EURUSD', timeframe: 'T10' });

  await page.reload();

  await expect.poll(async () => (await chartBars(page)).length).toBe(2);
  await expect(intervalButton(page, '10T')).toHaveAttribute('aria-pressed', 'true');
});

/** `count` ticks a second apart from `firstMs`, each a step above the one before. */
function ticksFrom(firstMs: number, count: number, firstPrice: number): IndicatorTick[] {
  return Array.from({ length: count }, (_, index) =>
    tickAt(firstMs + index * MILLISECONDS_PER_SECOND, (firstPrice + index * 0.001).toFixed(4)),
  );
}

test.describe('the time labels of a tick chart', () => {
  /** Ten o'clock UTC, fourteen seconds on: what a tick bar of the first tick labels its axis with. */
  const FOURTEEN_SECONDS_LATER = FIRST_TICK_SECONDS + 14;

  test('a tick bar reads its own second, and an MT5 bar keeps the minute it always read', () => {
    const tickLabels = createChartTimeFormat(EXCHANGE_TIME_ZONE, null, DEFAULT_CHART_TIME_LABELS, 'second');
    const timeframeLabels = createChartTimeFormat(EXCHANGE_TIME_ZONE, null);

    expect(tickLabels.pointerLabel(FOURTEEN_SECONDS_LATER)).toBe("Tue 14 May '24  10:00:14");
    expect(timeframeLabels.pointerLabel(FOURTEEN_SECONDS_LATER)).toBe("Tue 14 May '24  10:00");
    expect(tickLabels.tickMarkLabel(FOURTEEN_SECONDS_LATER, TickMarkType.TimeWithSeconds)).toBe('10:00:14');
  });
});

test.describe('holding the oldest tick bar back', () => {
  /** Twenty-three ticks a second apart: two whole bars of ten, and three ticks short of a third at the old end. */
  const SHORT_OLDEST_TICKS = risingTicks(23, FIRST_TICK_MS);

  test('a read whose oldest bar is short keeps its ticks back instead of drawing a bar of three', () => {
    const hold = heldTickBars(SHORT_OLDEST_TICKS, TICKS_PER_BAR);

    expect(hold.bars).toHaveLength(2);
    expect(hold.bars.every((bar) => bar.volume === TICKS_PER_BAR)).toBe(true);
    expect(hold.oldestTicks).toEqual(SHORT_OLDEST_TICKS.slice(0, 3));
  });

  test('the page before it completes that bar, and only the ticks short of one wait for the next page', () => {
    const hold = heldTickBars(SHORT_OLDEST_TICKS, TICKS_PER_BAR);
    const olderTicks = ticksFrom(FIRST_TICK_MS - 15 * MILLISECONDS_PER_SECOND, 15, 1.2);

    const joined = joinedTickBars(olderTicks, hold.oldestTicks, TICKS_PER_BAR, hold.bars[0].time);

    // Fifteen older ticks and the three held back make one whole bar, with eight ticks left over.
    expect(joined.oldestTicks).toEqual(olderTicks.slice(0, 8));
    expect(joined.bars).toHaveLength(1);
    expect(joined.bars[0]).toMatchObject({
      open: Number(olderTicks[8].bid),
      close: Number(SHORT_OLDEST_TICKS[2].bid),
      volume: TICKS_PER_BAR,
    });
    expect(joined.bars[0].time).toBeLessThan(hold.bars[0].time);
  });
});

/** The digits an average is compared at: the last bits of a rolling sum are not what a case asserts. */
const AVERAGE_DIGITS = 10;

/** `values` read at `AVERAGE_DIGITS`, so an average and the plain mean of its window compare by their digits. */
function atAverageDigits(values: readonly (number | null)[]): (number | null)[] {
  return values.map((value) => (value === null ? null : Number(value.toFixed(AVERAGE_DIGITS))));
}

test.describe('calculating on a tick chart', () => {
  /** Thirty ticks a second apart: three bars of ten, whose closes rise by a point a tick. */
  const CHART_BARS = tickBarTimeline(risingTicks(30, FIRST_TICK_MS), TICKS_PER_BAR).bars;
  /** The window of the moving average the chart's own closes must reproduce. */
  const SMA_LENGTH = 2;
  /** The seeded moving average of the chart's own closes, which the Chart choice must reproduce. */
  const SMA_SETTINGS = resolveSettingValues(indicatorSettingsSchema(withCalculation(smaPlugin)), {
    length: SMA_LENGTH,
  });

  test('every MT5 timeframe is longer than any tick interval, and the chart choice is not', () => {
    expect(isHigherTimeframe('M1', 'T10')).toBe(true);
    expect(isHigherTimeframe('H1', 'T1000')).toBe(true);
    expect(isHigherTimeframe('M10', 'M5')).toBe(true);
    expect(isHigherTimeframe('M1', 'M5')).toBe(false);
  });

  test('the Chart choice calculates on the chart’s own tick bars', () => {
    const frame = new CalculationIndicator(smaPlugin.indicatorClass).load(CHART_BARS, SMA_SETTINGS, 'T10');
    const means = averageOf(
      CHART_BARS.map((bar) => bar.close),
      SMA_LENGTH,
    );

    expect(frame.bars.map((bar) => bar.timeMs)).toEqual(CHART_BARS.map((bar) => bar.time * MILLISECONDS_PER_SECOND));
    expect(atAverageDigits(frame.bars.map((bar) => bar.values[0]))).toEqual(atAverageDigits(means));
  });
});

/** The time axis canvas: as wide as the pane and only as tall as the labels on it. */
const TIME_AXIS_MAX_HEIGHT = 60;
const PANE_MIN_WIDTH = 300;

/** The ticks the chart opens on: five thousand a second apart, which build a pane of five hundred bars. */
const READ_TICK_COUNT = 5000;
const READ_TICKS = ticksFrom(STUB_NOW - READ_TICK_COUNT * MILLISECONDS_PER_SECOND, READ_TICK_COUNT, 1.085);
const READ_FEED: RecordedTicks[] = [{ symbol: 'EURUSD', ticks: READ_TICKS }];
/** The oldest tick the read holds, which the first older page reads before. */
const OLDEST_READ_TICK_MS = READ_TICKS[0].timeMs;
/** How far before that tick the older page's own ticks sit: past every window the opening read walks. */
const OLDER_TICKS_GAP_MS = 3_000 * MILLISECONDS_PER_SECOND;
/** The ticks an older page brings: twenty a second apart, two bars of ten. */
const OLDER_TICKS = ticksFrom(OLDEST_READ_TICK_MS - OLDER_TICKS_GAP_MS, 20, 1.2);
const OLDER_FEED: RecordedTicks[] = [{ symbol: 'EURUSD', ticks: [...OLDER_TICKS, ...READ_TICKS] }];

/** The texts the time axis painted, oldest first: the wide, short canvas under the pane. */
function timeAxisTexts(paints: readonly CanvasPaint[]): string[] {
  return paints
    .filter((paint) => paint.canvasHeight <= TIME_AXIS_MAX_HEIGHT && paint.canvasWidth > PANE_MIN_WIDTH)
    .map((paint) => paint.text);
}

/** Whether the time axis has painted a mark reading its own second, as a tick interval's bars are. */
async function axisReadsSeconds(page: Page): Promise<boolean> {
  return timeAxisTexts(await canvasPaints(page)).some((text) => /^\d{2}:\d{2}:\d{2}$/.test(text));
}

/** How many tick pages the chart has asked the bridge for. */
async function tickReads(page: Page): Promise<number> {
  return (await invocationsOf(page, 'request_indicator_ticks')).length;
}

const pointerReadout = (page: Page) => page.evaluate(() => window.__chartTest?.pointerReadout() ?? null);

/** The pane x of a bar's own time, where the pointer reports that bar's label. */
async function barX(page: Page, barSeconds: number): Promise<number> {
  const x = await page.evaluate(
    (timeMs) => window.__chartTest?.timeToX(timeMs) ?? Number.NaN,
    barSeconds * MILLISECONDS_PER_SECOND,
  );
  if (!Number.isFinite(x)) {
    throw new Error('That bar has no rendered coordinate.');
  }
  return x;
}

/** Points the pointer at the bar `offsetFromNewest` bars before the newest one, and answers its time label. */
async function hoverBarLabel(page: Page, offsetFromNewest: number): Promise<string> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  const bars = await chartBars(page);
  const bar = bars[bars.length - 1 - offsetFromNewest];
  await page.mouse.move(host.x + (await barX(page, bar.time)), host.y + 120);
  await expect.poll(async () => (await pointerReadout(page))?.timeLabel ?? null).not.toBeNull();
  return (await pointerReadout(page))?.timeLabel ?? '';
}

test('a tick interval labels its axis and crosshair to the second, and 5 minutes keeps its minutes', async ({
  page,
}) => {
  await recordCanvasText(page);
  await gotoWithStub(page, { recordedTicks: READ_FEED });
  await openChart(page);

  await clearCanvasPaints(page);
  await chooseInterval(page, '1 tick');
  await expect
    .poll(async () => (await chartBars(page)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(INITIAL_TICK_BARS);
  // The switch repaints the axis, whose marks then read the seconds the bars opened in.
  await expect.poll(async () => axisReadsSeconds(page), { timeout: 5_000 }).toBe(true);
  expect(await hoverBarLabel(page, 2)).toMatch(/:\d{2}:\d{2}$/);

  await intervalButton(page, '5m').click();
  await expect.poll(async () => (await chartBars(page)).length).toBe(10);
  // The marks are read from a paint after the switch, so the tick chart's own last paints are dropped and the
  // scroll repaints the axis of the window now on screen.
  await clearCanvasPaints(page);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
  await expect.poll(async () => timeAxisTexts(await canvasPaints(page)).length).toBeGreaterThan(0);
  const fiveMinuteAxis = timeAxisTexts(await canvasPaints(page));
  expect(fiveMinuteAxis.some((text) => /^\d{2}:\d{2}$/.test(text))).toBe(true);
  expect(fiveMinuteAxis.filter((text) => /^\d{2}:\d{2}:\d{2}$/.test(text))).toEqual([]);
  const fiveMinuteLabel = await hoverBarLabel(page, 2);
  expect(fiveMinuteLabel).toMatch(/\d{2}:\d{2}$/);
  expect(fiveMinuteLabel).not.toMatch(/:\d{2}:\d{2}$/);
});

test('scrolling past the oldest tick bar reads the ticks before it and prepends the bars they build', async ({
  page,
}) => {
  await gotoWithStub(page, { recordedTicks: OLDER_FEED });
  await openChart(page);
  await chooseInterval(page, '10 ticks');
  await expect.poll(async () => (await chartBars(page)).length, { timeout: 20_000 }).toBe(INITIAL_TICK_BARS);
  const drawnBefore = await chartBars(page);
  const readsBefore = await tickReads(page);

  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));

  await expect.poll(async () => tickReads(page), { timeout: 15_000 }).toBeGreaterThan(readsBefore);
  const olderReads = (await invocationsOf(page, 'request_indicator_ticks')).slice(readsBefore);
  // The first older page reads the minute before the oldest tick the chart held, and no more bytes than the bound.
  expect(olderReads[0].args).toMatchObject({
    key: 'chart-ticks',
    symbol: 'EURUSD',
    toMs: OLDEST_READ_TICK_MS,
    fromMs: OLDEST_READ_TICK_MS - MILLISECONDS_PER_MINUTE,
    maxTicks: Math.min(TICKS_PER_PAGE, CHART_TICK_BUDGET),
  });

  await expect.poll(async () => (await chartBars(page)).length, { timeout: 15_000 }).toBe(INITIAL_TICK_BARS + 2);
  const drawnAfter = await chartBars(page);
  // Every bar but the newest holds exactly the ticks the interval groups...
  expect(drawnAfter.slice(0, -1).filter((bar) => bar.volume !== TICKS_PER_BAR)).toEqual([]);
  // ...the two bars the older page built are its ticks' own groups, and the opening read held no tick back...
  const olderBars = joinedTickBars(OLDER_TICKS, [], TICKS_PER_BAR, drawnBefore[0].time).bars;
  expect(drawnAfter.slice(0, 2)).toEqual(olderBars);
  // ...and the bars that were on screen are untouched.
  expect(drawnAfter.slice(2)).toEqual(drawnBefore);
});

/** Saves the seeded moving average on the chart before it loads. */
async function openWithSma(page: Page): Promise<void> {
  const indicators = [{ instanceId: 'sma-1', definitionId: 'sma', settings: { length: 2 } }];
  await gotoWithStub(page, {
    recordedTicks: FEED,
    chartSettingOverrides: { [EURUSD_CHART]: { indicators } },
  });
  await openChart(page);
}

/** The series the indicator route was asked to read, oldest first. */
async function seriesRequests(page: Page): Promise<RecordedInvoke[]> {
  return (await invocationsOf(page, 'request_indicator_series')).filter((entry) => entry.args.symbol === 'EURUSD');
}

test('the Calculation drop-down disables the tick choices the chart already groups, and reads 1H as a series', async ({
  page,
}) => {
  await openWithSma(page);
  await chooseInterval(page, '10 ticks');
  await expect.poll(async () => (await chartBars(page)).length).toBe(2);

  const dialog = await openSmaSettingsFromRow(page);
  const calculation = dialog.getByRole('group', { name: 'Calculation', exact: true });
  await calculation.getByLabel('Timeframe', { exact: true }).click();

  await expect(page.getByRole('option', { name: '1 tick', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: '10 ticks', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: '1 tick', exact: true })).toHaveAttribute(
    'title',
    "The chart's bars already group 10 ticks.",
  );
  await expect(page.getByRole('option', { name: '100 ticks', exact: true })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await page.getByRole('option', { name: '1H', exact: true }).click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await seriesRequests(page)).length).toBeGreaterThan(0);
  expect((await seriesRequests(page))[0].args).toMatchObject({ symbol: 'EURUSD', timeframe: 'H1', beforeMs: null });
});

/** A raw-tick route that answers every read, so a chart's read can be driven without a bridge. */
class AnsweringTickPages {
  readonly requests: IndicatorTicksQuery[] = [];
  private listener: ((answer: IndicatorTicksAnswer) => void) | undefined;

  constructor(private readonly ticksOf: (query: IndicatorTicksQuery) => readonly IndicatorTick[]) {}

  readonly source: IndicatorTickSource = {
    request: (query) => {
      this.requests.push(query);
      const { fromMs, toMs } = query;
      this.listener?.({ kind: 'page', fromMs, toMs, complete: true, ticks: this.ticksOf(query) });
    },
    subscribe: (_key, listener) => {
      this.listener = listener;
      return () => {
        this.listener = undefined;
      };
    },
  };
}

/** One page of older history as the chart takes it: its bars, and whether more may follow. */
interface RecordedPrepend {
  readonly bars: readonly Candle[];
  readonly complete: boolean;
}

/** A chart controller stand-in that records the older history a tick read hands it. */
function recordingChart(): { chart: ChartController; prepends: RecordedPrepend[] } {
  const prepends: RecordedPrepend[] = [];
  const chart = {
    getData: (): readonly RenderBar[] => [],
    setSymbol: (): void => undefined,
    replaceHistory: (): boolean => false,
    resetView: (): void => undefined,
    updateCandle: (): void => undefined,
    appendOlderHistory: (bars: readonly Candle[], complete: boolean): void => {
      prepends.push({ bars, complete });
    },
  };
  return { chart: chart as unknown as ChartController, prepends };
}

/** The session refs a tick read writes through, which a chart library is not needed for. */
function tickReadSession(): ChartTickBarsDeps['session'] {
  return {
    mt5TimeframeRef: { current: 'M5' },
    currentSymbol: { current: undefined },
    currentTimeframe: { current: undefined },
    dataKeyRef: { current: '' },
    latestCandleRef: { current: undefined },
    setLatestCandle: () => undefined,
    setSnapshot: () => undefined,
    setChartError: () => undefined,
  };
}

test('the tick budget stops the chart asking for older ticks', () => {
  let pagesAnswered = 0;
  const pages = new AnsweringTickPages((query) => {
    pagesAnswered += 1;
    // The read's first page carries a pane of bars' worth; every page after it fills the page bound.
    const count = pagesAnswered === 1 ? INITIAL_TICK_BARS * TICKS_PER_BAR : query.maxTicks;
    return Array.from({ length: count }, (_, index) => tickAt(STUB_NOW - index, '1.0850'));
  });
  const { chart, prepends } = recordingChart();
  const tickBars = new ChartTickBars({
    chart: { current: chart },
    session: tickReadSession(),
    ticks: pages.source,
    brokerNowMs: () => STUB_NOW,
  });

  tickBars.show('EURUSD', 'T10');
  const openingReads = pages.requests.length;
  for (let scrolls = 0; scrolls < 5; scrolls += 1) {
    tickBars.requestOlderTicks();
  }

  const readTicks = INITIAL_TICK_BARS * TICKS_PER_BAR;
  const pagesWithinBudget = Math.ceil((CHART_TICK_BUDGET - readTicks) / TICKS_PER_PAGE);
  expect(openingReads).toBe(1);
  expect(pages.requests.slice(1).map((request) => request.maxTicks)).toEqual([
    ...Array.from({ length: pagesWithinBudget - 1 }, () => TICKS_PER_PAGE),
    CHART_TICK_BUDGET - readTicks - (pagesWithinBudget - 1) * TICKS_PER_PAGE,
  ]);
  // The page that spends the budget is the last one the chart takes, and it reports no more history.
  expect(prepends).toHaveLength(pagesWithinBudget);
  expect(prepends.at(-1)?.complete).toBe(false);

  const readsAfterBudget = pages.requests.length;
  tickBars.requestOlderTicks();
  expect(pages.requests).toHaveLength(readsAfterBudget);
});
