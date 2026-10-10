import { test, expect, type Page } from '@playwright/test';
import { observeFillText } from './helpers/canvasText';
import { eurusdFormingBar, eurusdQuote, gotoWithStub, pushEvent, STUB_NOW } from './helpers/tauriStub';

const quote = (timeMs: number) => eurusdQuote(timeMs);
const candle = eurusdFormingBar;

interface Paint {
  text: string;
  at: number;
}

/**
 * The countdown is painted by the library on the price axis canvas, so the tests
 * observe the canvas itself: every `fillText` on the price-axis column is
 * recorded with the frame's time. Tick labels are prices and the time axis is a
 * different canvas, so a `mm:ss` draw can only be the countdown.
 */
async function recordAxisText(page: Page) {
  await observeFillText(page, () => {
    const paints: Paint[] = [];
    (window as unknown as { __axisText: Paint[] }).__axisText = paints;
    return (context, text) => {
      // The price axis is the narrow, tall column right of the pane.
      if (context.canvas.width <= 100 && context.canvas.height > 100) {
        paints.push({ text: String(text), at: performance.now() });
      }
    };
  });
}
async function axisPaints(page: Page): Promise<Paint[]> {
  return page.evaluate(() => (window as unknown as { __axisText: Paint[] }).__axisText);
}
async function countdownPaints(page: Page): Promise<Paint[]> {
  return (await axisPaints(page)).filter((paint) => /^\d{2}:\d{2}(:\d{2})?$/.test(paint.text));
}
/**
 * The newest painted axis frame: every draw of a frame stamps the same time, so
 * the text on screen right now is whatever that frame painted. Reading the last
 * countdown paint instead would keep reporting a tag that has since been erased.
 */
async function axisFrame(page: Page): Promise<Paint[]> {
  const paints = await axisPaints(page);
  if (paints.length === 0) {
    return [];
  }
  const last = Math.max(...paints.map((paint) => paint.at));
  return paints.filter((paint) => paint.at === last);
}
async function countdownText(page: Page): Promise<string> {
  const painted = (await axisFrame(page)).filter((paint) => /^\d{2}:\d{2}(:\d{2})?$/.test(paint.text));
  return painted.length === 0 ? '' : painted[painted.length - 1].text;
}
async function clearAxisPaints(page: Page): Promise<void> {
  await page.evaluate(() => ((window as unknown as { __axisText: Paint[] }).__axisText.length = 0));
}
/** Frames that painted no countdown: the tag was not on the axis in that frame. */
async function framesWithoutTag(page: Page): Promise<number[]> {
  const frames = new Map<number, boolean>();
  for (const paint of await axisPaints(page)) {
    frames.set(paint.at, (frames.get(paint.at) ?? false) || /^\d{2}:\d{2}(:\d{2})?$/.test(paint.text));
  }
  return [...frames.entries()].filter(([, hasTag]) => !hasTag).map(([at]) => at);
}
async function clockNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function start(page: Page, historyDelayMs = 0) {
  await recordAxisText(page);
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T12:01:00Z'));
  const errors = await gotoWithStub(page, { historyDelayMs });
  await page.clock.runFor(historyDelayMs + 100);
  await expect(page.getByLabel('Candle OHLC')).toContainText('EURUSD');
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
  await page.clock.runFor(50);
  return errors;
}
async function activate(page: Page, timeframe = 'M5', offset = 15_500) {
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe, candle });
  await pushEvent(page, 'quote-update', quote(STUB_NOW + offset - 1000));
  await pushEvent(page, 'quote-update', quote(STUB_NOW + offset));
  await page.clock.runFor(50);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
  await page.clock.runFor(16);
}

