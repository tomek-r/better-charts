import { expect, test, type Page } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { CALCULATION_TIMEFRAME_INPUT } from '../src/features/indicators/calculation/calculationInputs';
import { buildTickBars } from '../src/features/indicators/calculation/tickBars';
import { shownTickBars, type TickBarSource } from '../src/features/indicators/calculation/tickFrame';
import {
  TICK_BUDGET,
  coveredTickWalk,
  endedTickWalk,
  narrowedTickWalk,
  newestTickWindow,
  nextOlderTickWindow,
  startTickWalk,
  tickReadRange,
  type TickWalk,
  type TickWindow,
} from '../src/features/indicators/calculation/tickPages';
import { NO_FRAME_BAR } from '../src/features/indicators/indicatorFrameBars';
import type { IndicatorTick, Candle } from '../src/shared/bridge/types';
import { averageOf } from './helpers/averageValues';
import { drawnTimes, drawnValues } from './helpers/indicatorFrames';
import { EURUSD_CHART } from './helpers/savedIndicators';
import {
  STUB_NOW,
  gotoWithStub,
  pushEvent,
  setIndicatorTicksUnavailable,
  stubInvocations,
  type RecordedInvoke,
  type RecordedTicks,
} from './helpers/tauriStub';

/**
 * The Calculation section's tick timeframes: the N-tick bars built from the ticks the bridge reads, how a read
 * plans the pages that fetch them under its budget, how they are projected onto the chart's bars, and what the
 * chart draws.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_M5 = 5 * SECONDS_PER_MINUTE;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_M5 = SECONDS_PER_M5 * MILLISECONDS_PER_SECOND;
/** Nine o'clock UTC, on a five-minute boundary, so every bar of these cases starts there. */
const FIRST_BAR_SECONDS = Date.UTC(2023, 10, 14, 9, 0) / MILLISECONDS_PER_SECOND;
const FIRST_BAR_MS = FIRST_BAR_SECONDS * MILLISECONDS_PER_SECOND;

const CHART_TIMEFRAME = 'M5';
/** The saved moving average the page cases start from, short enough to average two bars. */
const SAVED_LENGTH = 2;
/** The tick choice these cases calculate with, and the ticks one of its bars groups. */
const TICK_CHOICE = 'tick10';
const TICKS_PER_BAR = 10;

/** The stub's fixed clock sits on a five-minute boundary, so the chart's newest M5 bar opens there. */
const NEWEST_M5_OPEN_MS = Math.floor(STUB_NOW / MILLISECONDS_PER_M5) * MILLISECONDS_PER_M5;
/** The M5 bar before the newest one, which the feed's first ticks fall in. */
const PREVIOUS_M5_OPEN_MS = NEWEST_M5_OPEN_MS - MILLISECONDS_PER_M5;

/** A tick of `timeMs` at `price`, quoted around it so the bid is the price a bar carries. */
function tickAt(timeMs: number, price: number): IndicatorTick {
  const quote = price.toFixed(2);
  return { timeMs, bid: quote, ask: quote, last: quote, volume: 1 };
}

/** `count` ticks `spacingMs` apart from one spacing after `startMs`, each a point higher than the one before. */
function risingTicks(count: number, startingPrice: number, startMs: number, spacingMs: number): IndicatorTick[] {
  return Array.from({ length: count }, (_, index) => tickAt(startMs + (index + 1) * spacingMs, startingPrice + index));
}

