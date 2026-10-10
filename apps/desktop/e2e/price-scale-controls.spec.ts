import { test, expect, type Page } from '@playwright/test';
import { observeFillText } from './helpers/canvasText';
import { brokerSymbolFixture, gotoWithStub, pushEvent, STUB_NOW } from './helpers/tauriStub';
import type { Candle } from '../src/shared/bridge/types';

/**
 * Right price-scale toggles: `A` (auto scale — fit the visible data) and `L`
 * (logarithmic prices). The library paints the axis on its own canvas, so the
 * toggles are DOM buttons revealed by a pointer hit test over the axis column
 * (see src/features/chart/engine/priceScaleController.ts). These tests drive REAL pointer
 * positions against the chart host and read the scale back through the DEV
 * `window.__chartTest` hook — no pixel assertions.
 */

interface HostRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ScaleState {
  autoScale: boolean;
  mode: number;
  axisWidth: number;
  paneHeight: number;
  range: { from: number; to: number } | null;
}

const REVEALED = /price-scale-controls-revealed/;

function expectClean({ pageErrors, consoleErrors }: { pageErrors: string[]; consoleErrors: string[] }) {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

async function chartData(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __chartTest?: { data(): unknown[] } };
    return w.__chartTest?.data() ?? [];
  });
}

async function scaleState(page: Page): Promise<ScaleState> {
  return page.evaluate(() => {
    const w = window as unknown as { __chartTest?: { priceScale(): ScaleState } };
    if (!w.__chartTest) {
      throw new Error('chart test hook is missing');
    }
    return w.__chartTest.priceScale();
  });
}

