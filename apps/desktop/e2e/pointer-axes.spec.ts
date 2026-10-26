import { test, expect, type Page } from '@playwright/test';
import { eurusdFormingBar, eurusdQuote, gotoWithStub, pushEvent, STUB_NOW } from './helpers/tauriStub';
import type { PointerReadout } from '../src/features/chart/engine/legend/pointerReadoutPrimitive';

/**
 * The pointer's price and time readouts live ON the axes: the price pill at the
 * pointer y on the price-axis canvas, the time pill at the pointer x on the
 * time-axis canvas, both over every other tag. Nothing readout-like is painted in
 * the pane. These tests read the canvases' pixels (palette: accent #6de0ac,
 * Ask #26a69a, Bid #f7525f), so they see what is actually drawn where.
 */

type Rgb = readonly [number, number, number];
type Surface = 'price' | 'time' | 'pane';
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ACCENT: Rgb = [0x6d, 0xe0, 0xac];
const ASK: Rgb = [0x26, 0xa6, 0x9a];
const BID: Rgb = [0xf7, 0x52, 0x5f];
/** `palette.border`, the pill background. */
const PILL_BACKGROUND: Rgb = [0x2b, 0x38, 0x4b];
/** priceTagHeight(11): the Bid/Ask/countdown tag height the price pill must match. */
const PRICE_TAG_HEIGHT = 19;

/** Bounding box and pixel count of one colour, over a rectangle of every canvas of a surface. */
async function scan(page: Page, surface: Surface, rgb: Rgb, rect?: Box): Promise<{ count: number; box: Box | null }> {
  return page.evaluate(
    ({ surface, rgb, rect }) => {
      let count = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const canvas of document.querySelectorAll('canvas')) {
        const isPrice = canvas.width <= 120 && canvas.height > 120;
        const isTime = canvas.height <= 60 && canvas.width > 300;
        const isPane = canvas.width > 300 && canvas.height > 120;
        if (!{ price: isPrice, time: isTime, pane: isPane }[surface]) {
          continue;
        }
        const context = canvas.getContext('2d');
        if (context === null) {
          continue;
        }
        const area = rect ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
        const left = Math.max(0, Math.floor(area.x));
        const top = Math.max(0, Math.floor(area.y));
        const width = Math.min(canvas.width - left, Math.ceil(area.width));
        const height = Math.min(canvas.height - top, Math.ceil(area.height));
        if (width <= 0 || height <= 0) {
          continue;
        }
        const { data } = context.getImageData(left, top, width, height);
        for (let row = 0; row < height; row += 1) {
          for (let column = 0; column < width; column += 1) {
            const i = (row * width + column) * 4;
            if (
              Math.abs(data[i] - rgb[0]) < 12 &&
              Math.abs(data[i + 1] - rgb[1]) < 12 &&
              Math.abs(data[i + 2] - rgb[2]) < 12
            ) {
              count += 1;
              minX = Math.min(minX, left + column);
              maxX = Math.max(maxX, left + column);
              minY = Math.min(minY, top + row);
              maxY = Math.max(maxY, top + row);
            }
          }
        }
      }
      return {
        count,
        box: count === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      };
    },
    { surface, rgb, rect },
  );
}

const readout = (page: Page): Promise<PointerReadout | null> =>
  page.evaluate(() => window.__chartTest?.pointerReadout() ?? null);

const axisWidth = (page: Page): Promise<number> => page.evaluate(() => window.__chartTest?.priceScale().axisWidth ?? 0);

async function openChart(page: Page): Promise<void> {
  await gotoWithStub(page);
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(10);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle: eurusdFormingBar });
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 15_500, '1.08521', '1.08524'));
  await expect.poll(async () => (await scan(page, 'price', ASK)).count).toBeGreaterThan(0);
}

/** Centre y of one tag colour on the price axis, in axis-canvas px. */
async function tagCentre(page: Page, rgb: Rgb): Promise<number> {
  const { box } = await scan(page, 'price', rgb);
  return box!.y + box!.height / 2;
}