/** An M5 chart bar `offsetBars` after the first one, flat around `close`. */
function m5Bar(offsetBars: number, close: number): RenderBar {
  const time = FIRST_BAR_SECONDS + offsetBars * SECONDS_PER_M5;
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

/** The chart's bar time of an epoch-millisecond instant, which a drawn point is keyed by. */
function secondsOf(timeMs: number): number {
  return timeMs / MILLISECONDS_PER_SECOND;
}

test.describe('building N-tick bars from raw ticks', () => {
  /** Five ticks a quarter second apart: a bar of two groups the first four, the fifth still forming. */
  const FIVE_TICKS: readonly IndicatorTick[] = risingTicks(5, 100, FIRST_BAR_MS, 250);

  test('every group of ticks is one bar of their first, highest, lowest and last price and their count', () => {
    const series = buildTickBars(FIVE_TICKS, 2);

    expect(series.bars).toEqual([
      { time: FIRST_BAR_SECONDS, open: 100, high: 101, low: 100, close: 101, volume: 2 },
      { time: FIRST_BAR_SECONDS, open: 102, high: 103, low: 102, close: 103, volume: 2 },
      { time: FIRST_BAR_SECONDS + 1, open: 104, high: 104, low: 104, close: 104, volume: 1 },
    ]);
    expect(series.closedCount).toBe(2);
  });

  test('a bar ends when its last tick arrived, the ticks left over forming the last bar', () => {
    const series = buildTickBars(FIVE_TICKS, 2);

    expect(series.endsMs).toEqual([FIVE_TICKS[1].timeMs, FIVE_TICKS[3].timeMs, FIVE_TICKS[4].timeMs]);
  });

  test('at one tick a bar every tick is a bar of its own, so none of them is forming', () => {
    const series = buildTickBars(FIVE_TICKS, 1);

    expect(series.bars.map((bar) => bar.close)).toEqual([100, 101, 102, 103, 104]);
    expect(series.closedCount).toBe(FIVE_TICKS.length);
  });

  test('a tick without a bid takes its last price, and a tick without either is left out', () => {
    const ticks: readonly IndicatorTick[] = [
      tickAt(FIRST_BAR_MS, 100),
      { timeMs: FIRST_BAR_MS + 1, bid: '0', ask: '0', last: '101.5', volume: 1 },
      { timeMs: FIRST_BAR_MS + 2, bid: '0', ask: '0', last: '0', volume: 1 },
    ];

    const series = buildTickBars(ticks, 2);

    expect(series.bars).toEqual([
      { time: FIRST_BAR_SECONDS, open: 100, high: 101.5, low: 100, close: 101.5, volume: 2 },
    ]);
    expect(series.closedCount).toBe(1);
  });
});

test.describe('projecting N-tick bars onto the chart bars', () => {
  const CHART_BARS: readonly RenderBar[] = [m5Bar(0, 100), m5Bar(1, 200), m5Bar(2, 300)];
  /** Twenty-three ticks half a minute apart: four whole bars of five, and one still forming. */
  const SERIES = buildTickBars(risingTicks(23, 100, FIRST_BAR_MS, 30 * MILLISECONDS_PER_SECOND), 5);

  /** The index each of `chartBars` shows when the values are read `source`'s way. */
  function shownIndexes(chartBars: readonly RenderBar[], source: TickBarSource): readonly number[] {
    return shownTickBars(SERIES, chartBars, SECONDS_PER_M5, source);
  }

  test('a chart bar shows the last tick bar that ended inside it, the forming one included', () => {
    expect(SERIES.closedCount).toBe(4);
    expect(shownIndexes(CHART_BARS, 'last-in-chart-bar')).toEqual([0, 2, 4]);
  });

  test('waiting for closes leaves the forming tick bar out', () => {
    expect(shownIndexes(CHART_BARS, 'last-closed-in-chart-bar')).toEqual([0, 2, 3]);
  });

  test('a chart bar before the ticks, or with none ending inside it, shows no value at all', () => {
    const chartBars = [m5Bar(-1, 90), ...CHART_BARS, m5Bar(3, 400)];

    expect(shownIndexes(chartBars, 'last-in-chart-bar')).toEqual([NO_FRAME_BAR, 0, 2, 4, NO_FRAME_BAR]);
  });
});

test.describe('planning the windows of a tick read', () => {
  const RANGE = { oldestMs: STUB_NOW - 10 * MILLISECONDS_PER_MINUTE, newestMs: STUB_NOW };

  /** The window `walk` asks for next, which these cases always leave it a range and budget for. */
  function requiredWindow(walk: TickWalk): TickWindow {
    const window = nextOlderTickWindow(walk, 200_000, TICK_BUDGET);
    if (window === null) {
      throw new Error('the walk still asks for an older window');
    }
    return window;
  }

  test('a read asks for its newest window first, and a whole page widens the next one', () => {
    const walk = startTickWalk(RANGE);

    expect(requiredWindow(walk)).toEqual({
      fromMs: STUB_NOW - MILLISECONDS_PER_MINUTE,
      toMs: STUB_NOW,
      maxTicks: TICK_BUDGET,
    });
    expect(requiredWindow(coveredTickWalk(walk, requiredWindow(walk)))).toEqual({
      fromMs: STUB_NOW - 3 * MILLISECONDS_PER_MINUTE,
      toMs: STUB_NOW - MILLISECONDS_PER_MINUTE,
      maxTicks: TICK_BUDGET,
    });
  });

  test('a page never asks for more ticks than the budget has left, and none once it is spent', () => {
    const walk = startTickWalk(RANGE);

    expect(nextOlderTickWindow(walk, 200_000, 40)?.maxTicks).toBe(40);
    expect(nextOlderTickWindow(walk, 30, TICK_BUDGET)?.maxTicks).toBe(30);
    expect(nextOlderTickWindow(walk, 200_000, 0)).toBeNull();
  });

  test('the walk stops once it reaches the oldest chart bar, its first window clipped to it', () => {
    const shortRange = { oldestMs: STUB_NOW - 20 * MILLISECONDS_PER_SECOND, newestMs: STUB_NOW };
    const walk = startTickWalk(shortRange);
    const first = requiredWindow(walk);

    expect(first).toEqual({ fromMs: shortRange.oldestMs, toMs: STUB_NOW, maxTicks: TICK_BUDGET });
    expect(nextOlderTickWindow(coveredTickWalk(walk, first), 200_000, TICK_BUDGET)).toBeNull();
  });

  test('a truncated page narrows the window down to a second, then ends the walk', () => {
    let walk = startTickWalk(RANGE);
    const widths: number[] = [];
    for (let narrow = narrowedTickWalk(walk); narrow.windowMs < walk.windowMs; narrow = narrowedTickWalk(walk)) {
      widths.push(narrow.windowMs);
      walk = narrow;
    }

    expect(widths).toEqual([30_000, 15_000, 7_500, 3_750, 1_875]);
    expect(walk.windowMs).toBe(1_875);
    expect(narrowedTickWalk(walk)).toEqual(endedTickWalk(walk));
    expect(nextOlderTickWindow(endedTickWalk(walk), 200_000, TICK_BUDGET)).toBeNull();
  });

  test('a refresh asks for the newest window again, narrowed with the walk', () => {
    const walk = narrowedTickWalk(startTickWalk(RANGE));

    expect(newestTickWindow(walk, 200_000)).toEqual({
      fromMs: STUB_NOW - 30_000,
      toMs: STUB_NOW,
      maxTicks: 200_000,
    });
  });

  test('a chart’s loaded bars ask for ticks from the oldest bar to the end of the newest one', () => {
    const chartBars = [m5Bar(0, 100), m5Bar(1, 110)];

    expect(tickReadRange(chartBars, CHART_TIMEFRAME)).toEqual({
      oldestMs: FIRST_BAR_MS,
      newestMs: (FIRST_BAR_SECONDS + 2 * SECONDS_PER_M5) * MILLISECONDS_PER_SECOND,
    });
    expect(tickReadRange([], CHART_TIMEFRAME)).toBeNull();
  });
});

/** The ticks the page cases feed: three bars of ten, the first two inside the M5 bar before the newest one. */
const FEED_TICKS: IndicatorTick[] = [
  ...risingTicks(20, 100, PREVIOUS_M5_OPEN_MS, 14 * MILLISECONDS_PER_SECOND),
  ...risingTicks(10, 120, NEWEST_M5_OPEN_MS, 14 * MILLISECONDS_PER_SECOND),
];
const FEED: RecordedTicks[] = [{ symbol: 'EURUSD', ticks: FEED_TICKS }];

/** The SMA of the N-tick bars' closes, one value per bar, null until the window is full. */
function tickBarSma(): (number | null)[] {
  const closes = buildTickBars(FEED_TICKS, TICKS_PER_BAR).bars.map((bar) => bar.close);
  return averageOf(closes, SAVED_LENGTH);
}

/** The tick reads the app sent for the chart's symbol, oldest first. */
async function tickRequests(page: Page): Promise<RecordedInvoke[]> {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'request_indicator_ticks' && entry.args.symbol === 'EURUSD');
}

