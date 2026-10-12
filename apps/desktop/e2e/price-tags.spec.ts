import { test, expect, type Page } from '@playwright/test';
import { assembleGlyphRows, observeFillText, type AxisPaint } from './helpers/canvasText';
import {
  brokerSymbolFixture,
  eurusdFormingBar,
  eurusdQuote,
  gotoWithStub,
  pushEvent,
  STUB_NOW,
} from './helpers/tauriStub';
import type { Candle } from '../src/shared/bridge/types';

const quote = eurusdQuote;
const candle = eurusdFormingBar;

interface Bands {
  ask?: [number, number];
  bid?: [number, number];
}

/**
 * The price axis is painted by the library, so these read its pixels: where the
 * green Ask tag and the red Bid tag (with the countdown under it) sit.
 *
 * The quote's last price alternates between the Bid and the Ask tick, and the
 * library's label alignment splits its labels around that price — which used to
 * restack a close Bid/Ask pair on every tick. The tags are now positioned from
 * the prices themselves, so they hold their places and their distance.
 */
function readTagBands(page: Page): Promise<Bands> {
  return page.evaluate(() => {
    const found = new Map<string, { min: number; max: number }>();
    for (const canvas of document.querySelectorAll('canvas')) {
      if (canvas.width > 120 || canvas.height < 120) {
        continue;
      }
      const context = canvas.getContext('2d');
      if (context === null) {
        continue;
      }
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          const isAsk =
            Math.abs(data[i] - 38) < 20 && Math.abs(data[i + 1] - 166) < 20 && Math.abs(data[i + 2] - 154) < 20;
          const isBid =
            Math.abs(data[i] - 247) < 20 && Math.abs(data[i + 1] - 82) < 20 && Math.abs(data[i + 2] - 95) < 20;
          let colour = '';
          if (isAsk) {
            colour = 'ask';
          } else if (isBid) {
            colour = 'bid';
          }
          if (colour === '') {
            continue;
          }
          const band = found.get(colour) ?? { min: y, max: y };
          band.min = Math.min(band.min, y);
          band.max = Math.max(band.max, y);
          found.set(colour, band);
        }
      }
    }
    const result: Bands = {};
    for (const [colour, band] of found.entries()) {
      if (colour === 'ask' || colour === 'bid') {
        result[colour] = [band.min, band.max];
      }
    }
    return result;
  });
}

interface AxisOp extends AxisPaint {
  kind: 'box' | 'text';
  width: number;
}

const PRICE_TEXT = /^\d+\.\d+$/;

/** The newest painted axis frame: every draw of a frame stamps the same time. */
async function lastFrameOps(page: Page): Promise<AxisOp[]> {
  const ops = await page.evaluate(() => (window as unknown as { __tagOps: AxisOp[] }).__tagOps);
  const last = Math.max(...ops.map((op) => op.at));
  return ops.filter((op) => op.at === last);
}

/** Boxes of the Ask and Bid tags (top two on the axis; the countdown is third), top first. */
async function tagBoxes(page: Page): Promise<AxisOp[]> {
  const boxes = (await lastFrameOps(page)).filter((op) => op.kind === 'box').sort((a, b) => a.y - b.y);
  return boxes.slice(0, 2);
}

/** Ask and Bid tag texts rebuilt from their glyph draws, top (Ask) first. */
async function tagRows(page: Page) {
  const paints = (await lastFrameOps(page)).filter((op) => op.kind === 'text');
  return assembleGlyphRows(paints)
    .filter((row) => PRICE_TEXT.test(row.text))
    .sort((a, b) => a.y - b.y);
}

