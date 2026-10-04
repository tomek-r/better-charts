import { test, expect, type Page } from '@playwright/test';
import { gotoWithStub, pushEvent, STUB_NOW } from './tauriStub';
import type { Candle } from '../src/shared/bridge/types';

const quote = (timeMs: number, bid: string, ask: string) => ({
  symbol: 'EURUSD',
  timeMs,
  bid,
  ask,
  last: bid,
  volume: 10,
  volumeReal: '0',
  flags: 0,
});
const candle = {
  timeMs: STUB_NOW,
  open: '1.0854',
  high: '1.0858',
  low: '1.0848',
  close: '1.0852',
  tickVolume: 130,
  spread: 2,
  realVolume: 130,
};

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

/**
 * Widths of the price tags, paired with the text each box carries: the library
 * draws box, fill, then text for every label, so the next text after a box is
 * that box's own.
 */
async function tagWidths(page: Page): Promise<number[]> {
  const ops = await page.evaluate(
    () => (window as unknown as { __tagOps: Array<{ kind: string; width: number; text: string }> }).__tagOps,
  );
  const widths: number[] = [];
  let pending: number | null = null;
  for (const op of ops) {
    if (op.kind === 'box') {
      pending = op.width;
    } else if (op.kind === 'text' && pending !== null) {
      if (op.text.startsWith('1.08521') || op.text.startsWith('1.08524')) {
        widths.push(Number(pending.toFixed(1)));
      }
      pending = null;
    }
  }
  return [...new Set(widths)].sort((left, right) => left - right);
}

async function openChart(page: Page) {
  await page.addInitScript(() => {
    const ops: Array<{ kind: string; width: number; text: string }> = [];
    (window as unknown as { __tagOps: typeof ops }).__tagOps = ops;
    const onAxis = (context: CanvasRenderingContext2D) => context.canvas.width <= 120 && context.canvas.height > 120;
    const roundRect = CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
      if (onAxis(this)) {
        ops.push({ kind: 'box', width: Number(w), text: '' });
      }
      return roundRect.call(this, x, y, w, h, radii);
    };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (onAxis(this)) {
        ops.push({ kind: 'text', width: 0, text: String(text) });
      }
      if (maxWidth === undefined) {
        fillText.call(this, text, x, y);
      } else {
        fillText.call(this, text, x, y, maxWidth);
      }
    };
  });
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T12:01:00Z'));
  await gotoWithStub(page, {});
  await page.clock.runFor(100);
  await page.evaluate(() =>
    (
      window as unknown as { __chartTest: { scrollToRange(range: { from: number; to: number }): void } }
    ).__chartTest.scrollToRange({ from: -2, to: 14 }),
  );
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
  // library measures a '1' narrower than a '0', so the tags are width-matched.
  expect(await tagWidths(page)).toHaveLength(1);

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

/**
 * A window whose price labels are wide enough to push the axis past the minimum
 * the chart configures. Below that minimum the axis cannot change size at all, so
 * only a wider label can reveal the resizing this test is about.
 */
function wideCandles(count: number, base = 30432): Candle[] {
  const lastOpen = Math.floor(STUB_NOW / 300_000) * 300_000;
  return Array.from({ length: count }, (_, index) => ({
    timeMs: lastOpen - (count - 1 - index) * 300_000,
    open: base.toFixed(4),
    high: (base + 0.0006).toFixed(4),
    low: (base - 0.0006).toFixed(4),
    close: (base + 0.0004).toFixed(4),
    tickVolume: 120,
    spread: 2,
    realVolume: 120,
  }));
}

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
