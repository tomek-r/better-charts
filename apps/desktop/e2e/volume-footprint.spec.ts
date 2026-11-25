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
  FOOTPRINT_FONT_SIZE,
  footprintBarColumns,
  footprintCellBox,
  footprintCellShowsText,
  footprintProfileBox,
  footprintTextAlignOf,
  footprintTextX,
  MAX_COLUMN_WIDTH,
  ROW_GAP,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
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
import {
  VALUE_AREA_DASH,
  VALUE_AREA_LINE_WIDTH,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintValueArea';
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
/** One column of a bar, in device pixels, which the cell boxes are measured inside. */
const SIDE_COLUMN = { left: 8, width: 8 };
/** How wide the spec's text is in css px: five pixels a character, which a stub measures without any canvas. */
const MEASURED_TEXT: FootprintTextWidth = (text) => text.length * 5;
/** A bar's time, in the UTC seconds the chart times its bars with. */
const BAR_TIME_SECONDS = 1_700_000_000;
/**
 * A hundred-pixel bar's columns, on x = 10: a thirty-six-pixel sell column, a six-pixel gap, a fifteen-pixel candle,
 * another gap and a thirty-seven-pixel buy column, so the columns span -40 to 60 and fill the body.
 */
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

test('a cell writes at most two decimals, with its unit right after the number', () => {
  expect(footprintVolumeText(219_507)).toBe('219.51K');
  expect(footprintVolumeText(1_234_567)).toBe('1.23M');
  expect(footprintVolumeText(47)).toBe('47');
  expect(footprintVolumeText(488)).toBe('488');
  expect(footprintVolumeText(613)).toBe('613');
  expect(footprintVolumeText(0)).toBe('0');
  expect(footprintVolumeText(999.4)).toBe('999.4');
  // A fractional lot keeps up to two decimals, the zeros behind them trimmed away.
  expect(footprintVolumeText(0.25)).toBe('0.25');
  expect(footprintVolumeText(12.5)).toBe('12.5');
  expect(footprintVolumeText(1500)).toBe('1.5K');
  expect(footprintVolumeText(1590)).toBe('1.59K');
  expect(footprintVolumeText(2180)).toBe('2.18K');
  expect(footprintVolumeText(8980)).toBe('8.98K');
  expect(footprintVolumeText(17_880)).toBe('17.88K');
  expect(footprintVolumeText(32_760)).toBe('32.76K');
  expect(footprintVolumeText(96_000)).toBe('96K');
  expect(footprintVolumeText(98_300)).toBe('98.3K');
  expect(footprintVolumeText(194_300)).toBe('194.3K');
  expect(footprintVolumeText(1_200_000)).toBe('1.2M');
  // Below a thousand, but its decimals round it up, which reads as the K form.
  expect(footprintVolumeText(999.9999)).toBe('1K');
  // A positive volume too small to show says how small it is.
  expect(footprintVolumeText(0.004)).toBe('<0.01');
});

test('a footprint number is written in fourteen css px against the edge nearest the candle', () => {
  expect(FOOTPRINT_FONT_SIZE).toBe(14);
  expect(TEXT_LINE_HEIGHT).toBe(FOOTPRINT_FONT_SIZE);
  expect(TEXT_PADDING).toBe(8);
  // The sell column stands left of the candle, so its numbers end eight pixels inside its own right edge.
  expect(footprintTextAlignOf('sell')).toBe('right');
  expect(footprintTextX({ left: 0, width: 40 }, 'right', NO_SCALING)).toBe(32);
  // The buy column stands right of the candle, and a one-column bar writes in that same column.
  expect(footprintTextAlignOf('buy')).toBe('left');
  expect(footprintTextX({ left: 60, width: 40 }, 'left', NO_SCALING)).toBe(68);
  // Two device pixels per css px halve the media x, while the padding stays eight css px inside the column.
  expect(footprintTextX({ left: 0, width: 80 }, 'right', 2)).toBe(32);
});

test('the value area is marked by a dashed line three css px on and three off, one css px wide', () => {
  expect(VALUE_AREA_DASH).toEqual([3, 3]);
  expect(VALUE_AREA_LINE_WIDTH).toBe(1);
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

test('a two-column bar leaves a gap either side of its thin candle and splits the rest into two columns', () => {
  // Forty device pixels: a six-pixel candle with six pixels of background either side of it, and the remaining
  // twenty-two pixels split into a column of eleven on each side, so the gaps and the columns fill the body.
  expect(footprintBarColumns(10, 40, NO_SCALING, 'two-columns')).toEqual({
    sell: { left: -10, width: 11 },
    candle: { left: 7, width: 6 },
    buy: { left: 19, width: 11 },
  });
  // A body too narrow for six-pixel gaps keeps a quarter of what the candle leaves for each gap instead.
  expect(footprintBarColumns(10, 20, NO_SCALING, 'two-columns')).toEqual({
    sell: { left: 0, width: 4 },
    candle: { left: 8, width: 3 },
    buy: { left: 15, width: 5 },
  });
});

test('a one-column bar keeps its thin candle on the group left edge and holds its column at the cap', () => {
  // A ninety-six-pixel body: its fourteen-pixel candle stands on the group's left edge, six pixels of background
  // follow it, and the single column is held at its seventy-two-pixel cap rather than taking the seventy-six pixels
  // the body leaves it, so the 92-pixel group is centred on the bar's x with two pixels of body either side of it.
  expect(footprintBarColumns(10, 96, NO_SCALING, 'single-column')).toEqual({
    sell: { left: -36, width: 0 },
    candle: { left: -36, width: 14 },
    buy: { left: -16, width: MAX_COLUMN_WIDTH },
  });
  // A body its two columns can still fill keeps them filling it, the sell column on the body's left edge.
  expect(footprintBarColumns(10, 96, NO_SCALING, 'two-columns').sell.left).toBe(-38);
});

test('a very wide two-column bar caps both columns and centres the group on its x', () => {
  // Four hundred css px: the thin candle keeps the fifteen percent of the body it always took — sixty device pixels
  // — while each column stops at the seventy-two-pixel cap, so the two columns, the two gaps and the candle make a
  // 216-pixel group centred on the bar's x, leaving 92 device pixels of empty body either side of it.
  const columns = footprintBarColumns(10, 400, NO_SCALING, 'two-columns');
  const bodyLeft = 10 - 400 / 2;
  const bodyRight = bodyLeft + 400;
  const groupRight = columns.buy.left + columns.buy.width;

  expect(MAX_COLUMN_WIDTH).toBe(72);
  expect(columns).toEqual({
    sell: { left: -98, width: MAX_COLUMN_WIDTH },
    candle: { left: -20, width: 60 },
    buy: { left: 46, width: MAX_COLUMN_WIDTH },
  });
  // The cap never touches the candle, whose width is still the body's own share of it.
  expect(columns.candle.width).toBe(60);
  expect((columns.sell.left + groupRight) / 2).toBe(10);
  // Both outer sides of the body stay empty by the same amount, rather than the columns growing into them.
  expect(columns.sell.left - bodyLeft).toBe(bodyRight - groupRight);
  expect(columns.sell.left - bodyLeft).toBe(92);
  // The hundred-pixel fixtures the rest of this spec lays out are narrow enough for the cap never to bite.
  expect(SUMMARY_COLUMNS.sell.width).toBeLessThan(MAX_COLUMN_WIDTH);
  expect(SUMMARY_COLUMNS.buy.width).toBeLessThan(MAX_COLUMN_WIDTH);
});

test('a very wide one-column bar caps its one column and keeps the candle on the group left edge', () => {
  // Four hundred css px: a sixty-pixel candle, a six-pixel gap and the column held at its seventy-two-pixel cap make
  // a 138-pixel group that starts on -59, with the candle on its left edge, and is centred on the bar's x, so 131
  // device pixels of the body stay empty on either side of it.
  const columns = footprintBarColumns(10, 400, NO_SCALING, 'single-column');
  const bodyLeft = 10 - 400 / 2;
  const bodyRight = bodyLeft + 400;
  const groupRight = columns.buy.left + columns.buy.width;

  expect(columns).toEqual({
    sell: { left: -59, width: 0 },
    candle: { left: -59, width: 60 },
    buy: { left: 7, width: MAX_COLUMN_WIDTH },
  });
  // The candle stands on the group's left edge, six pixels of background follow it, and the one column is capped.
  expect(columns.candle.left).toBe(columns.sell.left);
  expect(columns.buy.left).toBe(columns.candle.left + columns.candle.width + 6);
  expect((columns.sell.left + groupRight) / 2).toBe(10);
  expect(columns.sell.left - bodyLeft).toBe(bodyRight - groupRight);
  expect(columns.sell.left - bodyLeft).toBe(131);
});

test('the column cap is css px scaled by the screen ratio, in whole device pixels', () => {
  // The same four hundred css px body on a screen of two device pixels per css px is eight hundred device pixels
  // wide: its candle takes a hundred and twenty of them, each column is capped at a hundred and forty-four — the
  // same seventy-two css px — and the 432-pixel group is centred on device pixel twenty, the bar's own x.
  const columns = footprintBarColumns(10, 800, 2, 'two-columns');

  expect(columns).toEqual({
    sell: { left: -196, width: 144 },
    candle: { left: -40, width: 120 },
    buy: { left: 92, width: 144 },
  });
  expect(columns.sell.width / 2).toBe(MAX_COLUMN_WIDTH);
  expect(columns.buy.width / 2).toBe(MAX_COLUMN_WIDTH);
  expect((columns.sell.left + columns.buy.left + columns.buy.width) / 2).toBe(20);
});

test('only Delta and Total keep the single column, while Buy and Sell, Bid × Ask and Ladder hold both', () => {
  const layouts = FOOTPRINT_TYPES.map((type) => footprintLayoutOf(type));

  // The types are in the order FOOTPRINT_TYPES lists them: only Delta and Total, which write one cell a row, are
  // one-column.
  expect(layouts).toEqual(['two-columns', 'two-columns', 'single-column', 'single-column', 'two-columns']);
});

test('a cell covers the device pixels between the prices of its row, less the row gap above the next', () => {
  // Every cell keeps two css px of background under it: at two device pixels per css px the cell starts on device
  // pixel 20 and ends four pixels above the next row's top on 28, so it is four pixels tall.
  expect(ROW_GAP).toBe(2);
  const cell = footprintCellBox(SIDE_COLUMN, 10, 14, 2);
  expect(cell).toEqual({ left: 8, width: 8, top: 20, height: 4 });
  expect(cell.top + cell.height).toBe(Math.round(14 * 2) - ROW_GAP * 2);
  // A row too short to keep a device pixel after the gap keeps one, so a quiet row never disappears.
  expect(footprintCellBox(SIDE_COLUMN, 10, 11, 1)).toEqual({ left: 8, width: 8, top: 10, height: 1 });
  // A row the scale puts on one device pixel paints that pixel too.
  expect(footprintCellBox(SIDE_COLUMN, 10, 10.1, 2)).toEqual({ left: 8, width: 8, top: 20, height: 1 });
});

test('a cell writes a short text that fits it and leaves a long one out', () => {
  const ratios = { horizontalPixelRatio: 2, verticalPixelRatio: 2 };
  // Forty device pixels are twenty css pixels wide and fifteen tall: a two-character text and its eight pixels of
  // padding fit, while a long pair of numbers needs far more room than the cell has.
  const narrow = { left: 0, width: 40, top: 0, height: 30 };
  const oneLine = TEXT_LINE_HEIGHT * ratios.verticalPixelRatio;
  const wide = { left: 0, width: 60, top: 0, height: oneLine };
  const shorter = { left: 0, width: 60, top: 0, height: oneLine - 1 };

  expect(footprintCellShowsText(narrow, '47', ratios, MEASURED_TEXT)).toBe(true);
  expect(footprintCellShowsText(narrow, '400 × 1.5K', ratios, MEASURED_TEXT)).toBe(false);
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
  // A profile cell is as tall as the cluster cell of its row, so every display leaves the same row gap under it.
  const row = footprintCellBox({ left: 20, width: 40 }, 10, 14, 2);
  expect(footprintProfileBox(row, 0.5, 'buy')).toEqual({ left: 20, width: 20, top: 20, height: 4 });
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

test('a bar writes each side total under its own column, against the edge nearest the candle', () => {
  // The columns span x = -40 to 60: the sell total ends eight pixels inside its own right edge, the buy total starts
  // eight pixels inside its left one, and both are written eleven pixels under the lowest row's bottom — the middle
  // of a line that starts four pixels below it.
  expect(summaryLayout(1000, 600, false)).toEqual({
    box: null,
    texts: [
      { x: -12, y: 211, text: '600', color: '#F23645', align: 'right' },
      { x: 31, y: 211, text: '1K', color: '#089981', align: 'left' },
    ],
  });
});

test('a one-column bar writes both totals in one coloured line under its own column', () => {
  // The capped single column runs from -15 to 57, so the sell, separator and buy runs — 15, 15 and 25 css px wide —
  // start at -7, 8 and 23, all written eleven pixels under the lowest row's bottom: fifty-five pixels of text and
  // their eight pixels of padding fit the seventy-two-pixel column.
  const columns = footprintBarColumns(10, 100, NO_SCALING, 'single-column');
  const line = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 2180, sellVolume: 600 }, columns, false);
  expect(line?.texts).toEqual([
    { x: -7, y: 211, text: '600', color: '#F23645', align: 'left' },
    { x: 8, y: 211, text: ' × ', color: '#dce4ef', align: 'left' },
    { x: 23, y: 211, text: '2.18K', color: '#089981', align: 'left' },
  ]);
  // Two five-character totals and their separator need sixty-five pixels, which with their padding spill past the
  // capped column, so that whole line is left out rather than written over the column's edge.
  const longer = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 2180, sellVolume: 1590 }, columns, false);
  expect(longer?.box).toBeNull();
  expect(longer?.texts).toEqual([]);
});

test('a Profile bar keeps both totals under its full columns', () => {
  const cell = footprintProfileBox({ ...SUMMARY_COLUMNS.buy, top: 0, height: 20 }, 0.3, 'buy');
  // The narrowed cell has no room for the total its full column still writes.
  expect(footprintCellShowsText(cell, '1K', NO_SCALING_RATIOS, MEASURED_TEXT)).toBe(false);
  expect(summaryLayout(1000, 600, false)?.texts.map((text) => text.text)).toEqual(['600', '1K']);
});

test('the summary box spans the bar columns below the totals, with the delta and the total inside it', () => {
  // The bar's columns span -40 to 60, so the box is the hundred pixels between them. Six pixels under the totals it
  // starts, fifty-two pixels tall with its six pixels of padding, and its two twenty-pixel lines are written sixteen
  // and thirty-six pixels into it. Both lines make one block — the thirty-one-pixel label column, the wider label plus
  // six pixels, and the twenty-pixel '1.6K' after it, so fifty-one pixels wide — which the box centres: it starts
  // -15.5, twenty-four and a half pixels in from the box's left edge and as far from its right one. A label stands on
  // the block's left edge and its value right after the label column, on 15.5.
  expect(summaryLayout(1000, 600, true)).toEqual({
    box: { left: -40, top: 224, width: 100, height: 52, radius: 6 },
    texts: [
      { x: -12, y: 211, text: '600', color: '#F23645', align: 'right' },
      { x: 31, y: 211, text: '1K', color: '#089981', align: 'left' },
      { x: -15.5, y: 240, text: 'Delta', color: '#089981', align: 'left' },
      { x: 15.5, y: 240, text: '400', color: '#089981', align: 'left', bold: true },
      { x: -15.5, y: 260, text: 'Total', color: '#dce4ef', align: 'left' },
      { x: 15.5, y: 260, text: '1.6K', color: '#dce4ef', align: 'left', bold: true },
    ],
  });
});

test('the summary box centres its two lines, leaving them the same room either side', () => {
  // The block is fifty-one css px wide inside a hundred-pixel box, so it stands twenty-four and a half pixels in from
  // either edge: the left margin the leftmost text leaves and the right margin the rightmost text leaves are equal.
  const layout = summaryLayout(1000, 600, true);
  if (layout === null || layout.box === null) {
    throw new Error('a hundred-pixel bar writes its summary box');
  }
  const { box } = layout;
  // The box's own texts are the ones written at or below its top, under the totals above it.
  const boxTexts = layout.texts.filter((text) => text.y >= box.top);
  const blockLeft = Math.min(...boxTexts.map((text) => text.x));
  const blockRight = Math.max(...boxTexts.map((text) => text.x + MEASURED_TEXT(text.text)));
  const leftMargin = blockLeft - box.left;
  const rightMargin = box.left + box.width - blockRight;

  expect(boxTexts).toHaveLength(4);
  expect(leftMargin).toBeCloseTo(24.5, 5);
  expect(rightMargin).toBeCloseTo(24.5, 5);
  expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(1);
  // Centred or not, the block never leaves the box.
  expect(leftMargin).toBeGreaterThan(0);
  expect(rightMargin).toBeGreaterThan(0);
});

test('a one-column bar spans its summary box over its own column, leaving the empty sell slot out', () => {
  const columns = footprintBarColumns(10, 100, NO_SCALING, 'single-column');
  const layout = summaryLayoutOf(FOOTPRINT, columns, true);

  // The capped single column runs from -15 to 57: the box starts on that column's left edge and is exactly as wide
  // as it, rather than reaching back over the thin candle to the group's left edge.
  expect(layout?.box?.left).toBe(columns.buy.left);
  expect(layout?.box?.width).toBe(columns.buy.width);
  expect(layout?.box).toEqual({ left: -15, top: 224, width: 72, height: 52, radius: 6 });
});

test('a very wide bar spans its summary box over the capped group, not the whole body', () => {
  const columns = footprintBarColumns(10, 400, NO_SCALING, 'two-columns');
  const layout = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 1000, sellVolume: 600 }, columns, true);

  // The box is the 216 device pixels of the capped group rather than the 400 of the body, and each total stands
  // inside its own capped column: eight pixels in from the sell column's right edge on -26, and eight pixels in
  // from the buy column's left one on 46.
  expect(layout?.box).toEqual({ left: -98, top: 224, width: 216, height: 52, radius: 6 });
  expect(layout?.texts.slice(0, 2)).toEqual([
    { x: -34, y: 211, text: '600', color: '#F23645', align: 'right' },
    { x: 54, y: 211, text: '1K', color: '#089981', align: 'left' },
  ]);
});