async function openChart(page: Page, stub: Parameters<typeof gotoWithStub>[1] = {}) {
  await page.addInitScript(() => {
    const ops: AxisOp[] = [];
    (window as unknown as { __tagOps: AxisOp[] }).__tagOps = ops;
    const onAxis = (context: CanvasRenderingContext2D) => context.canvas.width <= 120 && context.canvas.height > 120;
    const roundRect = CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
      if (onAxis(this)) {
        ops.push({ kind: 'box', width: Number(w), text: '', at: performance.now(), x: Number(x), y: Number(y) });
      }
      return roundRect.call(this, x, y, w, h, radii);
    };
  });
  await observeFillText(page, () => {
    const ops = (window as unknown as { __tagOps: AxisOp[] }).__tagOps;
    return (context, text, x, y) => {
      if (context.canvas.width <= 120 && context.canvas.height > 120) {
        ops.push({ kind: 'text', width: 0, text: String(text), at: performance.now(), x, y });
      }
    };
  });
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T12:01:00Z'));
  await gotoWithStub(page, stub);
  await page.clock.runFor(100);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
  await page.clock.runFor(50);
}

test('Bid and Ask tags stay readable and unmoved when the last price moves between them', async ({
  page,
}, testInfo) => {
  await openChart(page);
  // Five points apart on this scale is inside one tag height: the case that used
  // to be restacked on every tick, and that overlapped when the labels were left
  // on their prices.
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
  await pushEvent(page, 'quote-update', quote(STUB_NOW + 15_500, '1.08521', '1.08524'));
  await page.clock.runFor(100);
  const settled = await readTagBands(page);
  expect(settled.ask).toBeDefined();
  expect(settled.bid).toBeDefined();
  // Separated: the Bid tag does not cover the Ask tag.
  expect((settled.ask as [number, number])[1]).toBeLessThan((settled.bid as [number, number])[0]);
  // One column: the two prices are the same length but differ in digits, and the
  // chart font is proportional, so the tags are drawn in fixed digit cells.
  const [askBox, bidBox] = await tagBoxes(page);
  expect(askBox.width).toBe(bidBox.width);
  expect((await tagRows(page)).map((row) => row.text)).toEqual(['1.08524', '1.08521']);

  for (let index = 0; index < 6; index += 1) {
    await pushEvent(page, 'quote-update', quote(STUB_NOW + 15_700 + index * 300, '1.08521', '1.08524'));
    // MT5 confirms the candle with the price of the tick that moved it, so the
    // series' last price alternates between the two sides of the spread.
    await pushEvent(page, 'bar-update', {
      symbol: 'EURUSD',
      timeframe: 'M5',
      candle: { ...candle, close: index % 2 ? '1.08521' : '1.08524' },
    });
    await page.clock.runFor(300);
    expect(await readTagBands(page)).toEqual(settled);
  }
  await page.screenshot({
    path: testInfo.outputPath('price-tags.png'),
    clip: { x: 1060, y: 340, width: 220, height: 160 },
  });
});

test('Bid and Ask tags keep one box width and fixed digit cells whichever digits the price shows', async ({ page }) => {
  await openChart(page);
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
  const layouts: Array<{ widths: number[]; glyphXs: number[][] }> = [];
  // Same length, different digits: narrow glyphs ("1") against wide ones ("8").
  for (const [index, [bid, ask]] of [
    ['1.08511', '1.08514'],
    ['1.08577', '1.08578'],
    ['1.08498', '1.08499'],
  ].entries()) {
    await pushEvent(page, 'quote-update', quote(STUB_NOW + 15_500 + index * 300, bid, ask));
    await page.clock.runFor(100);
    const rows = await tagRows(page);
    expect(rows.map((row) => row.text)).toEqual([ask, bid]);
    layouts.push({
      widths: (await tagBoxes(page)).map((box) => box.width),
      glyphXs: rows.map((row) => row.glyphXs),
    });
  }
  const [reference, ...others] = layouts;
  expect(reference.widths[0]).toBe(reference.widths[1]);
  for (const layout of others) {
    expect(layout).toEqual(reference);
  }
});

/**
 * A window whose price labels are wide enough to push the axis past the minimum
 * the chart configures. Below that minimum the axis cannot change size at all, so
 * only a wider label can reveal the resizing this test is about.
 */