test.describe('pointer readouts on the axes', () => {
  test('the price readout sits on the price axis at the pointer y without widening it', async ({ page }) => {
    await openChart(page);
    const host = (await page.locator('.chart-host').boundingBox())!;
    const width = await axisWidth(page);
    const y = 150;
    await page.mouse.move(host.x + 400, host.y + y);
    await expect.poll(async () => (await scan(page, 'price', ACCENT)).count).toBeGreaterThan(0);
    const bar = (await scan(page, 'price', ACCENT)).box!;
    // The accent bar is the pill's left edge: flush with the axis' left edge, one tag high, on the pointer.
    expect(bar.x).toBe(0);
    expect(bar.height).toBe(PRICE_TAG_HEIGHT);
    // The whole-pixel top of an odd-height pill puts its centre half a pixel off the pointer.
    expect(Math.abs(bar.y + bar.height / 2 - y)).toBeLessThanOrEqual(0.5);
    const box = (await readout(page))!.priceLabelBox!;
    // The pill fills the axis canvas across and is exactly as tall as the Bid/Ask tags.
    expect(box.x).toBe(0);
    expect(box.width).toBe(width);
    expect(box.height).toBe(PRICE_TAG_HEIGHT);
    const paintedWidth = await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].find((c) => c.width <= 120 && c.height > 120);
      return canvas?.width ?? 0;
    });
    expect(box.width).toBe(paintedWidth);
    expect(Math.abs(box.y + box.height / 2 - y)).toBeLessThanOrEqual(0.5);
    // Hovering, moving and leaving never change the axis width.
    for (const moveY of [60, 220, 300]) {
      await page.mouse.move(host.x + 400, host.y + moveY);
      await expect.poll(async () => (await readout(page))?.y).toBe(moveY);
      expect(await axisWidth(page)).toBe(width);
    }
    await page.mouse.move(host.x + 400, host.y - 40);
    await expect.poll(async () => await readout(page)).toBeNull();
    expect(await axisWidth(page)).toBe(width);
  });

  test('the price readout paints over the Ask and Bid tags', async ({ page }) => {
    await openChart(page);
    const host = (await page.locator('.chart-host').boundingBox())!;
    for (const [rgb, name] of [
      [ASK, 'Ask'],
      [BID, 'Bid'],
    ] as const) {
      const centre = await tagCentre(page, rgb);
      expect((await scan(page, 'price', ACCENT)).count, `${name} before hover`).toBe(0);
      await page.mouse.move(host.x + 400, host.y + Math.round(centre));
      await expect.poll(async () => (await scan(page, 'price', ACCENT)).count).toBeGreaterThan(0);
      const box = (await readout(page))!.priceLabelBox!;
      // Under the pill there is no tag colour left: the readout is the topmost axis paint.
      const covered = await scan(page, 'price', rgb, {
        x: box.x,
        y: box.y + 1,
        width: box.width,
        height: box.height - 2,
      });
      expect(covered.count, `${name} tag visible through the readout`).toBe(0);
      await page.mouse.move(host.x + 400, host.y - 40);
      await expect.poll(async () => (await scan(page, 'price', ACCENT)).count).toBe(0);
    }
  });

  test('the time readout sits on the time axis centred on the pointer x', async ({ page }) => {
    await openChart(page);
    const host = (await page.locator('.chart-host').boundingBox())!;
    const x = 500;
    await page.mouse.move(host.x + x, host.y + 150);
    await expect.poll(async () => (await scan(page, 'time', ACCENT)).count).toBeGreaterThan(0);
    const bar = (await scan(page, 'time', ACCENT)).box!;
    // The accent bar is the pill's top edge: on the axis' first row, spanning the pill, centred on the pointer.
    expect(bar.y).toBe(0);
    expect(bar.x + bar.width / 2).toBeCloseTo(x, 0);
    const box = (await readout(page))!.timeLabelBox!;
    expect(box.y).toBe(0);
    expect(box.x + box.width / 2).toBeCloseTo(x, 0);
    // The pill fills the time axis canvas top to bottom.
    const timeAxisHeight = await page.evaluate(() => window.__chartTest!.priceScale().timeAxisHeight);
    expect(box.height).toBe(timeAxisHeight);
    expect(bar.height).toBe(2);
    const pillRows = (await scan(page, 'time', PILL_BACKGROUND)).box!;
    expect(pillRows.y + pillRows.height).toBe(timeAxisHeight);
    // Near the right edge the pill is pushed back inside the axis instead of overflowing it.
    const paneWidth = host.width - (await axisWidth(page));
    await page.mouse.move(host.x + paneWidth - 4, host.y + 150);
    await expect.poll(async () => Math.round((await readout(page))?.x ?? 0)).toBe(Math.round(paneWidth - 4));
    const edge = (await readout(page))!.timeLabelBox!;
    expect(edge.x + edge.width).toBeLessThanOrEqual(paneWidth + 1);
  });

  test('nothing pointer-related is painted in the pane', async ({ page }) => {
    await openChart(page);
    const host = (await page.locator('.chart-host').boundingBox())!;
    await page.mouse.move(host.x + 500, host.y + 150);
    await expect.poll(async () => (await readout(page)) !== null).toBe(true);
    await page.waitForTimeout(250);
    // The pills' accent bars are the app accent: neither may appear in the pane.
    expect((await scan(page, 'pane', ACCENT)).count).toBe(0);
  });
});
