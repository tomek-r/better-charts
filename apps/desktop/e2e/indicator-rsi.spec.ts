import { expect, test, type Page } from '@playwright/test';
import type {
  IndicatorFill,
  IndicatorFrame,
  IndicatorLevel,
  IndicatorPlot,
} from '../src/features/chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import { LENGTH_INPUT } from '../src/features/indicators/indicatorInputs';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import {
  BACKGROUND_STYLE,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BAND_COLOR,
  DEFAULT_COLOR,
  DEFAULT_MIDDLE_BAND_COLOR,
  LOWER_BAND,
  MIDDLE_BAND,
  PLOT_STYLE,
  RsiIndicator,
  UPPER_BAND,
  UPPER_BAND_STYLE,
} from '../src/features/indicators/rsi/rsiIndicator';
import { rsiPlugin } from '../src/features/indicators/rsi/rsiPlugin';
import { waitTwoAnimationFrames } from './helpers/animationFrames';
import { CHART_HOST_SELECTOR } from './helpers/chartHost';
import {
  MILLISECONDS_PER_SECOND,
  barAt,
  barsFromCloses,
  expectNewerBarClosesTheFormingOne,
} from './helpers/indicatorBars';
import { DEMO_ID, frameOf, openChartTimes, showFrame } from './helpers/indicatorFrames';
import { failOnPageNoise } from './helpers/pageNoise';
import { decodePng, parseHexColor, pixelAt, type DecodedPng } from './helpers/pngPixels';

type SettingOverrides = Readonly<Record<string, number | string | boolean>>;

const HAND_CHECK_LENGTH = 2;
/** Closes whose two changes both rise, then both fall, so the hand check is 100, 50 and 25. */
const HAND_CHECK_CLOSES = [1, 2, 3, 2, 1];
const LONG_LENGTH = 14;
/** Wilder's example series, a fixed list of rises, falls and one flat bar. */
const LONG_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46, 46.03,
  46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 46.68, 46.32, 46.8, 47.1, 46.9, 47.35,
];
const RUN_LENGTH = 2;
const RISING_CLOSES = [1, 2, 3, 4, 5];
const FALLING_CLOSES = [5, 4, 3, 2, 1];
const LIVE_LENGTH = 3;
const LIVE_CLOSES = [1, 2, 3, 4, 5, 6];
const UPPER_LEVEL_INDEX = 0;
const LOWER_LEVEL_INDEX = 2;
/** The width of a level or plot line, which the fill tests only have to look past. */
const BAND_LINE_WIDTH = 1;
/** A line wide enough to keep solid pixels inside a fill, so a screenshot can tell it from the fill. */
const PLOT_OVER_FILL_WIDTH = 4;
/** The line the bands are measured against, drawn in the RSI's own plot colour. */
const BAND_PLOT: IndicatorPlot = { title: 'band', style: 'line', color: DEFAULT_COLOR, lineWidth: BAND_LINE_WIDTH };
/** The same line, wide enough for the pixel test that reads it inside the fill. */
const WIDE_BAND_PLOT: IndicatorPlot = { ...BAND_PLOT, lineWidth: PLOT_OVER_FILL_WIDTH };
/** How far the line rises per bar, so the pane's scale spans both level prices. */
const BAND_VALUE_STEP = 10;
/** Fill colours no band or line of the chart is drawn in, so a screenshot cannot mistake one for another. */
const LEVEL_BAND_FILL_COLOR = '#123456';
const PLOT_EDGE_FILL_COLOR = '#654321';
/** How far a screenshot channel may stray from a fill colour and still be that colour. */
const FILL_COLOR_TOLERANCE = 8;
/** How close to the pane's left edge a level band has to reach, in CSS pixels. */
const PANE_LEFT_EDGE_TOLERANCE_CSS_PX = 4;
/** How far left of the first bar's column a per-bar band may blend, in CSS pixels. */
const BAR_EDGE_TOLERANCE_CSS_PX = 2;
/** How much of the pane's width a row paints a fill across to count as one of its band's rows. */
const BAND_ROW_WIDTH_SHARE = 0.5;
/** Rows left out at each end of a band, where the fill's edge and the level line over it blend. */
const BAND_EDGE_ROWS = 2;
/** The three bands the fill tests draw over the chart's bars. */
const BAND_LEVELS: readonly IndicatorLevel[] = [
  { title: 'Upper Band', price: UPPER_BAND, color: DEFAULT_BAND_COLOR, lineWidth: BAND_LINE_WIDTH },
  { title: 'Middle Band', price: MIDDLE_BAND, color: DEFAULT_MIDDLE_BAND_COLOR, lineWidth: BAND_LINE_WIDTH },
  { title: 'Lower Band', price: LOWER_BAND, color: DEFAULT_BAND_COLOR, lineWidth: BAND_LINE_WIDTH },
];
/** The band between the two outer levels, which no bar can break. */
const LEVEL_BAND_FILL: IndicatorFill = {
  from: { kind: 'level', index: UPPER_LEVEL_INDEX },
  to: { kind: 'level', index: LOWER_LEVEL_INDEX },
  color: LEVEL_BAND_FILL_COLOR,
};
/** The band between the lower level and the line, which starts at the line's first point. */
const PLOT_EDGE_FILL: IndicatorFill = {
  from: { kind: 'level', index: LOWER_LEVEL_INDEX },
  to: { kind: 'plot', index: 0 },
  color: PLOT_EDGE_FILL_COLOR,
};
/** Both fill colours as a screenshot decodes them. */
const LEVEL_BAND_FILL_RGB = parseHexColor(LEVEL_BAND_FILL_COLOR);
const PLOT_EDGE_FILL_RGB = parseHexColor(PLOT_EDGE_FILL_COLOR);
/** The band plot's colour as a screenshot decodes it. */
const BAND_PLOT_RGB = parseHexColor(DEFAULT_COLOR);