function wideCandles(count: number, base = 30432, digits = 4): Candle[] {
  const lastOpen = Math.floor(STUB_NOW / 300_000) * 300_000;
  const step = 10 ** -digits;
  return Array.from({ length: count }, (_, index) => ({
    timeMs: lastOpen - (count - 1 - index) * 300_000,
    open: base.toFixed(digits),
    high: (base + 6 * step).toFixed(digits),
    low: (base - 6 * step).toFixed(digits),
    close: (base + 4 * step).toFixed(digits),
    tickVolume: 120,
    spread: 2,
    realVolume: 120,
  }));
}

test('the axis is already wide enough for the tags in the first frame after a quote', async ({ page }) => {
  // Two-digit prices: the scale's own labels are narrower than the tag boxes.
  const candles = wideCandles(60, 31000, 2);
  await openChart(page, {
    responses: { get_market_snapshot: { symbol: 'NAS100', timeframe: 'M5', complete: true, candles } },
    historyByTimeframe: { M5: candles },
    symbolInfo: brokerSymbolFixture('NAS100', 'Index fixture', { digits: 2, tickSize: '0.01', pointSize: '0.01' }),
  });
  const axisWidth = () => page.evaluate(() => window.__chartTest!.priceScale().axisWidth);

  await pushEvent(page, 'quote-update', { ...quote(STUB_NOW + 15_000, '31000.04', '31000.06'), symbol: 'NAS100' });
  // One frame: widening the axis only after the tags were painted would move the
  // pane (and the visible bars) a frame later.
  await page.clock.runFor(17);
  const [askBox] = await tagBoxes(page);
  expect(askBox.width).toBeGreaterThan(0);
  const firstFrame = await axisWidth();
  expect(firstFrame).toBeGreaterThanOrEqual(askBox.width);
  await page.clock.runFor(300);
  expect(await axisWidth()).toBe(firstFrame);
});

test('a Bid/Ask tag leaving the pane does not resize the axis', async ({ page }) => {
  const candles = wideCandles(60);
  await gotoWithStub(page, {
    responses: { get_market_snapshot: { symbol: 'NAS100', timeframe: 'M5', complete: true, candles } },
    historyByTimeframe: { M5: candles },
  });
  const bars = () => page.evaluate(() => window.__chartTest?.data().length ?? 0);
  await expect.poll(bars).toBe(60);
  await page.waitForTimeout(300);
  const axisWidth = () => page.evaluate(() => window.__chartTest?.priceScale().axisWidth ?? 0);
  const midBarX = () =>
    page.evaluate(() => {
      const chart = window.__chartTest!;
      const bars = chart.data();
      return chart.timeToX(bars[Math.floor(bars.length / 2)].time * 1000);
    });

  // A price inside the visible range draws both tags on the axis. Their boxed
  // labels are wider than the scale's own, so the axis takes that width.
  await pushEvent(page, 'quote-update', { ...quote(STUB_NOW + 15_000, '30432.0005', '30432.0009'), symbol: 'NAS100' });
  await page.waitForTimeout(150);
  const width = await axisWidth();
  const x = await midBarX();
  expect(width).toBeGreaterThan(0);

  // Out of view and back, repeatedly. A tag that stops being drawn used to narrow
  // the axis by its box, which widened the pane and slid the whole chart sideways
  // on every crossing — a price sitting on that boundary shook the chart.
  for (let index = 0; index < 6; index += 1) {
    const offset = 15_300 + index * 300;
    await pushEvent(page, 'quote-update', {
      ...quote(
        STUB_NOW + offset,
        index % 2 === 0 ? '30432.0005' : '31000.00',
        index % 2 === 0 ? '30432.0009' : '31000.40',
      ),
      symbol: 'NAS100',
    });
    await page.waitForTimeout(150);
    expect(await axisWidth()).toBe(width);
    expect(await midBarX()).toBeCloseTo(x, 1);
  }
});
