import { test, expect, type Page } from '@playwright/test';
import { seedStoredValue } from './helpers/pageStorage';
import {
  brokerSymbolFixture,
  expectNoErrors,
  gotoWithStub,
  pushEvent,
  STUB_NOW,
  stubInvocations,
} from './helpers/tauriStub';
import { chartIntervalOf, type AggregatedInterval } from '../src/shared/bridge/chartIntervalModel';
import { seriesBarsOf, seriesTimeframeOf } from '../src/shared/bridge/chartIntervals';
import { AggregatedSeries } from '../src/features/bridge/market/aggregatedSeries';
import { aggregatedBlockStartMs } from '../src/features/chart/engine/bars/aggregatedBars';
import { lastChartSelectionKey } from '../src/features/bridge/lastChartSelection/lastChartSelection';
import type { Candle } from '../src/shared/bridge/types';

const MINUTE_MS = 60_000;

/** Midnight UTC of 2024-01-03, the day the minute blocks of these tests count from. */
const MIDNIGHT_MS = Date.UTC(2024, 0, 3);

/** The M1 candle opening `minute` minutes after midnight, its prices taken from its own minute. */
const m1Candle = (minute: number): Candle => ({
  timeMs: MIDNIGHT_MS + minute * MINUTE_MS,
  open: `${100 + minute}.00`,
  high: `${101 + minute}.00`,
  low: `${99 + minute}.00`,
  close: `${100 + minute}.75`,
  tickVolume: 10 + minute,
  spread: 1,
  realVolume: 0,
});

/** The M1 candles of the minutes `first` through `last`, oldest first, as a window or page sends them. */
const m1Candles = (first: number, last: number): Candle[] =>
  Array.from({ length: last - first + 1 }, (_, index) => m1Candle(first + index));

/** The fields of an aggregated candle this file pins; its open, high, low, close and volume. */
interface AggregatedFields {
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly tickVolume: number;
}

/** The M7 candle of the block opening `minute` minutes after midnight. */
const m7Candle = (minute: number, fields: AggregatedFields): Candle => ({
  timeMs: MIDNIGHT_MS + minute * MINUTE_MS,
  ...fields,
  spread: 1,
  realVolume: 0,
});

/** The aggregated interval `code` names, for a series under test. */
const aggregated = (code: string): AggregatedInterval => {
  const interval = chartIntervalOf(code);
  if (interval?.kind !== 'aggregated') {
    throw new Error(`${code} is not an aggregated interval`);
  }
  return interval;
};

test('an aggregated interval asks the bridge for its base series, never for its own code', () => {
  expect(seriesTimeframeOf('M7')).toBe('M1');
  expect(seriesTimeframeOf('M90')).toBe('M30');
  expect(seriesTimeframeOf('H5')).toBe('H1');
  expect(seriesTimeframeOf('D5')).toBe('D1');
  expect(seriesTimeframeOf('MN4')).toBe('MN1');
  expect(seriesTimeframeOf('M5')).toBe('M5');
  expect(seriesTimeframeOf('BOGUS')).toBe('BOGUS');
});

test('a pane of aggregated bars asks for a base bar for every block it groups', () => {
  expect(seriesBarsOf('M7', 500)).toBe(3500);
  expect(seriesBarsOf('MN4', 500)).toBe(2000);
  expect(seriesBarsOf('M5', 500)).toBe(500);
});

test('an M1 window draws M7 candles counted and priced by hand, its partial oldest block held back', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  // 00:03 through 00:20: the 00:00 block opened before the window, so it waits for an older page.
  const candles = series.window(m1Candles(3, 20));
  expect(candles).toEqual([
    m7Candle(7, { open: '107.00', high: '114.00', low: '106.00', close: '113.75', tickVolume: 140 }),
    m7Candle(14, { open: '114.00', high: '121.00', low: '113.00', close: '120.75', tickVolume: 189 }),
  ]);
});

test('an older page completes the held block and is prepended once', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(3, 20));
  const prepended = series.olderPage(m1Candles(0, 2));
  expect(prepended).toEqual([
    m7Candle(0, { open: '100.00', high: '107.00', low: '99.00', close: '106.75', tickVolume: 91 }),
  ]);
});

test('a page that began mid-block is held in its turn, until the page before it completes it', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(7, 20));
  // 00:01 through 00:06 hold only part of the 00:00 block, whose first base candle is still missing.
  expect(series.olderPage(m1Candles(1, 6))).toEqual([]);
  expect(series.olderPage(m1Candles(0, 0))).toEqual([
    m7Candle(0, { open: '100.00', high: '107.00', low: '99.00', close: '106.75', tickVolume: 91 }),
  ]);
});

