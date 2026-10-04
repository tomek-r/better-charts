import { test, expect, type Page } from '@playwright/test';
import { gotoWithStub, stubInvocations, STUB_NOW } from './tauriStub';
import type { Candle } from '../src/shared/bridge/types';

const INTERVAL_MS = 300_000;
/** A window wide enough that the default view shows no space before it. */
const WINDOW_BARS = 400;
const PAGE_BARS = 5;

/**
 * Deterministic window candles ending `endOffsetBars` intervals before the fixed
 * stub clock. `base` marks a timeframe's series, so a page wrongly merged into
 * the wrong selection shows up in the oldest bar's price.
 */
function windowCandles(count: number, base = 1.085, endOffsetBars = 0): Candle[] {
  const lastOpen = Math.floor(STUB_NOW / INTERVAL_MS) * INTERVAL_MS - endOffsetBars * INTERVAL_MS;
  return Array.from({ length: count }, (_, index) => ({
    timeMs: lastOpen - (count - 1 - index) * INTERVAL_MS,
    open: base.toFixed(4),
    high: (base + 0.001).toFixed(4),
    low: (base - 0.001).toFixed(4),
    close: (base + 0.0005).toFixed(4),
    tickVolume: 120,
    spread: 2,
    realVolume: 120,
  }));
}

async function data(page: Page) {
  return page.evaluate(() => window.__chartTest?.data() ?? []);
}
async function visibleRange(page: Page) {
  return page.evaluate(() => window.__chartTest?.visibleRange() ?? null);
}
async function pages(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history_page');
}

/** Bars whose x lands inside the pane — the user-visible "candles are on screen". */
async function barsOnScreen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const chart = window.__chartTest!;
    const width = document.querySelector('.chart-host')!.getBoundingClientRect().width;
    return chart.data().filter((bar) => {
      const x = chart.timeToX(bar.time * 1000);
      return Number.isFinite(x) && x >= 0 && x <= width;
    }).length;
  });
}

/**
 * Bars between the pane's right edge and the newest candle. Bar spacing survives a
 * timeframe switch, so this is also the pixel offset — the position the user left
 * the view at.
 */
async function barsFromLast(page: Page): Promise<number> {
  return page.evaluate(() => {
    const chart = window.__chartTest!;
    const bars = chart.data();
    const range = chart.visibleRange();
    if (!bars.length || !range) {
      return Number.NaN;
    }
    return bars.length - 1 - Math.min(range.to, bars.length - 1);
  });
}

/** Pixels between the newest candle and the pane's right edge; negative = on screen. */
async function newestBarOffsetPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const chart = window.__chartTest!;
    const bars = chart.data();
    const host = document.querySelector('.chart-host')!.getBoundingClientRect().width;
    const paneWidth = host - chart.priceScale().axisWidth;
    return bars.length ? chart.timeToX(bars[bars.length - 1].time * 1000) - paneWidth : 0;
  });
}

/**
 * Waits for the window and for the app to settle. The startup sequence issues a
 * second market snapshot (the initial history request) shortly after the first,
 * and its `setData` re-anchors whatever a test has just set — so a test must not
 * touch the viewport until the invocation log shows it has landed.
 */
async function ready(page: Page) {
  await expect.poll(async () => (await data(page)).length).toBe(WINDOW_BARS);
  await expect
    .poll(async () => (await stubInvocations(page)).some((entry) => entry.cmd === 'request_history'))
    .toBe(true);
  await page.waitForTimeout(250);
  await expect.poll(async () => (await pages(page)).length).toBe(0);
}