test('a bar that traded more on its sell side writes a negative delta in red', () => {
  expect(footprintSummaryLines({ buy: 600, sell: 1000 })).toEqual({
    deltaText: '−400',
    deltaColor: '#F23645',
    totalText: '1.6K',
  });
});

test('a bar that traded the same on both sides writes a neutral zero delta', () => {
  expect(footprintSummaryLines({ buy: 480, sell: 480 })).toEqual({
    deltaText: '0',
    deltaColor: '#c4c9d0',
    totalText: '960',
  });
});

test('a bar whose summary strip is narrower than the minimum writes neither the totals nor the box', () => {
  const narrow = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH - 1, NO_SCALING, 'two-columns');
  const atMinimum = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH, NO_SCALING, 'two-columns');
  // A one-column bar's box is only as wide as its one column: a seventy-six-pixel body leaves a fifty-nine-pixel
  // column, so the box is refused even though the bar itself is wider than the minimum.
  const oneColumn = footprintBarColumns(10, 76, NO_SCALING, 'single-column');

  expect(summaryLayoutOf(FOOTPRINT, narrow, true)).toBeNull();
  expect(summaryLayoutOf(FOOTPRINT, atMinimum, true)).not.toBeNull();
  expect(oneColumn.buy.width).toBe(MIN_SUMMARY_BAR_WIDTH - 1);
  expect(summaryLayoutOf(FOOTPRINT, oneColumn, true)).toBeNull();
});

