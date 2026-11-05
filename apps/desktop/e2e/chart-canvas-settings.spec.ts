import { expect, test, type Page } from '@playwright/test';
import { ColorType, LineStyle } from 'lightweight-charts';
import type { ChartAppearanceState } from '../src/features/chart/engine/surface/devTestApi';
import { palette } from '../src/shared/theme/palette';
import { decodePng, parseHexColor, pixelAt } from './helpers/pngPixels';
import { chartScopeKey, expectNoErrors, gotoWithStub } from './helpers/tauriStub';

/**
 * The chart the Canvas tab's settings draw: its background, its grid lines, the crosshair, the
 * scales' text and lines, and its margins. Every one of them is one of the chart's settings, so it
 * is the template's until this chart overrides it for the account and symbol it shows.
 */

/** The account key the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, so the backend keys its settings that way. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** A gradient no default could be mistaken for. */
const SEEDED_TOP_COLOR = '#101010';
const SEEDED_BOTTOM_COLOR = '#303030';
/** Empty bars after the last one, well away from the default five. */
const SEEDED_RIGHT_MARGIN = 12;
/** A crosshair three times as thick as the default one. */
const SEEDED_CROSSHAIR_WIDTH = 3;
/** A red no palette colour is, so only the seeded crosshair can paint it. */
const SEEDED_CROSSHAIR_COLOR = '#ff0000';
/** The seeded crosshair's colour as a screenshot decodes it. */
const SEEDED_CROSSHAIR_RGB = parseHexColor(SEEDED_CROSSHAIR_COLOR).join();
/** Where in the pane the pointer rests while a crosshair line is measured. */
const POINTER = { x: 300, y: 150 };
/** Half the pane slice a line's thickness is counted across. */
const LINE_CLIP_HALF_WIDTH = 8;
/** How far above the pointer the slice is taken, clear of the horizontal line. */
const LINE_CLIP_ABOVE_POINTER = 30;

/** What the chart is drawn with right now, read back through the DEV test hook. */
async function appearance(page: Page): Promise<ChartAppearanceState> {
  return page.evaluate(() => window.__chartTest!.appearance());
}

/** Waits for the stub's ten bars, so a seeded setting lands on a chart that has something to draw. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}

/** Empty slots between the last bar and the pane's right edge: the right margin as the user sees it. */
async function rightGap(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.visibleRange()!.to - (window.__chartTest!.data().length - 1));
}

/** Selects the crosshair tool the way the owner does: the pointer group's icon, then its row in the menu. */
async function selectCrosshairTool(page: Page): Promise<void> {
  await page.locator('.tool-rail button[aria-label="Pointer tools"]').click();
  await page.locator('.tool-flyout').getByRole('menuitemradio', { name: 'Crosshair pointer' }).click();
}

/** Device pixels of the crosshair's own colour across one row of the pane: how thick it draws the line. */
async function drawnCrosshairWidth(page: Page, pointer: { x: number; y: number }): Promise<number> {
  const clip = {
    x: pointer.x - LINE_CLIP_HALF_WIDTH,
    y: pointer.y - LINE_CLIP_ABOVE_POINTER,
    width: 2 * LINE_CLIP_HALF_WIDTH,
    height: 1,
  };
  const row = decodePng(await page.screenshot({ clip }));
  const colors = Array.from({ length: row.width }, (_, x) => pixelAt(row, x, 0));
  return colors.filter((color) => color.join() === SEEDED_CROSSHAIR_RGB).length;
}

test('a default chart keeps the background, grids, scales and margins it has always had', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const defaults = await appearance(page);
  expect(defaults.layout).toEqual({
    background: { type: ColorType.Solid, color: palette.overlay },
    textColor: palette.mutedStrong,
    fontSize: 11,
  });
  expect(defaults.grid.vertLines).toEqual({ visible: true, color: palette.borderSubtle, style: LineStyle.Solid });
  expect(defaults.grid.horzLines).toEqual({ visible: true, color: palette.borderSubtle, style: LineStyle.Solid });
  expect(defaults.rightPriceScaleBorder).toBe(palette.border);
  expect(defaults.timeScaleBorder).toBe(palette.border);
  expect(defaults.scaleMargins).toEqual({ top: 0.12, bottom: 0.18 });
  expect(defaults.rightMarginBars).toBe(5);
  expect(defaults.crosshair).toEqual({ color: palette.textLabel, style: 'solid', width: 1 });
  expectNoErrors(collected);
});