/** Five M5 chart bars ending on the stub's newest one. */
function chartCandles(): Candle[] {
  return [0, 1, 2, 3, 4].map((offsetBars) => ({
    timeMs: NEWEST_M5_OPEN_MS - (4 - offsetBars) * MILLISECONDS_PER_M5,
    open: '1.0850',
    high: '1.0860',
    low: '1.0840',
    close: '1.0855',
    tickVolume: 10,
    spread: 1,
    realVolume: 10,
  }));
}

/** Opens the app on five M5 chart bars with the saved SMA calculating on the tick choice. */
async function openWithTickCalculation(page: Page): Promise<void> {
  const settings = { length: SAVED_LENGTH, [CALCULATION_TIMEFRAME_INPUT]: TICK_CHOICE };
  await gotoWithStub(page, {
    recordedHistory: [{ symbol: 'EURUSD', timeframe: CHART_TIMEFRAME, candles: chartCandles() }],
    recordedTicks: FEED,
    chartSettingOverrides: {
      [EURUSD_CHART]: { indicators: [{ instanceId: 'sma-1', definitionId: 'sma', settings }] },
    },
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(5);
}

test('choosing 10 ticks reads the chart symbol’s ticks and plots the SMA of the bars they build', async ({ page }) => {
  await openWithTickCalculation(page);

  const sma = tickBarSma();
  // The wait switch is on, so the M5 bar before the newest shows its last closed tick bar and the forming M5 bar
  // shows the third one; no tick bar ends inside the three bars before the feed.
  await expect.poll(() => drawnValues(page)).toEqual([sma[1], sma[2]]);
  expect(await drawnTimes(page)).toEqual([PREVIOUS_M5_OPEN_MS, NEWEST_M5_OPEN_MS].map(secondsOf));

  const [request] = await tickRequests(page);
  expect(request.args).toMatchObject({
    symbol: 'EURUSD',
    maxTicks: TICK_BUDGET,
    toMs: NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5,
  });
  expect(Number(request.args.fromMs)).toBeLessThan(Number(request.args.toMs));
});

test('an unavailable ticks answer keeps the values already drawn', async ({ page }) => {
  await openWithTickCalculation(page);
  await expect.poll(async () => (await drawnValues(page)).length).toBe(2);
  const drawnBefore = await drawnValues(page);
  const requestsBefore = (await tickRequests(page)).length;
  await setIndicatorTicksUnavailable(page, true);

  // The forming chart bar closes, so the indicator reads the newest window again and the bridge refuses it.
  const closingPrice = '1.0900';
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: CHART_TIMEFRAME,
    candle: {
      timeMs: NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5,
      open: closingPrice,
      high: closingPrice,
      low: closingPrice,
      close: closingPrice,
      tickVolume: 1,
      spread: 1,
      realVolume: 1,
    },
  });
  await expect.poll(async () => (await tickRequests(page)).length).toBeGreaterThan(requestsBefore);
  const requestsAfterClose = (await tickRequests(page)).length;

  expect(await drawnValues(page)).toEqual(drawnBefore);
  // The refused answer starts no retry: nothing is asked for the ticks again on its own.
  expect((await tickRequests(page)).length).toBe(requestsAfterClose);
});
