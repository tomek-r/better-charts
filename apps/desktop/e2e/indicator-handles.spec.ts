import { expect, test, type Page } from '@playwright/test';
import { handleBarIndices } from '../src/features/chart/engine/indicators/indicatorHandleIndices';
import { handleRing } from '../src/features/chart/engine/indicators/indicatorHandles';
import { palette } from '../src/shared/theme/palette';
import { waitTwoAnimationFrames } from './helpers/animationFrames';
import { drawnIndicators } from './helpers/indicatorFrames';
import { selectedIndicatorId } from './helpers/indicatorObjectTree';
import { plotLinePoint, type PagePoint } from './helpers/indicatorPlotPage';
import { openChart } from './helpers/openChart';
import { decodePng, parseHexColor, pixelAt, type DecodedPng } from './helpers/pngPixels';
import { EURUSD_CHART } from './helpers/savedIndicators';
import { expectNoErrors, gotoWithStub } from './helpers/tauriStub';

/**
 * Where a selected indicator's plots put their handles: one every 10th bar of the pane plus the bar the
 * plot ends on, the ring each one is drawn as at any pixel ratio, and the pixels that ring paints.
 */

/** One colour as a screenshot decodes it: red, green and blue, 0-255. */
type RgbColor = readonly [number, number, number];

/** Where a pixel of a screenshot sits, in the screenshot's own bitmap pixels. */
interface BitmapPoint {
  readonly x: number;
  readonly y: number;
}

/** The moving average the pixel case seeds, and the colour its line is drawn in. */
const SMA_INSTANCE_ID = 'sma-1';
const PLOT_COLOR = palette.sell;
/** A moving average of one close, so every bar of the stub's window carries a plot point. */
const SAVED_SMA_OF_ONE = {
  instanceId: SMA_INSTANCE_ID,
  definitionId: 'sma',
  settings: { length: 1, 'plot.color': PLOT_COLOR },
};

/** The chart background the pixel case seeds, so the pane behind a handle is an opaque known colour. */
const SEEDED_BACKGROUND = palette.surface;

/**
 * Half the side of the screenshot a handle is read from: the ring's 9 px, plus the couple of pixels the
 * pointer reading of the handle's own point can be off by.
 */
const HANDLE_CLIP_HALF_PX = 14;
/** How near the selection blue a ring pixel has to be, per channel, to count as the ring's own. */
const RING_CHANNEL_TOLERANCE = 30;
/** How many ring pixels a 9 px ring of the selection blue leaves at the very least. */
const MIN_RING_PIXELS = 4;
/** How near the pane background the ring's centre has to be, per channel. */
const BACKGROUND_TOLERANCE = 6;
/** How far the ring's centre has to stay from the plot colour, per channel. */
const PLOT_TOLERANCE = 40;
/** The two colours the screenshot is read against, as its pixels decode them. */
const SELECTION_RING_RGB = parseHexColor(palette.selection);
const PLOT_RGB = parseHexColor(PLOT_COLOR);

/** The widest single-channel difference between two colours. */
function channelGap([red, green, blue]: RgbColor, [otherRed, otherGreen, otherBlue]: RgbColor): number {
  return Math.max(Math.abs(red - otherRed), Math.abs(green - otherGreen), Math.abs(blue - otherBlue));
}

/** Every pixel of `image` whose channels all sit within `tolerance` of `color`. */
function pixelsNear(image: DecodedPng, color: RgbColor, tolerance: number): BitmapPoint[] {
  return positionsIn(image).filter(({ x, y }) => channelGap(pixelAt(image, x, y), color) <= tolerance);
}

/** Every pixel position of `image`, row by row. */
function positionsIn(image: DecodedPng): BitmapPoint[] {
  const positions: BitmapPoint[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      positions.push({ x, y });
    }
  }
  return positions;
}

/** The middle of the given pixels, which is where the inside of the ring they trace is sampled. */
function centreOf(pixels: readonly BitmapPoint[]): BitmapPoint {
  const sum = pixels.reduce((total, pixel) => ({ x: total.x + pixel.x, y: total.y + pixel.y }), { x: 0, y: 0 });
  return { x: Math.round(sum.x / pixels.length), y: Math.round(sum.y / pixels.length) };
}