test('a chart whose vertical grid was turned off draws none, and keeps the horizontal one', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: { canvas: { verticalGrid: { visible: false, color: palette.borderSubtle, style: 'dashed' } } },
    },
  });
  await openChart(page);

  await expect.poll(async () => (await appearance(page)).grid.vertLines.visible).toBe(false);
  await expect.poll(async () => (await appearance(page)).grid.vertLines.style).toBe(LineStyle.LargeDashed);
  expect((await appearance(page)).grid.vertLines.color).toBe(palette.borderSubtle);
  expect((await appearance(page)).grid.horzLines.visible).toBe(true);
  expectNoErrors(collected);
});

test('a chart whose scale text was changed draws the scale numbers in it', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { canvas: { scaleText: { color: '#ffffff', fontSize: 14 } } } },
  });
  await openChart(page);

  await expect.poll(async () => (await appearance(page)).layout.fontSize).toBe(14);
  expect((await appearance(page)).layout.textColor).toBe('#ffffff');
  expectNoErrors(collected);
});

test('a chart whose background is a gradient blends its two colours', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: {
        canvas: { background: { mode: 'gradient', color: SEEDED_TOP_COLOR, bottomColor: SEEDED_BOTTOM_COLOR } },
      },
    },
  });
  await openChart(page);

  await expect.poll(async () => (await appearance(page)).layout.background.type).toBe(ColorType.VerticalGradient);
  expect((await appearance(page)).layout.background).toEqual({
    type: ColorType.VerticalGradient,
    topColor: SEEDED_TOP_COLOR,
    bottomColor: SEEDED_BOTTOM_COLOR,
  });
  expectNoErrors(collected);
});

test('a chart whose price margins were changed fits the bars into them', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { canvas: { topMargin: 5, bottomMargin: 10 } } },
  });
  await openChart(page);

  await expect.poll(async () => (await appearance(page)).scaleMargins).toEqual({ top: 0.05, bottom: 0.1 });
  expectNoErrors(collected);
});

test('a chart whose right margin was widened keeps that many empty bars after the last one', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { canvas: { rightMargin: SEEDED_RIGHT_MARGIN } } },
  });
  await openChart(page);

  await expect.poll(async () => (await appearance(page)).rightMarginBars).toBe(SEEDED_RIGHT_MARGIN);
  await expect.poll(async () => Math.abs((await rightGap(page)) - SEEDED_RIGHT_MARGIN)).toBeLessThan(0.5);
  expectNoErrors(collected);
});

test('a chart whose crosshair was recoloured draws the pointer lines in that colour and dash', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { canvas: { crosshair: { color: '#ff0000', style: 'dashed' } } } },
  });
  await openChart(page);

  const crosshair = { color: '#ff0000', style: 'dashed', width: 1 };
  await expect.poll(async () => (await appearance(page)).crosshair).toEqual(crosshair);
  expectNoErrors(collected);
});

test('a chart whose crosshair was made thicker draws the pointer lines that many pixels wide', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: {
        canvas: { crosshair: { color: SEEDED_CROSSHAIR_COLOR, style: 'solid', width: SEEDED_CROSSHAIR_WIDTH } },
      },
    },
  });
  await openChart(page);
  await expect.poll(async () => (await appearance(page)).crosshair.width).toBe(SEEDED_CROSSHAIR_WIDTH);

  const host = (await page.locator('.chart-host').boundingBox())!;
  await selectCrosshairTool(page);
  const pointer = { x: host.x + POINTER.x, y: host.y + POINTER.y };
  await page.mouse.move(pointer.x, pointer.y);
  await expect.poll(async () => page.evaluate(() => window.__chartTest?.tool('crosshair')?.linesVisible())).toBe(true);

  // The tool draws whole device pixels, so a CSS px of thickness is one device pixel of the screenshot.
  const pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const drawnWidth = Math.max(1, Math.round(SEEDED_CROSSHAIR_WIDTH * pixelRatio));
  await expect.poll(async () => drawnCrosshairWidth(page, pointer)).toBe(drawnWidth);
  expectNoErrors(collected);
});