test('a summary line its column has no room for is left out, while the ones that fit are written', () => {
  // The narrowest bar that writes a summary: a sixty-pixel body leaves a nineteen-pixel sell column and a
  // twenty-pixel buy column. Eight pixels of padding need twenty-three pixels for the fifteen-pixel sell total, four
  // more than its column has, so only the buy total is written; inside the box the delta line fits the forty-eight
  // pixels left of its padding and the longer total line does not. The block would be fifty-one pixels wide, three
  // more than that room, so it cannot be centred and starts on the inner padding, -14, its value thirty-one pixels on.
  const columns = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH, NO_SCALING, 'two-columns');
  const sellColumn = { ...columns.sell, top: 0, height: TEXT_LINE_HEIGHT };

  expect(footprintCellShowsText(sellColumn, '600', NO_SCALING_RATIOS, MEASURED_TEXT)).toBe(false);
  expect(summaryLayoutOf(FOOTPRINT, columns, true)).toEqual({
    box: { left: -20, top: 224, width: 60, height: 52, radius: 6 },
    texts: [
      { x: 28, y: 211, text: '1K', color: '#089981', align: 'left' },
      { x: -14, y: 240, text: 'Delta', color: '#089981', align: 'left' },
      { x: 17, y: 240, text: '400', color: '#089981', align: 'left', bold: true },
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