function rsiSettings(length: number, overrides: SettingOverrides = {}): SettingValues {
  return resolveSettingValues(rsiPlugin, { [LENGTH_INPUT]: length, ...overrides });
}

/** One change per bar after the first, written from the definition rather than from the indicator. */
function changesBetweenCloses(closes: readonly number[]): readonly number[] {
  const changes: number[] = [];
  let previousClose: number | null = null;
  for (const close of closes) {
    if (previousClose !== null) {
      changes.push(close - previousClose);
    }
    previousClose = close;
  }
  return changes;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Pine's `ta.rma` as an oracle: nothing until `length` values exist, then their mean, then the mean step. */
function oracleRma(values: readonly number[], length: number): readonly (number | null)[] {
  const averages: (number | null)[] = [];
  values.forEach((value, index) => {
    const previousAverage = averages[index - 1] ?? null;
    if (index < length - 1) {
      averages.push(null);
      return;
    }
    if (previousAverage === null) {
      averages.push(meanOf(values.slice(0, length)));
      return;
    }
    averages.push((previousAverage * (length - 1) + value) / length);
  });
  return averages;
}

/** Pine's `ta.rsi` of the two averages, where no fall reads 100 and no rise reads 0. */
function oracleValue(gainAverage: number | null, lossAverage: number | null): number | null {
  if (gainAverage === null || lossAverage === null) {
    return null;
  }
  if (lossAverage === 0) {
    return 100;
  }
  if (gainAverage === 0) {
    return 0;
  }
  return 100 - 100 / (1 + gainAverage / lossAverage);
}

function oracleRsi(closes: readonly number[], length: number): readonly (number | null)[] {
  const changes = changesBetweenCloses(closes);
  const gains = oracleRma(
    changes.map((change) => Math.max(change, 0)),
    length,
  );
  const losses = oracleRma(
    changes.map((change) => Math.max(-change, 0)),
    length,
  );
  return [null, ...gains.map((gain, index) => oracleValue(gain, losses[index] ?? null))];
}

/** The newest RSI the oracle gives for the closes. */
function oracleNewest(closes: readonly number[], length: number): number | null {
  const values = oracleRsi(closes, length);
  return values[values.length - 1] ?? null;
}

function expectValuesCloseTo(actual: readonly (number | null)[], expected: readonly (number | null)[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((expectedValue, index) => {
    if (expectedValue === null) {
      expect(actual[index] ?? null).toBeNull();
      return;
    }
    expect(actual[index] ?? null).toBeCloseTo(expectedValue);
  });
}

/** A rising `plot` and the three bands over the chart's bars, with `fill` painted under them. */
function bandFrame(times: readonly number[], fill: IndicatorFill, plot: IndicatorPlot = BAND_PLOT): IndicatorFrame {
  return {
    ...frameOf([plot], times, (_plotIndex, barIndex) => barIndex * BAND_VALUE_STEP),
    levels: BAND_LEVELS,
    fills: [fill],
  };
}

/** The pane's x of a bar, in CSS pixels from the pane's left edge. */
async function barX(page: Page, timeSeconds: number): Promise<number> {
  return page.evaluate((timeMs) => window.__chartTest!.timeToX(timeMs), timeSeconds * MILLISECONDS_PER_SECOND);
}

/** The pane's width in CSS pixels: the chart host less the price axis it draws on the right. */
async function paneWidth(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const hostWidth = document.querySelector(selector)!.getBoundingClientRect().width;
    return hostWidth - window.__chartTest!.priceScale().axisWidth;
  }, CHART_HOST_SELECTOR);
}