test('price-axis countdown follows broker time, ignores repeated/old quotes and expires without rolling over', async ({
  page,
}, testInfo) => {
  const errors = await start(page);
  expect(await countdownText(page)).toBe(''); // Historical last bar is already closed.
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
  await pushEvent(page, 'quote-update', quote(STUB_NOW));
  await pushEvent(page, 'quote-update', quote(STUB_NOW - 1000));
  await page.clock.runFor(50);
  expect(await countdownText(page)).toBe(''); // A cached first tick cannot start a countdown.
  await activate(page);
  expect(await countdownText(page)).toBe('04:45'); // Desktop clock is intentionally a different year.
  await expect(page.getByLabel('Candle OHLC')).not.toContainText('04:45');
  await page.screenshot({ path: testInfo.outputPath('bar-countdown.png') });
  await page.clock.runFor(1000);
  expect(await countdownText(page)).toBe('04:44');
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 15_500));
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 10_000));
  await page.clock.runFor(1000);
  expect(await countdownText(page)).toBe('04:43');
  await page.clock.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  await page.clock.runFor(1000);
  expect(await countdownText(page)).toBe('04:42');
  // Expiry repaints the axis without the tag, rather than leaving it behind.
  await clearAxisPaints(page);
  await page.clock.runFor(282_000);
  expect((await axisFrame(page)).length).toBeGreaterThan(0); // the axis repainted
  expect(await countdownText(page)).toBe(''); // without the tag
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    candle: { ...candle, timeMs: STUB_NOW + 300_000 },
  });
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 310_500));
  await page.clock.runFor(1000);
  expect(await countdownText(page)).toBe('04:49');
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('countdown flips on the broker second, not on a repeating interval', async ({ page }) => {
  await start(page);
  // The quote offset is 15_500 ms, so the broker clock is 500 ms into a second
  // when the tick is accepted, and the tag turns over 500 ms later. `start` and
  // `activate` advance the fake clock by 216 ms in total, so the first boundary
  // is 434 ms after `activate` returns and the next one is 1000 ms after that.
  await activate(page);
  expect(await countdownText(page)).toBe('04:45');
  const t0 = await clockNow(page);
  // Let frames the setup left pending paint, so from here on nothing but the
  // countdown's own wake-up invalidates the chart.
  await clearAxisPaints(page);
  await page.clock.runFor(100);
  await page.clock.runFor(300);
  expect(await countdownText(page)).toBe('04:45'); // 34 ms short of the boundary
  await page.clock.runFor(70); // past the boundary, without waiting out a whole interval
  await page.clock.runFor(32); // paint the chart the countdown invalidated
  const flip = (await countdownPaints(page)).filter((paint) => paint.text === '04:44');
  expect(flip).not.toHaveLength(0);
  expect(Math.min(...flip.map((paint) => paint.at))).toBeGreaterThanOrEqual(t0 + 434);
  expect(Math.min(...flip.map((paint) => paint.at))).toBeLessThanOrEqual(t0 + 434 + 48);
  await page.clock.runFor(700);
  expect(await countdownText(page)).toBe('04:44'); // unchanged mid-second
  await clearAxisPaints(page);
  await page.clock.runFor(800); // cross the next boundary
  await page.clock.runFor(32);
  const next = (await countdownPaints(page)).filter((paint) => paint.text === '04:43');
  expect(next).not.toHaveLength(0);
  expect(Math.min(...next.map((paint) => paint.at))).toBeGreaterThanOrEqual(t0 + 1434);
  expect(Math.min(...next.map((paint) => paint.at))).toBeLessThanOrEqual(t0 + 1434 + 48);
});

test('a hidden tab stops waking up and resyncs its tag when shown again', async ({ page }) => {
  const setHidden = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await start(page);
  await activate(page);
  expect(await countdownText(page)).toBe('04:45');
  await page.clock.runFor(100); // flush frames the setup left pending
  await setHidden(true);
  // Background tabs throttle and clamp timers; the countdown stops instead of
  // piling up wake-ups, so the axis is not repainted at all while hidden.
  await clearAxisPaints(page);
  await page.clock.runFor(2100);
  expect(await axisPaints(page)).toEqual([]);
  await setHidden(false);
  const shown = await clockNow(page);
  await page.clock.runFor(32);
  expect(await countdownText(page)).toBe('04:43'); // correct on return, not one tick later
  const resync = (await countdownPaints(page)).filter((paint) => paint.text === '04:43');
  expect(Math.min(...resync.map((paint) => paint.at))).toBeLessThanOrEqual(shown + 48);
});