/** The chart painted `HANDLE_CLIP_HALF_PX` around `point`, once the frame it draws there has settled. */
async function handleImage(page: Page, point: PagePoint): Promise<DecodedPng> {
  await waitTwoAnimationFrames(page);
  const clip = {
    x: point.x - HANDLE_CLIP_HALF_PX,
    y: point.y - HANDLE_CLIP_HALF_PX,
    width: 2 * HANDLE_CLIP_HALF_PX,
    height: 2 * HANDLE_CLIP_HALF_PX,
  };
  return decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
}

/** The page point of the last point the indicator's first plot draws: the bar a handle always sits on. */
async function lastPlotPoint(page: Page, instanceId: string): Promise<PagePoint> {
  const [indicator] = await drawnIndicators(page);
  const pointCount = indicator?.plots[0]?.points.length ?? 0;
  return plotLinePoint(page, instanceId, pointCount - 1);
}

/** The colour the chart draws the indicator's first plot line in. */
async function firstPlotColor(page: Page): Promise<string | undefined> {
  const [indicator] = await drawnIndicators(page);
  return indicator?.plots[0]?.color;
}

/** The chart's background as its layout options give it: the colour the inside of a handle has to be. */
async function paneBackground(page: Page): Promise<RgbColor> {
  const background = await page.evaluate(() => window.__chartTest!.appearance().layout.background);
  const color = background.color ?? background.topColor;
  if (color === undefined) {
    throw new Error('The chart reports no background colour');
  }
  return parseHexColor(color);
}

test('a handle sits on every tenth bar of the pane, counted from its first visible one', () => {
  expect(handleBarIndices({ from: 0, to: 25 }, null)).toEqual([0, 10, 20]);
  expect(handleBarIndices({ from: 3.4, to: 27 }, null)).toEqual([4, 14, 24]);
});

test('the empty space left of the data carries no handle', () => {
  expect(handleBarIndices({ from: -2, to: 9 }, null)).toEqual([0]);
});

test('the bar the plot ends on carries one, added once when it falls on an interval bar', () => {
  expect(handleBarIndices({ from: 0, to: 25 }, 25)).toEqual([0, 10, 20, 25]);
  expect(handleBarIndices({ from: 0, to: 25 }, 20)).toEqual([0, 10, 20]);
});

test('a last bar outside the pane adds no handle', () => {
  expect(handleBarIndices({ from: 0, to: 25 }, 40)).toEqual([0, 10, 20]);
});

test('a pane of empty space right of the newest bar carries no handle', () => {
  expect(handleBarIndices({ from: 12, to: 9 }, 9)).toEqual([]);
});

test('a handle ring stays 9 CSS pixels across, stroked 1.5 wide, on any pixel ratio', () => {
  expect(handleRing(1)).toEqual({ fillRadius: 4.5, strokeRadius: 3.75, strokeWidth: 1.5 });
  expect(handleRing(2)).toEqual({ fillRadius: 9, strokeRadius: 7.5, strokeWidth: 3 });
});

test('a selected plot rings its handles in the selection blue, filled with the pane background', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: {
        canvas: { background: { mode: 'solid', color: SEEDED_BACKGROUND } },
        indicators: [SAVED_SMA_OF_ONE],
      },
    },
  });
  await openChart(page);
  expect(await firstPlotColor(page)).toBe(PLOT_COLOR);
  const handlePoint = await lastPlotPoint(page, SMA_INSTANCE_ID);

  await page.mouse.click(handlePoint.x, handlePoint.y);
  await expect.poll(() => selectedIndicatorId(page)).toBe(SMA_INSTANCE_ID);
  await expect.poll(async () => (await drawnIndicators(page))[0]?.selectionHandles).toBe(true);
  // Off the pane, so no crosshair line is painted across the handle the screenshot reads.
  await page.mouse.move(0, 0);

  const image = await handleImage(page, handlePoint);
  const ringPixels = pixelsNear(image, SELECTION_RING_RGB, RING_CHANNEL_TOLERANCE);
  expect(ringPixels.length).toBeGreaterThanOrEqual(MIN_RING_PIXELS);

  const ringCentre = centreOf(ringPixels);
  const centreColor = pixelAt(image, ringCentre.x, ringCentre.y);
  expect(channelGap(centreColor, await paneBackground(page))).toBeLessThanOrEqual(BACKGROUND_TOLERANCE);
  // The plot's line is drawn through this very pixel, so the inside of the ring has to hide it.
  expect(channelGap(centreColor, PLOT_RGB)).toBeGreaterThan(PLOT_TOLERANCE);
  expectNoErrors(collected);
});
