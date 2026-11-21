import { expect, test, type Page } from '@playwright/test';
import { TICKS_PER_PAGE } from '../src/shared/bridge/config';
import {
  TICK_INTERVALS,
  intervalLabel,
  intervalLongLabel,
  intervalSection,
  isTickInterval,
} from '../src/shared/bridge/chartIntervals';
import { lastChartSelectionKey } from '../src/features/bridge/lastChartSelection/lastChartSelection';
import { CHART_TICK_BUDGET } from '../src/features/bridge/market/chartTickBars';
import { foldTick, tickBarTimeline } from '../src/features/chart/engine/bars/tickBarTimeline';
import type { IndicatorTick } from '../src/shared/bridge/types';
import { assembleGlyphRows, clearPriceAxisPaints, priceAxisPaints, recordPriceAxisText } from './helpers/canvasText';
import { openChart } from './helpers/openChart';
import { readStoredJson } from './helpers/pageStorage';
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