test('timeframe loading hides the old timer and hourly/daily bars use hours', async ({ page }) => {
  await start(page, 500);
  await activate(page);
  expect(await countdownText(page)).toBe('04:45');
  await clearAxisPaints(page);
  await page.getByRole('button', { name: '4H', exact: true }).click();
  await page.clock.runFor(50);
  expect(await countdownText(page)).toBe('');
  await page.clock.runFor(500);
  await activate(page, 'H4', 20_000);
  expect(await countdownText(page)).toBe('03:59:40');
  await page.getByRole('button', { name: '1D', exact: true }).click();
  await page.clock.runFor(550);
  await activate(page, 'D1', 30_000);
  expect(await countdownText(page)).toBe('23:59:30');
});

/** Advance the fake clock while keeping a live tick in step with it. */
async function feed(page: Page, t0: number, brokerOffset: number, ms: number) {
  const now = await clockNow(page);
  await pushEvent(page, 'quote-update', quote(STUB_NOW + brokerOffset + Math.round(now - t0)));
  await page.clock.runFor(ms);
}

test('the tag rolls into the next bar at a close with a live feed instead of going blank', async ({ page }) => {
  await start(page);
  // Begin within the last second rather than replaying almost five minutes
  // of timer callbacks just to reach the rollover under test.
  await activate(page, 'M5', 299_500);
  const t0 = await clockNow(page);
  // activate renders for 50 + 16 ms after accepting the final quote.
  const brokerOffset = 299_500 + 66;
  expect(await countdownText(page)).toBe('00:01');
  await clearAxisPaints(page);
  // Cross the close with ticks still arriving: MT5 confirms the new bar with
  // its first tick, which has not arrived yet, so the tag must roll over rather
  // than blink off for that gap.
  for (let step = 0; step < 12; step += 1) {
    await feed(page, t0, brokerOffset, 100);
  }
  expect(await countdownText(page)).toBe('05:00');
  expect(await framesWithoutTag(page)).toEqual([]);
});

test('an idle countdown wakes the axis about once a second, not once a frame', async ({ page }) => {
  await start(page);
  await activate(page);
  await page.clock.runFor(100);
  await clearAxisPaints(page);
  await page.clock.runFor(5000);
  const frames = new Set((await axisPaints(page)).map((paint) => paint.at));
  // Counting one second at a time repaints the axis and its overlay canvas, so
  // five seconds is about ten frames; a per-frame loop would be hundreds.
  expect(frames.size).toBeGreaterThanOrEqual(4); // it kept counting
  expect(frames.size).toBeLessThanOrEqual(14);
});

test('disconnection clears the quote clock and reconnect requires a fresh quote', async ({ page }) => {
  await start(page);
  await activate(page);
  expect(await countdownText(page)).toBe('04:45');
  await pushEvent(page, 'bridge-status', { state: 'disconnected' });
  await clearAxisPaints(page);
  await page.clock.runFor(50);
  expect(await countdownText(page)).toBe('');
  await pushEvent(page, 'bridge-status', {
    state: 'connected',
    terminal: 'MT5 Demo',
    account: '50123456',
    server: 'Broker-Demo',
  });
  await page.clock.runFor(100);
  expect(await countdownText(page)).toBe('');
  await pushEvent(page, 'market-snapshot', { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: [candle] });
  await page.clock.runFor(50);
  expect(await countdownText(page)).toBe('');
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 24_000));
  await page.clock.runFor(50);
  expect(await countdownText(page)).toBe(''); // Reconnect's first tick can also be cached.
  await activate(page, 'M5', 25_000);
  expect(await countdownText(page)).toBe('04:35');
  await page.clock.runFor(1600);
  expect(await countdownText(page)).toMatch(/^04:3[34]$/);
});