async function hostRect(page: Page): Promise<HostRect> {
  return page.evaluate(() => {
    const el = document.querySelector('.chart-host') as HTMLElement;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/** Page x of the axis column's left edge — the toggles sit to its right. */
function axisX(host: HostRect, scale: ScaleState, inset: number): number {
  return host.left + host.width - scale.axisWidth + inset;
}

/**
 * The row, the host and the pane measured in ONE task. The row's placement is
 * CSS, so reading it separately from the pane it is anchored to would let a
 * resize land between the two reads and compare two different layouts.
 */
async function placement(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const w = window as unknown as { __chartTest?: { priceScale(): ScaleState } };
    const row = document.querySelector('.price-scale-controls');
    const host = document.querySelector('.chart-host');
    if (!w.__chartTest || !row || !host) {
      throw new Error('chart test hook or controls are missing');
    }
    return { row: box(row), host: box(host), scale: w.__chartTest.priceScale() };
  });
}

test('the price-scale toggles appear only over the right price scale and toggle log mode', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  const scale = await scaleState(page);
  const host = await hostRect(page);
  expect(scale.axisWidth).toBeGreaterThan(0);

  const controls = page.locator('.price-scale-controls');
  const autoButton = page.getByRole('button', { name: /^Auto scale/ });
  const logButton = page.getByRole('button', { name: /^Logarithmic/ });
  await expect(controls).not.toHaveClass(REVEALED);

  // Over the plot area: the axis column is untouched, so nothing is revealed.
  await page.mouse.move(host.left + host.width / 2, host.top + host.height / 2);
  await expect(controls).not.toHaveClass(REVEALED);

  // Over the axis itself (the host's middle is inside the pane).
  await page.mouse.move(host.left + host.width - 20, host.top + host.height / 2);
  await expect(controls).toHaveClass(REVEALED);
  await expect(autoButton).toBeVisible();
  await expect(logButton).toBeVisible();
  const { row, host: frame, scale: pane } = await placement(page);
  // Inside the axis column, so it never covers the plot area.
  expect(row.left).toBeGreaterThanOrEqual(frame.right - pane.axisWidth - 1);
  expect(row.right).toBeLessThanOrEqual(frame.right + 1);
  // Anchored to the pane's bottom edge by `bottom: <time axis height>` in
  // features/chart/chart.css — at the bottom of the price scale, never over the time
  // axis below it.
  expect(row.bottom).toBeGreaterThan(frame.top + pane.paneHeight - 40);
  expect(row.bottom).toBeLessThanOrEqual(frame.top + pane.paneHeight + 1);
  // The row is opaque and carries the price scale's own background colour (the
  // chart's `layout.background`, which is what fills the axis canvas), so the
  // labels and ticks behind it are masked instead of showing through.
  expect(await controls.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  // Auto scale is off by default; log mode is off.
  await expect(autoButton).toHaveAttribute('aria-pressed', 'false');
  await expect(logButton).toHaveAttribute('aria-pressed', 'false');

  await logButton.click();
  await expect.poll(async () => (await scaleState(page)).mode).toBe(1);
  await expect(logButton).toHaveAttribute('aria-pressed', 'true');
  await expect(autoButton).toHaveAttribute('aria-pressed', 'false');

  await logButton.click();
  await expect.poll(async () => (await scaleState(page)).mode).toBe(0);
  await expect(logButton).toHaveAttribute('aria-pressed', 'false');

  // Leaving the axis hides the row again.
  await page.mouse.move(host.left + host.width / 2, host.top + host.height / 2);
  await expect(controls).not.toHaveClass(REVEALED);
  expectClean(collected);
});

for (const { gesture, symbol, base, digits } of [
  { gesture: 'plot', symbol: 'XBRUSD', base: 96, digits: 3 },
  { gesture: 'axis', symbol: 'XBRUSD', base: 96, digits: 3 },
  { gesture: 'none', symbol: 'NAS100', base: 31000, digits: 2 },
] as const) {
  test(`${symbol}: switching to log after ${gesture} gesture preserves actual prices`, async ({ page }) => {
    await observeFillText(page, () => {
      const drawn: string[] = [];
      Object.assign(window, { __drawnPrices: drawn });
      return (_context, text) => {
        drawn.push(text);
      };
    });
    const oil = shiftedCandles(1000, base).map((bar) => ({
      ...bar,
      high: (base + 0.4).toFixed(digits),
      low: (base - 0.4).toFixed(digits),
    }));
    const collected = await gotoWithStub(page, {
      historyByTimeframe: { M1: oil, M5: oil },
      responses: {
        get_market_snapshot: { symbol, timeframe: 'M5', complete: true, candles: oil },
        get_quote_snapshot: {
          symbol,
          timeMs: STUB_NOW,
          bid: (base + 0.1).toFixed(digits),
          ask: (base + 0.13).toFixed(digits),
          last: (base + 0.11).toFixed(digits),
          volume: 10,
          volumeReal: '0',
          flags: 0,
        },
      },
      symbolInfo: brokerSymbolFixture(symbol, 'Oil price fixture', {
        digits,
        tickSize: (10 ** -digits).toFixed(digits),
        pointSize: (10 ** -digits).toFixed(digits),
        contractSize: '1',
        tickValueProfit: undefined,
        tickValueLoss: undefined,
        tickValueCurrency: undefined,
      }),
    });
    await expect.poll(async () => (await chartData(page)).length).toBe(1000);
    await page.getByRole('button', { name: '1m', exact: true }).click();
    await expect.poll(async () => (await scaleState(page)).range?.from).toBe(base - 0.4);
    const host = await hostRect(page);
    const scale = await scaleState(page);
    if (gesture !== 'none') {
      const startX = gesture === 'axis' ? axisX(host, scale, 3) : host.left + host.width - scale.axisWidth - 40;
      await page.mouse.move(startX, host.top + scale.paneHeight * 0.4);
      await page.mouse.down();
      await page.mouse.move(startX - (gesture === 'plot' ? 20 : 0), host.top + scale.paneHeight * 0.6, { steps: 12 });
      await page.mouse.up();
    }
    const visible = await page.evaluate(() => window.__chartTest!.visibleRange()!);
    expect(visible.from).toBeLessThan(999);
    expect(visible.to).toBeGreaterThan(0);
    const viewport = await page.evaluate(() => window.__chartTest!.visibleRange());
    const before = (await scaleState(page)).range!;
    if (gesture !== 'none') {
      expect(before).not.toEqual(scale.range);
    }
    await page.mouse.move(host.left + host.width - 20, host.top + host.height / 2);
    await page.evaluate(() => {
      (window as unknown as { __drawnPrices: string[] }).__drawnPrices.length = 0;
    });
    await page.getByRole('button', { name: /^Logarithmic/ }).click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __drawnPrices: string[] }).__drawnPrices.length))
      .toBeGreaterThan(0);
    await expect.poll(async () => (await scaleState(page)).mode).toBe(1);
    const after = (await scaleState(page)).range!;
    expect(after.from).toBeCloseTo(before.from, digits);
    expect(after.to).toBeCloseTo(before.to, digits);
    expect((await scaleState(page)).autoScale).toBe(false);
    expect(await page.evaluate(() => window.__chartTest!.visibleRange())).toEqual(viewport);
    const labels = await page.evaluate(() => (window as unknown as { __drawnPrices: string[] }).__drawnPrices);
    expect(labels.filter((label) => new RegExp(`^\\d+\\.\\d{${digits}}$`).test(label)).length).toBeGreaterThan(0);
    expect(labels.some((label) => /e\+\d+/.test(label))).toBe(false);
    await pushEvent(page, 'bar-update', {
      symbol,
      timeframe: 'M1',
      candle: { ...oil[oil.length - 1], high: (base + 2).toFixed(digits) },
    });
    await expect.poll(async () => await page.evaluate(() => window.__chartTest!.data().at(-1)?.high)).toBe(base + 2);
    expect((await scaleState(page)).range).toEqual(after);
    expectClean(collected);
  });
}