/** How many screenshot pixels one CSS pixel of the page covers. */
async function pagePixelRatio(page: Page): Promise<number> {
  return page.evaluate(() => window.devicePixelRatio);
}

/** Whether a screenshot pixel is `color`, within the tolerance a blend may stray. */
function isColor(
  [red, green, blue]: readonly [number, number, number],
  [colorRed, colorGreen, colorBlue]: readonly [number, number, number],
): boolean {
  return (
    Math.abs(red - colorRed) <= FILL_COLOR_TOLERANCE &&
    Math.abs(green - colorGreen) <= FILL_COLOR_TOLERANCE &&
    Math.abs(blue - colorBlue) <= FILL_COLOR_TOLERANCE
  );
}

/** Whether one column of a screenshot paints `color` anywhere down the pane. */
function columnPaints(image: DecodedPng, x: number, color: readonly [number, number, number]): boolean {
  for (let y = 0; y < image.height; y += 1) {
    if (isColor(pixelAt(image, x, y), color)) {
      return true;
    }
  }
  return false;
}

/** The columns of a screenshot that paint `color` somewhere down the pane. */
function columnsPainting(image: DecodedPng, color: readonly [number, number, number]): number[] {
  const columns: number[] = [];
  for (let x = 0; x < image.width; x += 1) {
    if (columnPaints(image, x, color)) {
      columns.push(x);
    }
  }
  return columns;
}

/** The chart host's columns that paint `color` right now. */
async function paintedColumns(page: Page, color: readonly [number, number, number]): Promise<number[]> {
  await waitTwoAnimationFrames(page);
  return columnsPainting(decodePng(await page.locator(CHART_HOST_SELECTOR).screenshot()), color);
}

/** Waits for the pane to paint `color` somewhere, then reports the columns that paint it. */
async function waitedPaintedColumns(page: Page, color: readonly [number, number, number]): Promise<number[]> {
  await expect.poll(async () => (await paintedColumns(page, color)).length).toBeGreaterThan(0);
  return paintedColumns(page, color);
}

/** One pixel of a screenshot, by its column and row. */
interface PixelSite {
  readonly x: number;
  readonly y: number;
}

