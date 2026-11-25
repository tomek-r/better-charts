import { expect, test } from '@playwright/test';
import { DEFAULT_CANDLE_APPEARANCE } from '../src/features/chart/engine/bars/candleAppearance';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { sameBarStyleAppearance } from '../src/features/chart/engine/barStyle/barStyleAppearance';
import { barStylePoints } from '../src/features/chart/engine/barStyle/barStylePoints';
import {
  FOOTPRINT_DEFAULT_BUY_SHADES,
  FOOTPRINT_DEFAULT_SELL_SHADES,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintDefaults';
import {
  footprintBarColumns,
  footprintCellBox,
  footprintCellShowsText,
  footprintProfileBox,
  type FootprintBarColumns,
  type FootprintTextWidth,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintGeometry';
import {
  footprintImbalanceBox,
  IMBALANCE_MARK_WIDTH,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintImbalance';
import {
  FOOTPRINT_TYPES,
  footprintLayoutOf,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintModes';
import {
  footprintBand,
  footprintCellBand,
  footprintShadeColor,
  type FootprintVolumeRange,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintShades';
import {
  footprintSummaryLayout,
  footprintSummaryLines,
  MIN_SUMMARY_BAR_WIDTH,
  type FootprintSummarySettings,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintSummary';
import { footprintVolumeText } from '../src/features/chart/engine/barStyle/volumeFootprint/footprintVolumeText';
import {
  barStyleAppearanceOf,
  volumeFootprintAppearance,
} from '../src/features/chart/chartSettings/barStyleAppearanceSetting';
import type {
  BarFootprint,
  ChartFootprintRow,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintData';
import { chartFootprintRequest } from '../src/features/footprint/chartFootprintRequest';
import { readBarFootprint } from '../src/features/footprint/footprintRead';
import type { BarFootprint as WireBarFootprint } from '../src/shared/bridge/types';
import { DEFAULT_FOOTPRINT_SETTINGS } from './helpers/footprintFixtures';

/**
 * What the volume footprint style means to the engine: the volume a cell writes, the shade a cell is graded
 * in, the device geometry of the two columns and the thin candle, the summary under them, the imbalance
 * marks and the rows the host is asked for.
 */

/** One side's volumes from nothing to a hundred, which every band boundary is read against. */
const FULL_RANGE: FootprintVolumeRange = { min: 0, max: 100 };
/** One device pixel per media pixel, so the geometry reads as the media values do. */
const NO_SCALING = 1;
/** One device pixel per media pixel on both axes, as a screen at the default ratio reports them. */
const NO_SCALING_RATIOS = { horizontalPixelRatio: NO_SCALING, verticalPixelRatio: NO_SCALING };
/** The column width the cell boxes are measured inside, which is what one side of a twenty-pixel bar holds. */
const SIDE_COLUMN = { left: 8, width: 8 };
/** How wide the spec's text is in css px: five pixels a character, which a stub measures without any canvas. */
const MEASURED_TEXT: FootprintTextWidth = (text) => text.length * 5;
/** A bar's time, in the UTC seconds the chart times its bars with. */
const BAR_TIME_SECONDS = 1_700_000_000;
/** A hundred-pixel bar's columns: forty pixels of each side around a twenty-pixel candle, on x = 10. */
const SUMMARY_COLUMNS = footprintBarColumns(10, 100, NO_SCALING, 'two-columns');
/** The media y the lowest row's cells end at, which the summary is written under. */
const LOWEST_ROW_BOTTOM = 200;

/**
 * One footprint row: its number, the prices it spans, the volume each side traded and the trades behind it, one
 * trade per ten lots.
 */
function footprintRow(rowNumber: number, downPrice: number, upPrice: number): ChartFootprintRow {
  return {
    row: rowNumber,
    downPrice,
    upPrice,
    buyVolume: 500,
    sellVolume: 300,
    buyTrades: 50,
    sellTrades: 30,
    buyImbalance: false,
    sellImbalance: false,
  };
}

/** The bar the footprint the point test carries, and the bar prices it reports. */
const FOOTPRINT_BAR: RenderBar = { time: BAR_TIME_SECONDS, open: 1.15, high: 1.2, low: 1.1, close: 1.18, volume: 800 };
const FOOTPRINT: BarFootprint = {
  openMs: BAR_TIME_SECONDS * 1000,
  rows: [footprintRow(0, 1.1, 1.15), footprintRow(1, 1.15, 1.2)],
  buyVolume: 1000,
  sellVolume: 600,
  // The two rows' trades: one trade per ten lots, as each fixture row counts them.
  buyTrades: 100,
  sellTrades: 60,
  poc: 1,
  vah: 1,
  val: 0,
  volume: 'real',
};

test('a cell writes at most three decimals below a thousand and three decimals with a K or M unit above it', () => {
  expect(footprintVolumeText(219_507)).toBe('219.507 K');
  expect(footprintVolumeText(1_295_000)).toBe('1.295 M');
  expect(footprintVolumeText(47)).toBe('47');
  expect(footprintVolumeText(0)).toBe('0');
  expect(footprintVolumeText(999.4)).toBe('999.4');
  // A fractional lot, which the whole-number form used to round away.
  expect(footprintVolumeText(0.37)).toBe('0.37');
  expect(footprintVolumeText(12.5)).toBe('12.5');
  expect(footprintVolumeText(0.001)).toBe('0.001');
  // The trailing zeros the decimals leave are dropped, so a K figure stays short enough for a narrow column.
  expect(footprintVolumeText(1500)).toBe('1.5 K');
  expect(footprintVolumeText(1590)).toBe('1.59 K');
  expect(footprintVolumeText(2180)).toBe('2.18 K');
  expect(footprintVolumeText(3770)).toBe('3.77 K');
  expect(footprintVolumeText(2000)).toBe('2 K');
  expect(footprintVolumeText(1_234_567)).toBe('1.235 M');
  // Below a thousand, but its decimals round it up, which reads as the K form.
  expect(footprintVolumeText(999.9999)).toBe('1 K');
  // A positive volume too small to show says how small it is.
  expect(footprintVolumeText(0.0004)).toBe('<0.001');
});

test('a cell is graded in quarters of its side, the lightest shade holding the first quarter', () => {
  expect(footprintBand(0, FULL_RANGE)).toBe(1);
  expect(footprintBand(24, FULL_RANGE)).toBe(1);
  expect(footprintBand(25, FULL_RANGE)).toBe(2);
  expect(footprintBand(49, FULL_RANGE)).toBe(2);
  expect(footprintBand(50, FULL_RANGE)).toBe(3);
  expect(footprintBand(74, FULL_RANGE)).toBe(3);
  expect(footprintBand(75, FULL_RANGE)).toBe(4);
  expect(footprintBand(100, FULL_RANGE)).toBe(4);
});

test('a side whose cells all traded the same volume draws every one of them in the lightest shade', () => {
  const flat: FootprintVolumeRange = { min: 42, max: 42 };

  expect(footprintBand(42, flat)).toBe(1);
  expect(footprintBand(0, flat)).toBe(1);
  expect(footprintShadeColor(FOOTPRINT_DEFAULT_BUY_SHADES, footprintBand(42, flat))).toBe('#5cc4b4');
  expect(footprintShadeColor(FOOTPRINT_DEFAULT_SELL_SHADES, footprintBand(42, flat))).toBe('#ff99a0');
});

test('a cell without the gradient takes the middle shade of its own side', () => {
  const sellBand = footprintCellBand(0, FULL_RANGE, false);
  const buyBand = footprintCellBand(100, FULL_RANGE, false);

  expect(footprintShadeColor(FOOTPRINT_DEFAULT_SELL_SHADES, sellBand)).toBe('#f7525f');
  expect(footprintShadeColor(FOOTPRINT_DEFAULT_BUY_SHADES, buyBand)).toBe('#089981');
});

test('a cell without the gradient is graded in the same middle band at every volume', () => {
  for (const volume of [0, 24, 25, 49, 50, 74, 75, 100]) {
    expect(footprintCellBand(volume, FULL_RANGE, false)).toBe(2);
  }
  // With the gradient on, the band is still the one the volume is graded to.
  expect(footprintCellBand(75, FULL_RANGE, true)).toBe(footprintBand(75, FULL_RANGE));
});

test('a two-column bar splits its body width into two equal columns around a thin candle', () => {
  // Twenty device pixels: a four-pixel candle leaves eight for each column, and none of the width unused.
  expect(footprintBarColumns(10, 20, NO_SCALING, 'two-columns')).toEqual({
    sell: { left: 0, width: 8 },
    candle: { left: 8, width: 4 },
    buy: { left: 12, width: 8 },
  });
});

test('a one-column bar keeps its thin candle on the body left edge and gives its single column the rest', () => {
  // A ninety-six-pixel body: its nineteen-pixel candle stands where the sell column used to start, and the single
  // column takes the body less that candle — 96 - 19 = 77 pixels — up to the body's right edge.
  expect(footprintBarColumns(10, 96, NO_SCALING, 'single-column')).toEqual({
    sell: { left: -37, width: 0 },
    candle: { left: -37, width: 19 },
    buy: { left: -18, width: 77 },
  });
  // The empty sell slot keeps the bar spanning its whole body, which its value area and its summary box are drawn in.
  expect(footprintBarColumns(10, 96, NO_SCALING, 'two-columns').sell.left).toBe(-37);
});

test('the one-column types pick the single-column layout while Buy and Sell and Ladder keep the two columns', () => {
  const layouts = FOOTPRINT_TYPES.map((type) => footprintLayoutOf(type));

  // The types are in the order FOOTPRINT_TYPES lists them: only the three that write one cell a row are one-column.
  expect(layouts).toEqual(['two-columns', 'single-column', 'single-column', 'single-column', 'two-columns']);
});

test('a cell covers the device pixels between the prices of its row', () => {
  expect(footprintCellBox(SIDE_COLUMN, 10, 14, 2)).toEqual({ left: 8, width: 8, top: 20, height: 8 });
  // A row the scale puts on one device pixel still paints that pixel.
  expect(footprintCellBox(SIDE_COLUMN, 10, 10.1, 2)).toEqual({ left: 8, width: 8, top: 20, height: 1 });
});

test('a cell writes a short text that fits it and leaves a long one out', () => {
  const ratios = { horizontalPixelRatio: 2, verticalPixelRatio: 2 };
  // Forty device pixels are twenty css pixels wide and fifteen tall: a two-character text and its two pixels of
  // padding fit, while a bid-ask pair needs far more room than the cell has.
  const narrow = { left: 0, width: 40, top: 0, height: 30 };
  const wide = { left: 0, width: 60, top: 0, height: 20 };
  const shorter = { left: 0, width: 60, top: 0, height: 18 };

  expect(footprintCellShowsText(narrow, '47', ratios, MEASURED_TEXT)).toBe(true);
  expect(footprintCellShowsText(narrow, '400 × 1.5 K', ratios, MEASURED_TEXT)).toBe(false);
  // A cell exactly one line of the font tall still writes its text, while one a device pixel shorter does not.
  expect(footprintCellShowsText(wide, '47', ratios, MEASURED_TEXT)).toBe(true);
  expect(footprintCellShowsText(shorter, '47', ratios, MEASURED_TEXT)).toBe(false);
});

test('a profile cell keeps its share of the column on the edge nearest the candle', () => {
  const column = { left: 20, width: 40, top: 100, height: 30 };

  // The buy column keeps its left edge and the sell column its right one, so a bar's cells grow away from it.
  expect(footprintProfileBox(column, 0.5, 'buy')).toEqual({ left: 20, width: 20, top: 100, height: 30 });
  expect(footprintProfileBox(column, 0.5, 'sell')).toEqual({ left: 40, width: 20, top: 100, height: 30 });
  // A cell of no width at all still paints one device pixel, so a quiet row never disappears.
  expect(footprintProfileBox(column, 0, 'buy')).toEqual({ left: 20, width: 1, top: 100, height: 30 });
});

test('the style asks the host for automatic rows, the value area and the imbalance of its appearance', () => {
  const appearance = volumeFootprintAppearance({});

  expect(barStyleAppearanceOf('volumeFootprint', {})).toEqual(appearance);
  expect(appearance).toEqual({
    style: 'volumeFootprint',
    candles: DEFAULT_CANDLE_APPEARANCE,
    // What the host computes the rows with, which the rest of the appearance does not decide.
    rowSize: { kind: 'auto', atrLength: 14 },
    valueAreaPercent: 70,
    imbalancePercent: 300,
    ...DEFAULT_FOOTPRINT_SETTINGS,
  });
  expect(chartFootprintRequest(appearance)).toEqual({
    rowSize: { kind: 'auto', atrLength: 14 },
    vaPercent: 70,
    imbalancePercent: 300,
  });
});

test('the appearance settings a saved file does not hold load their defaults', () => {
  // An older stored appearance carries none of the three keys; each value falls back to the default.
  const olderSavedAppearance = { body: { visible: true, up: '#26a69a', down: '#f7525f' } };

  expect(volumeFootprintAppearance(olderSavedAppearance)).toMatchObject(DEFAULT_FOOTPRINT_SETTINGS);
});

test('a footprint setting change repaints the appearance, and an unchanged one does not', () => {
  const appearance = volumeFootprintAppearance({});

  expect(sameBarStyleAppearance(appearance, volumeFootprintAppearance({}))).toBe(true);
  expect(sameBarStyleAppearance(appearance, { ...appearance, showSummary: false })).toBe(false);
  expect(sameBarStyleAppearance(appearance, { ...appearance, poc: { visible: false, color: '#ffffff' } })).toBe(false);
  expect(
    sameBarStyleAppearance(appearance, {
      ...appearance,
      imbalanceHighlight: { ...appearance.imbalanceHighlight, buyColor: '#00ff00', visible: false },
    }),
  ).toBe(false);
  expect(
    sameBarStyleAppearance(appearance, {
      ...appearance,
      imbalanceHighlight: { ...appearance.imbalanceHighlight, sellColor: '#ff0000' },
    }),
  ).toBe(false);
});

test('the series options start on the summary, the imbalance marks and the white row a bar traded most at', () => {
  const appearance = volumeFootprintAppearance({});

  // The appearance's own settings decide what the series draws, so the defaults reach its options unchanged.
  expect({
    gradient: appearance.gradient,
    display: appearance.display,
    type: appearance.type,
    values: appearance.values,
    sellShades: appearance.sellShades,
    buyShades: appearance.buyShades,
    showValueArea: appearance.showValueArea,
    stackedImbalance: appearance.stackedImbalance,
    showSummary: appearance.showSummary,
    imbalanceHighlight: appearance.imbalanceHighlight,
    poc: appearance.poc,
  }).toEqual(DEFAULT_FOOTPRINT_SETTINGS);
});

/** The settings a bar's summary is laid out with: the box on or off, and what it counts. */
const SUMMARY_SETTINGS: FootprintSummarySettings = { showSummary: true, values: 'volume' };

/** One bar's summary, laid out under the given columns at one device pixel per media pixel. */
function summaryLayoutOf(footprint: BarFootprint, columns: FootprintBarColumns, showSummary: boolean) {
  const settings = { ...SUMMARY_SETTINGS, showSummary };
  return footprintSummaryLayout(footprint, columns, LOWEST_ROW_BOTTOM, settings, NO_SCALING_RATIOS, MEASURED_TEXT);
}

/** One bar's summary, laid out under the hundred-pixel bar's columns. */
function summaryLayout(buyVolume: number, sellVolume: number, showSummary: boolean) {
  return summaryLayoutOf({ ...FOOTPRINT, buyVolume, sellVolume }, SUMMARY_COLUMNS, showSummary);
}

test('a bar writes each side total under its own column, in its side colour', () => {
  // The columns span x = -40 to 60: the sell total sits at the middle of -40..0, the buy one at 20..60,
  // and both are written seven pixels under the lowest row's bottom.
  expect(summaryLayout(1000, 600, false)).toEqual({
    box: null,
    texts: [
      { x: -20, y: 207, text: '600', color: '#F23645' },
      { x: 40, y: 207, text: '1 K', color: '#089981' },
    ],
  });
});

test('a one-column bar writes both totals in one coloured line under its span', () => {
  // Span -40..60, centre 10: the sell, separator and buy runs measure 30, 15 and 30 css px, so sit at -12.5, 10
  // and 32.5.
  const columns = footprintBarColumns(10, 100, NO_SCALING, 'single-column');
  const line = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 2180, sellVolume: 1590 }, columns, false);
  expect(line?.texts).toEqual([
    { x: -12.5, y: 207, text: '1.59 K', color: '#F23645' },
    { x: 10, y: 207, text: ' × ', color: '#dce4ef' },
    { x: 32.5, y: 207, text: '2.18 K', color: '#089981' },
  ]);
});

test('a Profile bar keeps both totals under its full columns', () => {
  const cell = footprintProfileBox({ ...SUMMARY_COLUMNS.buy, top: 0, height: 20 }, 0.4, 'buy');
  expect(footprintCellShowsText(cell, '1 K', NO_SCALING_RATIOS, MEASURED_TEXT)).toBe(false);
  expect(summaryLayout(1000, 600, false)?.texts.map((text) => text.text)).toEqual(['600', '1 K']);
});

test('the summary box spans the bar columns below the totals, with the delta and the total inside it', () => {
  // A hundred-pixel bar splits into a forty-pixel sell column, a twenty-pixel candle and a forty-pixel buy column,
  // so its columns span -40 to 60: 60 - -40 = 100 pixels wide, centred on -40 + 100 / 2 = 10, where both lines are
  // written. Two pixels under the totals the box starts, twenty-six pixels tall, and its two lines sit eight and
  // eighteen pixels into it.
  expect(summaryLayout(1000, 600, true)).toEqual({
    box: { left: -40, top: 214, width: 100, height: 26, radius: 3 },
    texts: [
      { x: -20, y: 207, text: '600', color: '#F23645' },
      { x: 40, y: 207, text: '1 K', color: '#089981' },
      { x: 10, y: 222, text: 'Delta 400', color: '#089981' },
      { x: 10, y: 232, text: 'Total 1.6 K', color: '#dce4ef' },
    ],
  });
});

test('a bar that traded more on its sell side writes a negative delta in red', () => {
  expect(footprintSummaryLines({ buy: 600, sell: 1000 })).toEqual({
    deltaText: '−400',
    deltaColor: '#F23645',
    totalText: '1.6 K',
  });
});

test('a bar that traded the same on both sides writes a neutral zero delta', () => {
  expect(footprintSummaryLines({ buy: 480, sell: 480 })).toEqual({
    deltaText: '0',
    deltaColor: '#c4c9d0',
    totalText: '960',
  });
});

test('a bar narrower than the summary needs writes neither the totals nor the box', () => {
  const narrow = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH - 1, NO_SCALING, 'two-columns');
  const atMinimum = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH, NO_SCALING, 'two-columns');

  expect(summaryLayoutOf(FOOTPRINT, narrow, true)).toBeNull();
  expect(summaryLayoutOf(FOOTPRINT, atMinimum, true)).not.toBeNull();
});

test('a summary line its column has no room for is left out, while the ones that fit are written', () => {
  // The narrowest bar that writes a summary: a sixty-pixel body leaves a twenty-four-pixel column a side, so both
  // short side totals fit their own columns, while inside the box the delta line fits the fifty-four pixels left of
  // its padding and the longer total line does not.
  const columns = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH, NO_SCALING, 'two-columns');

  expect(summaryLayoutOf(FOOTPRINT, columns, true)).toEqual({
    box: { left: -20, top: 214, width: 60, height: 26, radius: 3 },
    texts: [
      { x: -8, y: 207, text: '600', color: '#F23645' },
      { x: 28, y: 207, text: '1 K', color: '#089981' },
      { x: 10, y: 222, text: 'Delta 400', color: '#089981' },
    ],
  });
});

test('an imbalance mark stands on the outer edge of its cell, three css pixels wide and as tall as the row', () => {
  const cell = { left: 20, width: 40, top: 100, height: 30 };

  expect(IMBALANCE_MARK_WIDTH).toBe(3);
  // The sell mark takes the cell's left edge, the buy mark its right one.
  expect(footprintImbalanceBox(cell, 'sell', NO_SCALING)).toEqual({ left: 20, top: 100, width: 3, height: 30 });
  expect(footprintImbalanceBox(cell, 'buy', NO_SCALING)).toEqual({ left: 57, top: 100, width: 3, height: 30 });
  // Two device pixels per css pixel double the mark's thickness, so it reads the same on a dense screen.
  expect(footprintImbalanceBox(cell, 'buy', 2)).toEqual({ left: 54, top: 100, width: 6, height: 30 });
});

test('a bar reaches its footprint through its own time, and one without a footprint carries none', () => {
  const appearance = volumeFootprintAppearance({});

  const [withFootprint] = barStylePoints(appearance, [FOOTPRINT_BAR], new Map([[BAR_TIME_SECONDS, FOOTPRINT]]));
  const [withoutFootprint] = barStylePoints(appearance, [FOOTPRINT_BAR]);

  expect(withFootprint).toMatchObject({ time: BAR_TIME_SECONDS, open: 1.15, high: 1.2, low: 1.1, close: 1.18 });
  expect(withFootprint).toHaveProperty('footprint', FOOTPRINT);
  expect(withoutFootprint).not.toHaveProperty('footprint');
});

/** One bar as the host sends it: the prices and volumes as trading-core's decimal strings. */
const WIRE_FOOTPRINT: WireBarFootprint = {
  openMs: BAR_TIME_SECONDS * 1000,
  rows: [
    {
      row: 0,
      downPrice: '1.10000',
      upPrice: '1.15000',
      buyVolume: '600.00',
      sellVolume: '200.5',
      buyTrades: 6,
      sellTrades: 2,
      buyImbalance: true,
      sellImbalance: false,
    },
  ],
  buyVolume: '1000.25',
  sellVolume: '600.75',
  buyTrades: 10,
  sellTrades: 6,
  poc: 0,
  vah: 0,
  val: 0,
  volume: 'real',
};

test('the host decimal strings are read into the numbers the cells are measured with', () => {
  expect(readBarFootprint(WIRE_FOOTPRINT)).toEqual({
    openMs: BAR_TIME_SECONDS * 1000,
    rows: [
      {
        row: 0,
        downPrice: 1.1,
        upPrice: 1.15,
        buyVolume: 600,
        sellVolume: 200.5,
        buyTrades: 6,
        sellTrades: 2,
        buyImbalance: true,
        sellImbalance: false,
      },
    ],
    buyVolume: 1000.25,
    sellVolume: 600.75,
    buyTrades: 10,
    sellTrades: 6,
    poc: 0,
    vah: 0,
    val: 0,
    volume: 'real',
  });
});

test('a decimal the wire cannot read counts as nothing rather than as a price off the scale', () => {
  const [row] = readBarFootprint({
    ...WIRE_FOOTPRINT,
    rows: [{ ...WIRE_FOOTPRINT.rows[0], downPrice: 'n/a', buyVolume: '' }],
  }).rows;

  expect(row).toMatchObject({ downPrice: 0, upPrice: 1.15, buyVolume: 0, sellVolume: 200.5 });
});