test('an empty page, the end of history, adds nothing and keeps the held block', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(3, 20));
  expect(series.olderPage([])).toEqual([]);
  expect(series.olderPage(m1Candles(0, 2))).toEqual([
    m7Candle(0, { open: '100.00', high: '107.00', low: '99.00', close: '106.75', tickVolume: 91 }),
  ]);
});

test('a live base candle of the forming block replaces its own and is never counted twice', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(7, 13));
  const revised = { ...m1Candle(13), high: '112.00', low: '111.50', close: '111.75', tickVolume: 5 };
  expect(series.live(revised)).toEqual(
    m7Candle(7, { open: '107.00', high: '113.00', low: '106.00', close: '111.75', tickVolume: 122 }),
  );
});

test('a live base candle of a newer block opens an aggregated candle', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(7, 13));
  expect(series.live(m1Candle(14))).toEqual(
    m7Candle(14, { open: '114.00', high: '115.00', low: '113.00', close: '114.75', tickVolume: 24 }),
  );
});

test('a live base candle of an older block leaves the forming candle alone', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(7, 13));
  expect(series.live(m1Candle(3))).toEqual(
    m7Candle(7, { open: '107.00', high: '114.00', low: '106.00', close: '113.75', tickVolume: 140 }),
  );
});

test('reset forgets every block, so the next live candle opens one of its own', () => {
  const series = new AggregatedSeries(aggregated('M7'));
  series.window(m1Candles(3, 20));
  series.reset();
  expect(series.live(m1Candle(0))).toEqual(
    m7Candle(0, { open: '100.00', high: '101.00', low: '99.00', close: '100.75', tickVolume: 10 }),
  );
});

const MILLISECONDS_PER_SECOND = 1_000;

/** The symbol and intervals these on-screen tests save, request and draw. */
const SYMBOL = 'EURUSD';
const AGGREGATED_CODE = 'M7';
const BASE_TIMEFRAME = 'M1';

/** One aggregated block of the shown interval, on the minute grid its base candles are grouped by. */
const BLOCK_MS = 7 * MINUTE_MS;
const BLOCK_SECONDS = BLOCK_MS / MILLISECONDS_PER_SECOND;

/** The stub's demo account, the identity a saved chart window is stored under. */
const SAVED_ACCOUNT_KEY = '50123456@Broker-Demo';
const SAVED_SELECTION = { symbol: SYMBOL, timeframe: AGGREGATED_CODE };

const AGGREGATED_INTERVAL = aggregated(AGGREGATED_CODE);

/** The start of the aggregated block holding `timeMs`, taken from the grid the series itself groups by. */
const blockStartMs = (timeMs: number): number => aggregatedBlockStartMs(AGGREGATED_INTERVAL, timeMs);

/** The forming block of the saved window: the one holding the minute STUB_NOW falls in. */
const FORMING_BLOCK_START_MS = blockStartMs(Math.floor(STUB_NOW / MINUTE_MS) * MINUTE_MS);
const FORMING_BLOCK_START_SECONDS = FORMING_BLOCK_START_MS / MILLISECONDS_PER_SECOND;

/** The price scale the M1 fixtures are written on: five decimals, one price unit being 100 000 ticks. */
const PRICE_DECIMALS = 5;
const PRICE_TICKS_PER_UNIT = 10 ** PRICE_DECIMALS;

/** The decimal text of `ticks`, counted in 0.00001, so no fixture price is rounded by a float. */
const priceText = (ticks: number): string => (ticks / PRICE_TICKS_PER_UNIT).toFixed(PRICE_DECIMALS);

/** The seven M1 candles of one block: their open and close as offsets in ticks above the block's base price. */
const BLOCK_LADDER = [
  { openTicks: 0, closeTicks: 4 },
  { openTicks: 4, closeTicks: 1 },
  { openTicks: 1, closeTicks: 6 },
  { openTicks: 6, closeTicks: 9 },
  { openTicks: 9, closeTicks: 5 },
  { openTicks: 5, closeTicks: 2 },
  { openTicks: 2, closeTicks: 3 },
] as const;

type LadderRow = (typeof BLOCK_LADDER)[number];

/** The ticks the ladder puts between a candle's open and close and the high and low around them. */
const WICK_TICKS = 3;