/** The part of a screenshot a test reads: rows `top` to `bottom`, left of column `right`. */
interface PixelRegion {
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

/** How many pixels of row `y`, left of `right`, paint `color`. */
function paintedPixelsInRow(
  image: DecodedPng,
  y: number,
  color: readonly [number, number, number],
  right: number,
): number {
  let painted = 0;
  for (let x = 0; x < right; x += 1) {
    if (isColor(pixelAt(image, x, y), color)) {
      painted += 1;
    }
  }
  return painted;
}

/** The screenshot's rows that a band of `color` covers: those painting it across most of the pane. */
function bandRowsOf(image: DecodedPng, color: readonly [number, number, number], right: number): number[] {
  const rows: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    if (paintedPixelsInRow(image, y, color, right) >= right * BAND_ROW_WIDTH_SHARE) {
      rows.push(y);
    }
  }
  return rows;
}

/** Every pixel of `region` that paints `color`. */
function pixelsPainting(image: DecodedPng, color: readonly [number, number, number], region: PixelRegion): PixelSite[] {
  const sites: PixelSite[] = [];
  for (let y = region.top; y <= region.bottom; y += 1) {
    for (let x = 0; x < region.right; x += 1) {
      if (isColor(pixelAt(image, x, y), color)) {
        sites.push({ x, y });
      }
    }
  }
  return sites;
}

/** Whether the screenshot pixel at `site` paints `color`. */
function pixelPaints(image: DecodedPng, site: PixelSite, color: readonly [number, number, number]): boolean {
  return isColor(pixelAt(image, site.x, site.y), color);
}

test('the closes 1, 2, 3, 2, 1 read 100, 50 and 25 with a length of two', () => {
  const frame = new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), rsiSettings(HAND_CHECK_LENGTH));
  const values = frame.bars.map((bar) => bar.values[0] ?? null);

  expect(values.slice(0, HAND_CHECK_LENGTH)).toEqual([null, null]);
  expect(values[2]).toBeCloseTo(100);
  expect(values[3]).toBeCloseTo(50);
  expect(values[4]).toBeCloseTo(25);
});

test('the RSI waits for the first length changes', () => {
  const frame = new RsiIndicator().load(barsFromCloses(LONG_CLOSES), rsiSettings(LONG_LENGTH));
  const beforeSeed = frame.bars.slice(0, LONG_LENGTH).map((bar) => bar.values[0] ?? null);

  expect(beforeSeed.every((value) => value === null)).toBe(true);
  expect(frame.bars[LONG_LENGTH - 1]?.values[0] ?? null).toBeNull();
  expect(frame.bars[LONG_LENGTH]?.values[0] ?? null).not.toBeNull();
});

test('every bar of a longer series matches an oracle written from the definition', () => {
  const frame = new RsiIndicator().load(barsFromCloses(LONG_CLOSES), rsiSettings(LONG_LENGTH));
  const values = frame.bars.map((bar) => bar.values[0] ?? null);

  expectValuesCloseTo(values, oracleRsi(LONG_CLOSES, LONG_LENGTH));
});

test('rises without a fall read 100 and falls without a rise read 0', () => {
  const rising = new RsiIndicator().load(barsFromCloses(RISING_CLOSES), rsiSettings(RUN_LENGTH));
  const falling = new RsiIndicator().load(barsFromCloses(FALLING_CLOSES), rsiSettings(RUN_LENGTH));

  expect(rising.bars.map((bar) => bar.values[0] ?? null)).toEqual([null, null, 100, 100, 100]);
  expect(falling.bars.map((bar) => bar.values[0] ?? null)).toEqual([null, null, 0, 0, 0]);
});

test('the frame draws one RSI line, the three bands and the fill between the outer two', () => {
  const frame = new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), rsiSettings(HAND_CHECK_LENGTH));

  expect(frame.plots.map((plot) => [plot.title, plot.color])).toEqual([['RSI', DEFAULT_COLOR]]);
  expect(frame.levels?.map((level) => [level.title, level.price, level.color, level.lineStyle])).toEqual([
    ['Upper Band', UPPER_BAND, DEFAULT_BAND_COLOR, 'dashed'],
    ['Middle Band', MIDDLE_BAND, DEFAULT_MIDDLE_BAND_COLOR, 'dotted'],
    ['Lower Band', LOWER_BAND, DEFAULT_BAND_COLOR, 'dashed'],
  ]);
  const [bandFill] = frame.fills ?? [];
  expect(bandFill?.from).toEqual({ kind: 'level', index: UPPER_LEVEL_INDEX });
  expect(bandFill?.to).toEqual({ kind: 'level', index: LOWER_LEVEL_INDEX });
  expect(bandFill?.color).toBe(DEFAULT_BACKGROUND_COLOR);
  expect(frame.precision).toBe(2);
});