test('revealing space before the oldest bar prepends a page and keeps the view anchored', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS) },
    olderHistoryPages: 2,
    olderHistoryBars: PAGE_BARS,
  });
  await ready(page);

  const before = await data(page);
  const oldest = before[0].time;

  // A negative logical index exposes empty space left of the data: the trigger.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 8 }));
  await expect.poll(async () => (await data(page)).length).toBe(WINDOW_BARS + PAGE_BARS);

  const after = await data(page);
  // The page asked for bars strictly older than the oldest bar it held.
  const requests = await pages(page);
  expect(requests).toHaveLength(1);
  expect(requests[0].args).toMatchObject({
    symbol: 'EURUSD',
    timeframe: 'M5',
    bars: 1000,
    beforeMs: oldest * 1000,
  });
  // ...and the bars are exactly the intervals immediately before it.
  expect(after.slice(0, PAGE_BARS).map((bar) => bar.time)).toEqual(
    Array.from({ length: PAGE_BARS }, (_, index) => oldest - (PAGE_BARS - index) * (INTERVAL_MS / 1000)),
  );
  // The bars that were on screen are untouched.
  expect(after.slice(-5)).toEqual(before.slice(-5));

  // Prepending shifted every logical index by the number of bars added, so the
  // requested range [-2, 8] is re-anchored to [3, 13]: the bars that were on
  // screen stay on screen, and the empty space is consumed — which is what keeps
  // this from requesting another page on its own.
  await expect.poll(async () => await visibleRange(page)).toEqual({ from: 3, to: 13 });
});

test('paging stops when the broker reports the end of history', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS) },
    olderHistoryPages: 1,
    olderHistoryBars: PAGE_BARS,
  });
  await ready(page);

  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 8 }));
  await expect.poll(async () => (await data(page)).length).toBe(WINDOW_BARS + PAGE_BARS);
  const oldest = (await data(page))[0].time;

  // A second reveal asks again; this time the broker answers short, so nothing
  // is added and the chart latches the end of history.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -6, to: 4 }));
  await expect.poll(async () => (await pages(page)).length).toBe(2);
  expect((await data(page)).length).toBe(WINDOW_BARS + PAGE_BARS);
  expect((await data(page))[0].time).toBe(oldest);

  // Further panning left must not re-ask.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -20, to: -6 }));
  await page.waitForTimeout(200);
  expect(await pages(page)).toHaveLength(2);
});

test('switching timeframe after paging keeps candles on screen', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS), M1: windowCandles(60, 1.2, 12) },
    olderHistoryPages: 1,
    olderHistoryBars: 400,
  });
  await ready(page);

  // Page once, then park the view 40% deep into the longer series, which the 1m
  // window (five hours, ending an hour ago) cannot reach.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 8 }));
  await expect.poll(async () => (await data(page)).length).toBe(WINDOW_BARS + 400);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: 359, to: 479 }));

  // The pane must show candles rather than inherit a logical index that means a
  // different time on this interval...
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await data(page)).some((bar) => bar.open === 1.2)).toBe(true);

  // ...and it must be filled. This offset is deeper than the 1m window reaches, so
  // the view lands on the oldest bars it can show (here its end anchor, the series
  // being shorter than the pane) instead of parking over empty space.
  await expect.poll(async () => await barsOnScreen(page)).toBeGreaterThan(50);
});

test('switching timeframe keeps the view where it was left, not at the right edge', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    // 1m is long enough to hold the parked offset: 400 bars ending an hour ago.
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS), M1: windowCandles(400, 1.2, 12) },
    olderHistoryPages: 1,
    olderHistoryBars: 400,
  });
  await ready(page);

  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 8 }));
  await expect.poll(async () => (await data(page)).length).toBe(WINDOW_BARS + 400);
  // Park the right edge 120 bars before the newest candle, far enough from the
  // 1m series' start that the new pane needs no older bars of its own.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: 559, to: 679 }));
  // The library applies a logical range on its next update, so the read has to
  // wait for the pan to be in effect rather than assume it is synchronous.
  await expect.poll(async () => (await visibleRange(page))?.to).toBe(679);
  const parked = await barsFromLast(page);
  expect(parked).toBe(120);

  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await data(page)).some((bar) => bar.open === 1.2)).toBe(true);

  // The view keeps its horizontal offset: the same number of bars sit between the
  // right edge and the newest candle, so the chart does not drift back to the
  // right edge. Bar spacing is unchanged across the switch, so that offset is
  // also the same number of pixels.
  await expect.poll(async () => await barsFromLast(page)).toBe(parked);
  expect(await newestBarOffsetPx(page)).toBeGreaterThan(0);
});