/** The M1 candle opening at `timeMs`, its prices the ladder row `row` above `baseTicks`. */
const ladderCandle = (timeMs: number, baseTicks: number, row: LadderRow): Candle => {
  const openTicks = baseTicks + row.openTicks;
  const closeTicks = baseTicks + row.closeTicks;
  return {
    timeMs,
    open: priceText(openTicks),
    high: priceText(Math.max(openTicks, closeTicks) + WICK_TICKS),
    low: priceText(Math.min(openTicks, closeTicks) - WICK_TICKS),
    close: priceText(closeTicks),
    tickVolume: 10,
    spread: 1,
    realVolume: 0,
  };
};

/** The M1 candles of the `minutes` first minutes of the block opening at `startMs`. */
const blockCandles = (startMs: number, baseTicks: number, minutes: number): Candle[] => {
  const blockRows = BLOCK_LADDER.slice(0, minutes);
  return blockRows.map((row, minute) => ladderCandle(startMs + minute * MINUTE_MS, baseTicks, row));
};

/**
 * The blocks the saved window covers, oldest first: three whole M7 blocks and the forming one, of which
 * the window holds only its `minutes` first minutes. Every block's OHLC below is written out from its seven
 * M1 candles: the first candle's open, the highest high, the lowest low and the last candle's close.
 */
const SAVED_WINDOW_BLOCKS = [
  { blocksAgo: 3, baseTicks: 110_000, minutes: 7, open: 1.1, high: 1.10012, low: 1.09997, close: 1.10003 },
  { blocksAgo: 2, baseTicks: 111_000, minutes: 7, open: 1.11, high: 1.11012, low: 1.10997, close: 1.11003 },
  { blocksAgo: 1, baseTicks: 112_000, minutes: 7, open: 1.12, high: 1.12012, low: 1.11997, close: 1.12003 },
  { blocksAgo: 0, baseTicks: 113_000, minutes: 1, open: 1.13, high: 1.13007, low: 1.12997, close: 1.13004 },
] as const;

/** The M1 history the stub answers the base timeframe request with, oldest first. */
const savedWindowHistory = (): Candle[] =>
  SAVED_WINDOW_BLOCKS.flatMap(({ blocksAgo, baseTicks, minutes }) =>
    blockCandles(FORMING_BLOCK_START_MS - blocksAgo * BLOCK_MS, baseTicks, minutes),
  );

/** The five fields of a drawn bar these tests pin; the chart reports its time in seconds and prices as numbers. */
interface DrawnBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** The M7 candles the restored window must draw, oldest first: every block's hand-written OHLC at its own time. */
const expectedSavedWindowBars = (): DrawnBar[] =>
  SAVED_WINDOW_BLOCKS.map(({ blocksAgo, open, high, low, close }) => ({
    time: FORMING_BLOCK_START_SECONDS - blocksAgo * BLOCK_SECONDS,
    open,
    high,
    low,
    close,
  }));

/** The forming M7 candle once the live minute inside it traded: same open and low, a higher high and new close. */
const MOVED_FORMING_BAR: DrawnBar = {
  time: FORMING_BLOCK_START_SECONDS,
  open: 1.13,
  high: 1.1302,
  low: 1.12997,
  close: 1.13015,
};

/** The M7 candle the first live minute of the block after the forming one opens. */
const NEXT_BLOCK_BAR: DrawnBar = {
  time: FORMING_BLOCK_START_SECONDS + BLOCK_SECONDS,
  open: 1.14,
  high: 1.14007,
  low: 1.13997,
  close: 1.14004,
};

/** The four prices of a candle, in the decimal text the bridge sends them in. */
interface CandlePrices {
  open: string;
  high: string;
  low: string;
  close: string;
}

/** The live M1 candle the bridge pushes at `timeMs`, its four prices written here. */
const liveCandle = (timeMs: number, prices: CandlePrices): Candle => ({
  timeMs,
  ...prices,
  tickVolume: 10,
  spread: 1,
  realVolume: 0,
});

/** A live minute inside the forming block, trading above its history: the forming M7 candle must move. */
const LIVE_INSIDE_FORMING_BLOCK = liveCandle(FORMING_BLOCK_START_MS + MINUTE_MS, {
  open: '1.13004',
  high: '1.13020',
  low: '1.13002',
  close: '1.13015',
});