test('switching the background off draws no fill', () => {
  const settings = rsiSettings(HAND_CHECK_LENGTH, { [settingStyleKey(BACKGROUND_STYLE, 'visible')]: false });

  expect(new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), settings).fills).toEqual([]);
});

test('the style settings drive the plot colour and a band dash', () => {
  const settings = rsiSettings(HAND_CHECK_LENGTH, {
    [settingStyleKey(PLOT_STYLE, 'color')]: '#FF0000',
    [settingStyleKey(UPPER_BAND_STYLE, 'style')]: 'solid',
  });
  const frame = new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), settings);

  expect(frame.plots[0]?.color).toBe('#FF0000');
  expect(frame.levels?.[UPPER_LEVEL_INDEX]).toMatchObject({ lineStyle: 'solid', visible: true });
});

test('a tick redraws only the forming bar and leaves the state alone', () => {
  const settings = rsiSettings(LIVE_LENGTH);
  const indicator = new RsiIndicator();
  indicator.load(barsFromCloses(LIVE_CLOSES), settings);
  const tickedBar = barAt(LIVE_CLOSES.length - 1, 2);

  const firstFrame = indicator.update(tickedBar, settings);
  const repeatedFrame = indicator.update(tickedBar, settings);

  expect(firstFrame.bars.map((bar) => bar.confirmed)).toEqual([false]);
  expect(firstFrame.bars[0]?.timeMs).toBe(tickedBar.time * MILLISECONDS_PER_SECOND);
  expectValuesCloseTo(
    firstFrame.bars.map((bar) => bar.values[0] ?? null),
    [oracleNewest([...LIVE_CLOSES.slice(0, -1), 2], LIVE_LENGTH)],
  );
  expect(repeatedFrame.bars).toEqual(firstFrame.bars);
});

test('a newer bar returns the closed bar and then the forming one', () => {
  expectNewerBarClosesTheFormingOne(
    new RsiIndicator(),
    [...barsFromCloses(LIVE_CLOSES.slice(0, 3)), barAt(3, 4)],
    rsiSettings(LIVE_LENGTH),
  );
});

test('live updates end where a fresh load of the same bars ends', () => {
  const settings = rsiSettings(LIVE_LENGTH);
  const live = new RsiIndicator();
  live.load(barsFromCloses(LIVE_CLOSES.slice(0, 4)), settings);
  live.update(barAt(3, 8), settings);
  const closingFrame = live.update(barAt(4, 6), settings);
  const tickingFrame = live.update(barAt(4, 10), settings);

  const freshBars = new RsiIndicator().load(
    [...barsFromCloses(LIVE_CLOSES.slice(0, 3)), barAt(3, 8), barAt(4, 10)],
    settings,
  ).bars;
  const freshClosedValues = freshBars[freshBars.length - 2]?.values;
  const freshFormingValues = freshBars[freshBars.length - 1]?.values;

  expect(tickingFrame.bars.map((bar) => bar.values)).toEqual([freshFormingValues]);
  expect(closingFrame.bars[0]).toMatchObject({ confirmed: true, values: freshClosedValues });
});

test('the registry names the RSI and draws it in a pane of its own', () => {
  expect(findChartIndicatorPlugin('rsi')?.title).toBe(rsiPlugin.title);
  expect(findChartIndicatorPlugin('rsi')?.pane).toBe('own');
  expect(indicatorLegendTitle('rsi', resolveSettingValues(rsiPlugin, {}))).toBe('RSI 14 close');
});