test('switching timeframe from a deep position keeps the view instead of sliding right', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS), M1: windowCandles(400, 1.2) },
    olderHistoryPages: 1,
    olderHistoryBars: 400,
    // Hold the page open, so the position the view lands in is observable.
    olderHistoryDelayMs: 800,
  });
  await ready(page);

  // Page once, then sit at the oldest bars: the second request is answered with
  // no bars, which is how the client learns this is the end of history.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 8 }));
  await expect.poll(async () => (await data(page)).length).toBe(WINDOW_BARS + 400);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -50, to: 70 }));
  await expect.poll(async () => (await pages(page)).length).toBe(2);

  // That position is deeper than the 1m window reaches, so it lands on the 1m
  // window's oldest bars — with the space those left behind. The pane must not
  // slide right to fill itself: that is a jump of a full pane (~120 bars) away
  // from where the view was left.
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await data(page)).some((bar) => bar.open === 1.2)).toBe(true);
  const landed = await visibleRange(page);
  expect(landed?.to).toBeLessThan(5);
  expect(landed?.from).toBeLessThan(0);

  // The space is filled by a page instead, which shifts the pane by exactly the
  // bars it added: the oldest 1m bars stay where they were put.
  await expect.poll(async () => (await pages(page)).length).toBe(3);
  await expect.poll(async () => await barsOnScreen(page)).toBeGreaterThan(50);
  expect((await visibleRange(page))?.to).toBeCloseTo((landed?.to ?? 0) + 400, 0);
});

test('switching timeframe keeps a view scrolled into the right margin', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS), M1: windowCandles(WINDOW_BARS, 1.2) },
    olderHistoryPages: 0,
  });
  await ready(page);

  // Drag the chart left, so empty space opens up to the right of the newest
  // candle: the right edge ends 40 bars past the last bar.
  const end = (await visibleRange(page))!.to;
  await page.evaluate((to) => window.__chartTest?.scrollToRange({ from: to - 120, to }), end + 40);
  await expect.poll(async () => (await visibleRange(page))?.to).toBeCloseTo(end + 40, 0);

  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await data(page)).some((bar) => bar.open === 1.2)).toBe(true);

  // The margin is part of the position: the new series carries the same one, so
  // the pane keeps the space on the right instead of being pulled to the newest
  // candles. Nothing is paged either — the view is over real bars.
  await expect.poll(async () => (await visibleRange(page))?.to).toBeCloseTo(end + 40, 0);
  expect(await pages(page)).toHaveLength(0);
});

test('a page in flight for the previous timeframe is not prepended after a switch', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
    },
    historyByTimeframe: { M5: windowCandles(WINDOW_BARS), M1: windowCandles(WINDOW_BARS, 1.2) },
    olderHistoryPages: 1,
    olderHistoryBars: PAGE_BARS,
    // The page lands well after the timeframe switch it raced.
    olderHistoryDelayMs: 400,
  });
  await ready(page);

  // Reveal the gap, then park the view back on real bars before switching: the
  // carried-over offset leaves the new selection with no gap of its own to load,
  // so only the race is under test.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 8 }));
  await expect.poll(async () => (await pages(page)).length).toBe(1);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: 80, to: 200 }));
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await data(page))[0]?.open).toBe(1.2);
  expect((await data(page)).length).toBe(WINDOW_BARS);

  // The late M5 page arrives after the switch. Prepending it would add the
  // page's bars, at the M5 price, ahead of the M1 series.
  await page.waitForTimeout(500);
  const bars = await data(page);
  expect(bars).toHaveLength(WINDOW_BARS);
  expect(bars[0].open).toBe(1.2);
  expect(await pages(page)).toHaveLength(1);
});