test('A re-fits a manually dragged price scale to the visible data', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  await expect.poll(async () => (await scaleState(page)).range).not.toBeNull();
  const host = await hostRect(page);
  const scale = await scaleState(page);
  const fitted = scale.range!;

  // Drag the axis (left edge of the column, clear of the toggles) to freeze a
  // manual scale: the library turns auto scale off and keeps the new range.
  await page.mouse.move(axisX(host, scale, 3), host.top + scale.paneHeight * 0.25);
  await page.mouse.down();
  await page.mouse.move(axisX(host, scale, 3), host.top + scale.paneHeight * 0.65, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = await scaleState(page);
      return state.autoScale === false && state.range !== null && Math.abs(state.range.from - fitted.from) > 1e-6;
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: /^Auto scale/ })).toHaveAttribute('aria-pressed', 'false');

  // A fits the pane to the data again — the same prices the chart opened with.
  await page.getByRole('button', { name: /^Auto scale/ }).click();
  await expect.poll(async () => (await scaleState(page)).autoScale).toBe(true);
  await expect
    .poll(async () => {
      const range = (await scaleState(page)).range;
      if (range === null) {
        return false;
      }
      return Math.abs(range.from - fitted.from) < 1e-6 && Math.abs(range.to - fitted.to) < 1e-6;
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: /^Auto scale/ })).toHaveAttribute('aria-pressed', 'true');
  expectClean(collected);
});

/** The stub window at another price level, so a replacement is unmistakable. */
function shiftedCandles(count = 10, base = 1.2): Candle[] {
  const lastOpen = Math.floor(STUB_NOW / 300_000) * 300_000;
  return Array.from({ length: count }, (_, index) => ({
    timeMs: lastOpen - (count - 1 - index) * 300_000,
    open: base.toFixed(4),
    high: (base + 0.0004).toFixed(4),
    low: (base - 0.0004).toFixed(4),
    close: (base + 0.0001).toFixed(4),
    tickVolume: 120,
    spread: 2,
    realVolume: 120,
  }));
}

/** High/low extent of the candles the chart holds, as the scale sees them. */
async function dataExtent(page: Page): Promise<{ min: number; max: number }> {
  return page.evaluate(() => {
    const bars = window.__chartTest!.data();
    return {
      min: Math.min(...bars.map((bar) => bar.low)),
      max: Math.max(...bars.map((bar) => bar.high)),
    };
  });
}

test('auto scale is off by default and each loaded series is fitted once', async ({ page }) => {
  const collected = await gotoWithStub(page, { historyByTimeframe: { M1: shiftedCandles() } });
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  await expect.poll(async () => (await scaleState(page)).range).not.toBeNull();

  // Off by default, and fitted to the candles that arrived — the library would
  // otherwise leave the scale wherever it was.
  const autoButton = page.getByRole('button', { name: /^Auto scale/ });
  await expect(autoButton).toHaveAttribute('aria-pressed', 'false');
  const extent = await dataExtent(page);
  const fitted = (await scaleState(page)).range!;
  expect(fitted.from).toBeCloseTo(extent.min, 6);
  expect(fitted.to).toBeCloseTo(extent.max, 6);

  // A replacement at another price level is fitted again, and auto scale stays
  // off: the scale follows the data it was given, not the ticks.
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  await expect
    .poll(async () => (await scaleState(page)).range)
    .toEqual(expect.objectContaining({ from: 1.1996, to: 1.2004 }));
  expect((await scaleState(page)).autoScale).toBe(false);
  await expect(autoButton).toHaveAttribute('aria-pressed', 'false');

  // A tick that moves the price out of that range must not rescale the pane.
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M1',
    candle: { ...shiftedCandles(1)[0], high: '1.2600', low: '1.1000' },
  });
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  await page.waitForTimeout(150);
  expect((await scaleState(page)).range).toEqual(expect.objectContaining({ from: 1.1996, to: 1.2004 }));
  expectClean(collected);
});

test('loading oil-priced candles in log mode keeps the range in actual prices', async ({ page }) => {
  const oil = shiftedCandles(10, 96);
  const collected = await gotoWithStub(page, { historyByTimeframe: { M1: oil } });
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await scaleState(page)).range).toEqual({ from: 95.9996, to: 96.0004 });
  const host = await hostRect(page);
  await page.mouse.move(host.left + host.width - 20, host.top + host.height / 2);
  await page.getByRole('button', { name: /^Logarithmic/ }).click();
  await expect.poll(async () => (await scaleState(page)).mode).toBe(1);
  await expect.poll(async () => (await scaleState(page)).range).toEqual({ from: 95.9996, to: 96.0004 });

  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect.poll(async () => (await scaleState(page)).range?.to).toBeLessThan(2);
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await scaleState(page)).range).toEqual({ from: 95.9996, to: 96.0004 });
  expect((await scaleState(page)).mode).toBe(1);
  expect((await scaleState(page)).autoScale).toBe(false);
  const extent = await dataExtent(page);
  expect(extent).toEqual({ min: 95.9996, max: 96.0004 });
  await page.mouse.move(host.left + host.width - 20, host.top + host.height / 2);
  await page.getByRole('button', { name: /^Logarithmic/ }).click();
  expect((await scaleState(page)).mode).toBe(0);
  expect((await scaleState(page)).range?.from).toBeCloseTo(95.9996, 6);
  expect((await scaleState(page)).range?.to).toBeCloseTo(96.0004, 6);
  expectClean(collected);
});