test.describe('the band a fill paints', () => {
  failOnPageNoise();

  test('a fill between two levels paints the pane left of the first bar', async ({ page }) => {
    const times = await openChartTimes(page);
    await showFrame(page, DEMO_ID, bandFrame(times, LEVEL_BAND_FILL), 'own');
    const pixelRatio = await pagePixelRatio(page);

    const fillColumns = await waitedPaintedColumns(page, LEVEL_BAND_FILL_RGB);
    const paneEdgeLimit = Math.ceil(PANE_LEFT_EDGE_TOLERANCE_CSS_PX * pixelRatio);
    const paneColumns = Math.floor((await paneWidth(page)) * pixelRatio);
    const firstBarColumn = Math.floor((await barX(page, times[0])) * pixelRatio);

    // The chart opens with its first bar far right, so the fill left of it can only span the two levels.
    expect(firstBarColumn).toBeGreaterThan(paneColumns / 2);
    expect(Math.min(...fillColumns)).toBeLessThanOrEqual(paneEdgeLimit);
  });

  test('a fill with a plot edge starts at the line and no further left', async ({ page }) => {
    const times = await openChartTimes(page);
    await showFrame(page, DEMO_ID, bandFrame(times, PLOT_EDGE_FILL), 'own');
    const pixelRatio = await pagePixelRatio(page);

    const fillColumns = await waitedPaintedColumns(page, PLOT_EDGE_FILL_RGB);
    const firstBarColumn = Math.floor((await barX(page, times[0])) * pixelRatio);
    const blendTolerance = Math.ceil(BAR_EDGE_TOLERANCE_CSS_PX * pixelRatio);

    expect(Math.min(...fillColumns)).toBeGreaterThanOrEqual(firstBarColumn - blendTolerance);
  });

  test('grid lines stay under an opaque level fill and the plot line paints over it', async ({ page }) => {
    const times = await openChartTimes(page);
    const filledFrame = bandFrame(times, LEVEL_BAND_FILL, WIDE_BAND_PLOT);
    const pixelRatio = await pagePixelRatio(page);
    const paneColumns = Math.floor((await paneWidth(page)) * pixelRatio);
    const grid = await page.evaluate(() => window.__chartTest!.appearance().grid);
    expect([grid.vertLines.visible, grid.horzLines.visible]).toEqual([true, true]);
    const gridRgb = parseHexColor(grid.vertLines.color);

    // The same frame without its fill, so the grid lines the band covers can be found where they show.
    await showFrame(page, DEMO_ID, { ...filledFrame, fills: [] }, 'own');
    await waitTwoAnimationFrames(page);
    const withoutFill = decodePng(await page.locator(CHART_HOST_SELECTOR).screenshot());

    await showFrame(page, DEMO_ID, filledFrame, 'own');
    await waitedPaintedColumns(page, LEVEL_BAND_FILL_RGB);
    const withFill = decodePng(await page.locator(CHART_HOST_SELECTOR).screenshot());

    const band = bandRowsOf(withFill, LEVEL_BAND_FILL_RGB, paneColumns);
    expect(band.length).toBeGreaterThan(BAND_EDGE_ROWS * 2);
    // The band's own edges blend with the level lines drawn over them, so only its inside is read.
    const bandInside: PixelRegion = {
      top: band[0] + BAND_EDGE_ROWS,
      bottom: band[band.length - 1] - BAND_EDGE_ROWS,
      right: paneColumns,
    };

    const gridSites = pixelsPainting(withoutFill, gridRgb, bandInside);
    expect(gridSites.length).toBeGreaterThan(0);
    const coveredGridSites = gridSites.filter((site) => pixelPaints(withFill, site, LEVEL_BAND_FILL_RGB));
    expect(coveredGridSites.length).toBeGreaterThan(0);
    expect(pixelsPainting(withFill, gridRgb, bandInside)).toEqual([]);
    expect(pixelsPainting(withFill, BAND_PLOT_RGB, bandInside).length).toBeGreaterThan(0);
  });
});