/** A live minute opening the block after the forming one: it must add an M7 candle. */
const LIVE_NEXT_BLOCK = liveCandle(FORMING_BLOCK_START_MS + BLOCK_MS, {
  open: '1.14000',
  high: '1.14007',
  low: '1.13997',
  close: '1.14004',
});

/** The page errors the stub collected, checked with `expectNoErrors` when a test ends. */
type CollectedErrors = Awaited<ReturnType<typeof gotoWithStub>>;

/** The bars the chart currently draws, oldest first, reduced to the fields these tests pin. */
const drawnBars = async (page: Page): Promise<DrawnBar[]> => {
  const bars = await page.evaluate(() => window.__chartTest?.data() ?? []);
  return bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
};

/** The newest drawn bar, the candle a live base candle moves or opens. */
const newestBar = async (page: Page): Promise<DrawnBar | undefined> => (await drawnBars(page)).at(-1);

/** The timeframes of the history pages the app asked the bridge for. */
const historyTimeframes = async (page: Page): Promise<unknown[]> => {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'request_history').map((entry) => entry.args.timeframe);
};

/** Whether any invocation carried `timeframe`, whatever command sent it. */
const anyInvocationCarried = async (page: Page, timeframe: string): Promise<boolean> => {
  const invocations = await stubInvocations(page);
  return invocations.some((entry) => entry.args.timeframe === timeframe);
};

/** The seconds between every drawn bar and the one before it. */
const gapsBetweenBars = (bars: readonly DrawnBar[]): number[] =>
  bars.slice(1).flatMap((bar, index) => {
    const previous = bars[index];
    return previous === undefined ? [] : [bar.time - previous.time];
  });

/** Every drawn candle opens exactly one aggregated block after the one before it. */
const expectOneBlockApart = (bars: readonly DrawnBar[]): void => {
  const oneBlockApart = Array.from({ length: bars.length - 1 }, () => BLOCK_SECONDS);
  expect(gapsBetweenBars(bars)).toEqual(oneBlockApart);
};

/** Pushes the bridge's bar update for one M1 candle, the base series of the shown interval. */
const pushLiveCandle = async (page: Page, candle: Candle): Promise<void> => {
  await pushEvent(page, 'bar-update', { symbol: SYMBOL, timeframe: BASE_TIMEFRAME, candle });
};

/** Opens the app on a saved EURUSD M7 window and waits until the bridge was asked for its M1 series. */
const openSavedM7Window = async (page: Page): Promise<CollectedErrors> => {
  await seedStoredValue(page, lastChartSelectionKey, JSON.stringify({ [SAVED_ACCOUNT_KEY]: SAVED_SELECTION }));
  const collected = await gotoWithStub(page, {
    brokerSymbols: [brokerSymbolFixture(SYMBOL, 'Euro vs US Dollar')],
    recordedHistory: [{ symbol: SYMBOL, timeframe: BASE_TIMEFRAME, candles: savedWindowHistory() }],
  });
  await expect.poll(() => historyTimeframes(page)).toContain(BASE_TIMEFRAME);
  return collected;
};

/** Waits until the restored window is on screen as `expectedSavedWindowBars` and returns what it drew. */
const waitForSavedWindow = async (page: Page): Promise<DrawnBar[]> => {
  await expect.poll(() => drawnBars(page)).toEqual(expectedSavedWindowBars());
  return drawnBars(page);
};

test.describe('an aggregated interval on screen', () => {
  test('a saved M7 window asks the bridge for M1 and draws 7-minute candles', async ({ page }) => {
    const collected = await openSavedM7Window(page);
    const bars = await waitForSavedWindow(page);

    expect(await anyInvocationCarried(page, AGGREGATED_CODE)).toBe(false);
    expectOneBlockApart(bars);
    expectNoErrors(collected);
  });

  test('a live M1 candle moves the forming M7 candle and opens the next one', async ({ page }) => {
    const collected = await openSavedM7Window(page);
    const bars = await waitForSavedWindow(page);

    await pushLiveCandle(page, LIVE_INSIDE_FORMING_BLOCK);
    await expect.poll(() => newestBar(page)).toEqual(MOVED_FORMING_BAR);
    expect(await drawnBars(page)).toHaveLength(bars.length);

    await pushLiveCandle(page, LIVE_NEXT_BLOCK);
    await expect.poll(() => newestBar(page)).toEqual(NEXT_BLOCK_BAR);
    const grown = await drawnBars(page);
    expect(grown).toHaveLength(bars.length + 1);
    expectOneBlockApart(grown);
    expectNoErrors(collected);
  });
});
