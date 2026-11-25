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
  footprintCandleGlyph,
  footprintCellBox,
  footprintInnerGap,
  footprintProfileBox,
  footprintTextAlignOf,
  MAX_COLUMN_WIDTH,
  ROW_GAP,
  type FootprintBarColumns,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintGeometry';
import {
  footprintImbalanceBox,
  IMBALANCE_MARK_SPACE,
  IMBALANCE_MARK_WIDTH,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintImbalance';
import {
  FOOTPRINT_TYPES,
  footprintLayoutOf,
  type FootprintLayout,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintModes';
import {
  FOOTPRINT_SIDES,
  footprintBand,
  footprintCellBand,
  footprintShadeColor,
  type FootprintVolumeRange,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintShades';
import {
  footprintSummaryLayout,
  footprintSummaryLines,
  MIN_SUMMARY_BAR_WIDTH,
  type FootprintSummaryLayout,
  type FootprintSummarySettings,
  type FootprintTextMark,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintSummary';
import {
  FOOTPRINT_FONT_SIZE,
  footprintBarTextSize,
  footprintCellShowsText,
  footprintTextPadding,
  footprintTextWidthAt,
  footprintTextX,
  MIN_FOOTPRINT_FONT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  type FootprintTextStyle,
  type FootprintTextWidth,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintTextSize';
import {
  MIN_MARKER_BAR_WIDTH,
  VALUE_AREA_DASH,
  VALUE_AREA_LINE_WIDTH,
  VALUE_AREA_MARKER_GAP,
  VALUE_AREA_OVERHANG,
  valueAreaDashPixels,
  valueAreaLineSpan,
  valueAreaMark,
  valueAreaMarkerX,
  type FootprintValueAreaSpan,
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
 * What the volume footprint style means to the engine: the volume a cell writes, the shade a cell is graded in, the
 * size a bar writes its numbers at, the device geometry of the two columns and the thin candle, the summary under
 * them, the value area's dotted lines and their marker, the imbalance marks and the rows the host is asked for.
 */

/** One side's volumes from nothing to a hundred, which every band boundary is read against. */
const FULL_RANGE: FootprintVolumeRange = { min: 0, max: 100 };
/** One device pixel per media pixel, so the geometry reads as the media values do. */
const NO_SCALING = 1;
/** One device pixel per media pixel on both axes, as a screen at the default ratio reports them. */
const NO_SCALING_RATIOS = { horizontalPixelRatio: NO_SCALING, verticalPixelRatio: NO_SCALING };
/** One column of a bar, in device pixels, which the cell boxes are measured inside. */
const SIDE_COLUMN = { left: 8, width: 8 };
/** The background between the thin candle and each column beside it, in css px, at the suite's one-to-one ratio. */
const CANDLE_GAP = 6;
/** How wide the spec's text is in css px: five pixels a character, which a stub measures without any canvas. */
const MEASURED_TEXT: FootprintTextWidth = (text) => text.length * 5;

/** What a bar writing at `size` css px is measured with, one device pixel per css px unless a test says otherwise. */
function textStyleOf(size: number, textWidth: FootprintTextWidth = MEASURED_TEXT): FootprintTextStyle {
  return { size, textWidth, ...NO_SCALING_RATIOS };
}

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
 * The device-pixel span the value area lines of a bar `fullWidth` css px wide cross its columns over: the sell
 * column's left edge — the thin candle's own, in the single-column layout, where the empty sell slot stands — out to
 * the buy column's right one. The lines themselves are drawn VALUE_AREA_OVERHANG css px past either end of it.
 */
function valueAreaSpanOf(fullWidth: number, layout: FootprintLayout = 'two-columns'): FootprintValueAreaSpan {
  const columns = footprintBarColumns(10, fullWidth, NO_SCALING, layout);
  return { left: columns.sell.left, right: columns.buy.left + columns.buy.width };
}

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
  expect(footprintTextX({ left: 0, width: 40 }, 'right', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(32);
  // The buy column stands right of the candle, and a one-column bar writes in that same column.
  expect(footprintTextAlignOf('buy')).toBe('left');
  expect(footprintTextX({ left: 60, width: 40 }, 'left', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(68);
  // Two device pixels per css px halve the media x, while the padding stays eight css px inside the column.
  const doubled = { ...textStyleOf(FOOTPRINT_FONT_SIZE), horizontalPixelRatio: 2 };
  expect(footprintTextX({ left: 0, width: 80 }, 'right', doubled)).toBe(32);
});

test('a bar writes every one of its numbers at the largest whole size its shortest row holds', () => {
  // The maximum is written while the bar's rows hold a line of it, a row of ten css px writes at ten, and a row under
  // the smallest size writes nothing at all. The rows are the cells' boxes in device pixels, so a screen of two
  // device pixels per css px halves them.
  expect(MIN_FOOTPRINT_FONT_SIZE).toBe(8);
  expect(footprintBarTextSize([20, 20], NO_SCALING)).toBe(FOOTPRINT_FONT_SIZE);
  expect(footprintBarTextSize([TEXT_LINE_HEIGHT], NO_SCALING)).toBe(FOOTPRINT_FONT_SIZE);
  expect(footprintBarTextSize([10], NO_SCALING)).toBe(10);
  // The size is a whole css px, so a row of thirteen and a half css px writes at thirteen.
  expect(footprintBarTextSize([13.5], NO_SCALING)).toBe(13);
  // The shortest row of the bar decides for every one of its cells.
  expect(footprintBarTextSize([20, 10], NO_SCALING)).toBe(10);
  expect(footprintBarTextSize([MIN_FOOTPRINT_FONT_SIZE], NO_SCALING)).toBe(MIN_FOOTPRINT_FONT_SIZE);
  expect(footprintBarTextSize([MIN_FOOTPRINT_FONT_SIZE - 0.5], NO_SCALING)).toBeNull();
  expect(footprintBarTextSize([], NO_SCALING)).toBeNull();
  // Twenty device pixels are ten css px.
  expect(footprintBarTextSize([20], 2)).toBe(10);
});

test('a text keeps its padding and its width in proportion to the size it is written at', () => {
  // Eight css px of padding at the maximum size, scaled with the size the bar writes in: a ten-pixel bar keeps
  // 8 × 10/14 = 5.71 px of it, and draws a text at 10/14 of the width it measures at the maximum — measured once, so
  // no canvas is built per size.
  expect(footprintTextPadding(FOOTPRINT_FONT_SIZE)).toBe(TEXT_PADDING);
  expect(footprintTextPadding(10)).toBeCloseTo(8 * (10 / FOOTPRINT_FONT_SIZE), 10);
  expect(footprintTextWidthAt('219.51K', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(35);
  expect(footprintTextWidthAt('219.51K', textStyleOf(10))).toBeCloseTo(25, 10);
  // The room a text keeps from the edge it stands against scales with it: 40 - 8 × 10/14 = 34.29 px inside a column
  // whose right edge is on 40.
  expect(footprintTextX({ left: 0, width: 40 }, 'right', textStyleOf(10))).toBeCloseTo(34.285714, 5);
});

test('a cell writes its number at the size its bar holds, and nothing while that size does not fit it', () => {
  // A sixty-px column ten css px tall: the twelve-character totals line needs 60 + 8 = 68 px at fourteen, more than
  // the column has, and 60 × 10/14 + 8 × 10/14 = 48.57 px at ten, which fits.
  const cell = { left: 0, width: 60, top: 0, height: 10 };
  const line = '600 × 2.18K';
  const oneLineCell = { ...cell, height: TEXT_LINE_HEIGHT };

  expect(footprintCellShowsText(oneLineCell, cell.width, line, textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(false);
  expect(footprintCellShowsText(cell, cell.width, line, textStyleOf(10))).toBe(true);
});

test('the value area is marked by a dotted line one css px on and two off, one css px wide', () => {
  expect(VALUE_AREA_DASH).toEqual([1, 2]);
  expect(VALUE_AREA_LINE_WIDTH).toBe(1);
});

test('a value area dot keeps whole device pixels on any screen', () => {
  // One css px on and two off as the suite's one-to-one screen keeps them, doubled on a screen of two device px per
  // css px, and rounded where the ratio is fractional: 1 × 1.25 = 1.25 and 2 × 1.25 = 2.5 are no whole pixels, so
  // the dot keeps one of them and the gap three.
  expect(valueAreaDashPixels(NO_SCALING)).toEqual([1, 2]);
  expect(valueAreaDashPixels(2)).toEqual([2, 4]);
  expect(valueAreaDashPixels(1.25)).toEqual([1, 3]);
});

test('a value area line runs four css px past the outermost column of either layout', () => {
  // A hundred-pixel two-column bar's columns span -40 to 60: its line starts four css px left of the sell column and
  // stops four past the buy one, so it overhangs the outer edges of the bar's columns on both sides.
  const twoColumns = valueAreaSpanOf(100);
  expect(VALUE_AREA_OVERHANG).toBe(4);
  expect(twoColumns).toEqual({ left: -40, right: 60 });
  expect(valueAreaLineSpan(twoColumns, NO_SCALING)).toEqual({ left: -44, right: 64 });
  // The one-column bar keeps no sell column, so its line starts four css px left of its thin candle and stops four
  // past its one column: the 136-px body centres the candle on 0 and spans it to 20, and the column stops at its cap.
  const single = valueAreaSpanOf(OWNER_BODY_WIDTH, 'single-column');
  expect(single).toEqual({ left: 0, right: 98 });
  expect(valueAreaLineSpan(single, NO_SCALING)).toEqual({ left: -4, right: 102 });
  // The overhang is css px at the screen's ratio, in whole device px: eight on a screen of two device px per css px,
  // and six on one of a ratio and a half, where 4 × 1.5 = 6.
  expect(valueAreaLineSpan(twoColumns, 2)).toEqual({ left: -48, right: 68 });
  expect(valueAreaLineSpan(twoColumns, 1.5)).toEqual({ left: -46, right: 66 });
});

test('a bar writes its value area marker at its own text size, its gap scaled with it', () => {
  // A hundred-pixel two-column bar's columns span -40 to 60, and its line runs four css px past the sell column's
  // edge: at the maximum size the marker stands the two css px of its gap left of that line's own left end, and the
  // mark carries the size the media pass writes it at.
  const span = valueAreaSpanOf(100);

  expect(MIN_MARKER_BAR_WIDTH).toBe(48);
  expect(VALUE_AREA_MARKER_GAP).toBe(2);
  expect(valueAreaMarkerX(span, textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(-46);
  expect(valueAreaMark(span, [211, 240], textStyleOf(FOOTPRINT_FONT_SIZE))).toEqual({
    markerX: -46,
    ys: [211, 240],
    size: FOOTPRINT_FONT_SIZE,
  });
});

test('a bar writing at a smaller size marks its value area with a smaller marker, nearer the bar', () => {
  const span = valueAreaSpanOf(100);
  const style = textStyleOf(10);
  const mark = valueAreaMark(span, [211], style);

  // A ten-px bar keeps 2 × 10/14 = 1.43 css px of the gap, so its marker stands nearer the line's left end than the
  // two px of a bar at the maximum size, and it is written at ten px rather than fourteen: that end stands on -44,
  // so the marker is written on -45.43.
  expect(valueAreaMarkerX(span, style)).toBeCloseTo(-45.428571, 5);
  expect(valueAreaMarkerX(span, style)).toBeGreaterThan(valueAreaMarkerX(span, textStyleOf(FOOTPRINT_FONT_SIZE)));
  expect(mark?.markerX).toBe(valueAreaMarkerX(span, style));
  expect(mark?.size).toBe(10);
  expect(mark?.ys).toEqual([211]);
});

test('a bar too narrow for a marker, or one writing no text at all, marks its value area with none', () => {
  const style = textStyleOf(FOOTPRINT_FONT_SIZE);
  const narrow = valueAreaSpanOf(MIN_MARKER_BAR_WIDTH - 1);
  const atMinimum = valueAreaSpanOf(MIN_MARKER_BAR_WIDTH);

  // The marker stands left of the bar, so a bar whose group is narrower than the minimum keeps its dotted lines and
  // no marker, which would otherwise reach over the bar beside it once the chart is zoomed out.
  expect(atMinimum.right - atMinimum.left).toBe(MIN_MARKER_BAR_WIDTH);
  expect(valueAreaMark(narrow, [211], style)).toBeNull();
  expect(valueAreaMark(atMinimum, [211], style)).not.toBeNull();
  // A bar whose rows hold no line even of the smallest size writes no number, so it marks nothing either.
  expect(valueAreaMark(atMinimum, [211], null)).toBeNull();
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

test('a one-column bar centres its thin candle on the bar x and holds its column at the cap', () => {
  // A ninety-six-pixel body: its fourteen-pixel candle is centred on the bar's own x = 10, spanning 3 to 17, six
  // pixels of background follow it, and the single column is held at its seventy-two-pixel cap rather than taking the
  // seventy-six pixels the body leaves it, so it runs from 23 to 95.
  expect(footprintBarColumns(10, 96, NO_SCALING, 'single-column')).toEqual({
    sell: { left: 3, width: 0 },
    candle: { left: 3, width: 14 },
    buy: { left: 23, width: MAX_COLUMN_WIDTH },
  });
  // A body its two columns can still fill keeps them filling it, the sell column on the body's left edge.
  expect(footprintBarColumns(10, 96, NO_SCALING, 'two-columns').sell.left).toBe(-38);
});

test('a one-column bar of any body width keeps its candle on the bar x, a gap before its one column', () => {
  // The candle stands on the grid line the bar is drawn on rather than half a group left of it, so a bar of any body
  // width reads on the same x whichever type is chosen. The gap and the column follow it to the right.
  for (const fullWidth of [40, 96, 100, 136, 400]) {
    const columns = footprintBarColumns(10, fullWidth, NO_SCALING, 'single-column');
    // A candle of an even width lands on the bar's x exactly, and one of an odd width one device pixel at most off.
    expect(Math.abs(columns.candle.left + columns.candle.width / 2 - 10)).toBeLessThanOrEqual(1);
    expect(columns.buy.left - (columns.candle.left + columns.candle.width)).toBe(CANDLE_GAP);
    // The empty sell slot stands where the candle does, and the one column keeps its cap.
    expect(columns.sell).toEqual({ left: columns.candle.left, width: 0 });
    expect(columns.buy.width).toBeLessThanOrEqual(MAX_COLUMN_WIDTH);
  }
  // On a screen of two device pixels per css px the candle is centred on the same grid line, in device pixels, and
  // its gap widens with the screen: a thirty-pixel candle on 5, twelve pixels of background, then the one column.
  const dense = footprintBarColumns(10, 200, 2, 'single-column');
  expect(dense.candle).toEqual({ left: 5, width: 30 });
  expect(dense.candle.left + dense.candle.width / 2).toBe(20);
  expect(dense.buy.left - (dense.candle.left + dense.candle.width)).toBe(CANDLE_GAP * 2);
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

test('a very wide one-column bar caps its one column and centres its candle on the bar x', () => {
  // Four hundred css px: the sixty-pixel candle of the body is centred on the bar's own x = 10, spanning -20 to 40,
  // six pixels of background follow it, and the column is held at its seventy-two-pixel cap rather than filling the
  // 334 device pixels the body leaves it, so it runs from 46 to 118.
  const columns = footprintBarColumns(10, 400, NO_SCALING, 'single-column');
  const bodyLeft = 10 - 400 / 2;
  const bodyRight = bodyLeft + 400;

  expect(columns).toEqual({
    sell: { left: -20, width: 0 },
    candle: { left: -20, width: 60 },
    buy: { left: 46, width: MAX_COLUMN_WIDTH },
  });
  // The candle stands on the bar's x, six pixels of background follow it, and the one column is capped.
  expect(columns.candle.left).toBe(columns.sell.left);
  expect(columns.candle.left + columns.candle.width / 2).toBe(10);
  expect(columns.buy.left).toBe(columns.candle.left + columns.candle.width + CANDLE_GAP);
  expect(columns.buy.width).toBe(MAX_COLUMN_WIDTH);
  // The candle leaves the body's own left half empty behind it, and the capped column stops well inside its right
  // one, so the pair reaches right of the bar's x rather than being centred on it.
  expect(columns.candle.left - bodyLeft).toBe(170);
  expect(bodyRight - (columns.buy.left + columns.buy.width)).toBe(92);
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

test('a bar the host holds no footprint for draws its candle on the very column a footprint bar keeps', () => {
  // Forty device pixels on x = 10: the two-column bar's candle column is left 7, width 6, between its two columns, so
  // a bar with no cells to draw paints a six-pixel body centred on the bar's own x instead of the whole forty pixels.
  const twoColumns = footprintBarColumns(10, 40, NO_SCALING, 'two-columns');
  expect(footprintCandleGlyph(twoColumns.candle, NO_SCALING)).toEqual({ x: 10, width: 6 });

  // The one-column bar's candle column is left 7, width 6 — centred on the bar's own x, on the very column the
  // two-column bar keeps its candle on — so the pending bar's candle is painted on the bar's x, where the body of
  // any footprint bar stands, rather than seven pixels left of it.
  const oneColumn = footprintBarColumns(10, 40, NO_SCALING, 'single-column');
  expect(oneColumn.candle).toEqual(twoColumns.candle);
  expect(footprintCandleGlyph(oneColumn.candle, NO_SCALING)).toEqual({ x: 10, width: 6 });

  // On a screen of two device pixels per css px the body keeps the candle column's own device width — a 120-pixel
  // candle within an 800-pixel body — painted on the media x of its middle, which is still the bar's own ten css px.
  const dense = footprintBarColumns(10, 800, 2, 'two-columns');
  expect(footprintCandleGlyph(dense.candle, 2)).toEqual({ x: 10, width: 120 });
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
  const max = { ...ratios, size: FOOTPRINT_FONT_SIZE, textWidth: MEASURED_TEXT };
  // Forty device pixels are twenty css pixels wide and fifteen tall: a two-character text and its eight pixels of
  // padding fit, while a long pair of numbers needs far more room than the cell has.
  const narrow = { left: 0, width: 40, top: 0, height: 30 };
  const oneLine = TEXT_LINE_HEIGHT * ratios.verticalPixelRatio;
  const wide = { left: 0, width: 60, top: 0, height: oneLine };
  const shorter = { left: 0, width: 60, top: 0, height: oneLine - 1 };

  expect(footprintCellShowsText(narrow, narrow.width, '47', max)).toBe(true);
  expect(footprintCellShowsText(narrow, narrow.width, '400 × 1.5K', max)).toBe(false);
  // A cell exactly one line of the font tall still writes its text, while one a device pixel shorter does not.
  expect(footprintCellShowsText(wide, wide.width, '47', max)).toBe(true);
  expect(footprintCellShowsText(shorter, shorter.width, '47', max)).toBe(false);
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

/** One bar's summary, laid out under the given columns at one device pixel per media pixel, in `size` css px. */
function summaryLayoutOf(
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  showSummary: boolean,
  size = FOOTPRINT_FONT_SIZE,
) {
  const settings = { ...SUMMARY_SETTINGS, showSummary };
  return footprintSummaryLayout(footprint, columns, LOWEST_ROW_BOTTOM, settings, textStyleOf(size));
}

/** One bar's summary, laid out under the hundred-pixel bar's columns, in `size` css px. */
function summaryLayout(buyVolume: number, sellVolume: number, showSummary: boolean, size = FOOTPRINT_FONT_SIZE) {
  return summaryLayoutOf({ ...FOOTPRINT, buyVolume, sellVolume }, SUMMARY_COLUMNS, showSummary, size);
}

/** How wide one character of the owner's canvas font is at fourteen css px, in css px: a sans-serif's digits do. */
const OWNER_CHARACTER_WIDTH = 8;
/**
 * The owner's font, measured deterministically: eight css px a character, which the spec's five-px stub leaves out and
 * which is what makes the two-line block of a one-column bar's summary as wide as the owner sees it.
 */
const OWNER_FONT_TEXT: FootprintTextWidth = (text) => text.length * OWNER_CHARACTER_WIDTH;
/** The body width the owner's bars are drawn at, in css px, which leaves the capped single column seventy-two px. */
const OWNER_BODY_WIDTH = 136;
/** The columns of the owner's Delta bars: the thin candle centred on the bar x, and the one column beside it. */
const OWNER_SINGLE_COLUMN = footprintBarColumns(10, OWNER_BODY_WIDTH, NO_SCALING, 'single-column');
/** The size a bar whose rows are ten css px tall writes at, whose summary lines have to keep fitting that smaller. */
const SHORT_ROW_TEXT_SIZE = 10;

/** One bar's summary at the owner's zoom and text size, with the volumes the two sides of it traded. */
function ownerSummary(sellVolume: number, buyVolume: number, size = FOOTPRINT_FONT_SIZE) {
  const footprint = { ...FOOTPRINT, buyVolume, sellVolume };
  const style = textStyleOf(size, OWNER_FONT_TEXT);
  return footprintSummaryLayout(footprint, OWNER_SINGLE_COLUMN, LOWEST_ROW_BOTTOM, SUMMARY_SETTINGS, style);
}

/** The box a summary was laid out with, and every text it writes, which a bar with room for its summary always has. */
function summaryBoxOf(layout: FootprintSummaryLayout | null) {
  if (layout === null || layout.box === null) {
    throw new Error('a bar with room for its summary writes its box');
  }
  return { box: layout.box, texts: layout.texts };
}

/** The marks the summary box of `layout` writes, the totals under the column above it left out. */
function boxMarks(layout: FootprintSummaryLayout | null): readonly FootprintTextMark[] {
  const { box, texts } = summaryBoxOf(layout);
  return texts.filter((text) => text.y >= box.top);
}

/** The text a bar writes under its column before its box: the sell total, the separator and the buy total. */
function totalsLineText(layout: FootprintSummaryLayout | null): string {
  const { box, texts } = summaryBoxOf(layout);
  return texts
    .filter((text) => text.y < box.top)
    .map((text) => text.text)
    .join('');
}

/** The margins the block of a box's lines leaves inside it, left and right, in css px of `style`'s size. */
function boxMargins(layout: FootprintSummaryLayout | null, style: FootprintTextStyle): { left: number; right: number } {
  const { box } = summaryBoxOf(layout);
  const texts = boxMarks(layout);
  const blockLeft = Math.min(...texts.map((text) => text.x));
  const blockRight = Math.max(...texts.map((text) => text.x + footprintTextWidthAt(text.text, style)));
  return { left: blockLeft - box.left, right: box.left + box.width - blockRight };
}

/** One Delta bar the owner reported, and what its summary writes for it: its totals line and the box's two values. */
const OWNER_SUMMARY_CASES = [
  { sellVolume: 81, buyVolume: 74, totals: '81 × 74', deltaText: '−7', totalText: '155' },
  { sellVolume: 20, buyVolume: 25, totals: '20 × 25', deltaText: '5', totalText: '45' },
  { sellVolume: 40, buyVolume: 18, totals: '40 × 18', deltaText: '−22', totalText: '58' },
];

test('a bar writes each side total under its own column, against the edge nearest the candle', () => {
  // The columns span x = -40 to 60: the sell total ends eight pixels inside its own right edge, the buy total starts
  // eight pixels inside its left one, and both are written fifteen pixels under the lowest row's bottom — the middle
  // of a line that starts eight pixels below it.
  expect(summaryLayout(1000, 600, false)).toEqual({
    box: null,
    texts: [
      { x: -12, y: 215, text: '600', color: '#F23645', align: 'right', size: 14 },
      { x: 31, y: 215, text: '1K', color: '#089981', align: 'left', size: 14 },
    ],
  });
});

test('a one-column bar writes both totals in one coloured line under its own column', () => {
  // The capped single column runs from 24 to 96, so the sell, separator and buy runs — 15, 15 and 25 css px wide —
  // start at 32, 47 and 62, all written fifteen pixels under the lowest row's bottom: fifty-five pixels of text and
  // their eight pixels of padding fit the seventy-two-pixel column.
  const columns = footprintBarColumns(10, 100, NO_SCALING, 'single-column');
  const line = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 2180, sellVolume: 600 }, columns, false);
  expect(line?.texts).toEqual([
    { x: 32, y: 215, text: '600', color: '#F23645', align: 'left', size: 14 },
    { x: 47, y: 215, text: ' × ', color: '#dce4ef', align: 'left', size: 14 },
    { x: 62, y: 215, text: '2.18K', color: '#089981', align: 'left', size: 14 },
  ]);
  // Two five-character totals and their separator need sixty-five pixels, which with their padding spill past the
  // capped column, so that whole line is left out rather than written over the column's edge.
  const longer = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 2180, sellVolume: 1590 }, columns, false);
  expect(longer?.box).toBeNull();
  expect(longer?.texts).toEqual([]);
});

test('a Profile bar keeps both totals under its full columns', () => {
  const cell = footprintProfileBox({ ...SUMMARY_COLUMNS.buy, top: 0, height: 20 }, 0.3, 'buy');
  // The narrowed box has no room for the total, which is judged against the whole column and so is written all the
  // same, from its own edge nearest the candle.
  expect(footprintCellShowsText(cell, cell.width, '1K', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(false);
  expect(footprintCellShowsText(cell, SUMMARY_COLUMNS.buy.width, '1K', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(true);
  expect(summaryLayout(1000, 600, false)?.texts.map((text) => text.text)).toEqual(['600', '1K']);
});

test('a Profile cell writes a number too wide for its box while its whole column holds it', () => {
  const column = { ...SUMMARY_COLUMNS.buy, top: 0, height: TEXT_LINE_HEIGHT };
  // The cell is a tenth of its thirty-seven-pixel column, so four device px of box against the eighteen the two
  // characters and their eight px of padding need: the box cannot hold the number, the column can.
  const cell = footprintProfileBox(column, 0.1, 'buy');

  expect(cell.width).toBe(4);
  expect(footprintCellShowsText(cell, cell.width, '1K', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(false);
  expect(footprintCellShowsText(cell, column.width, '1K', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(true);
  // The number is written where it always was: against the column's edge nearest the candle, its padding in from it,
  // so it runs past the coloured part onto the background instead of moving.
  expect(footprintTextX(cell, footprintTextAlignOf('buy'), textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(31);
  // A number even the whole column cannot hold is still left out.
  expect(footprintCellShowsText(cell, column.width, '600 × 2.18K', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(false);
});

/** The box's two lines for the fixture's 400 delta and 1.6K total: the block centred on -15.5 in both boxes these tests lay out. */
const FIXTURE_BOX_LINES = [
  { x: -15.5, y: 248, text: 'Delta', color: '#089981', align: 'left', size: 14 },
  { x: 15.5, y: 248, text: '400', color: '#089981', align: 'left', bold: true, size: 14 },
  { x: -15.5, y: 268, text: 'Total', color: '#dce4ef', align: 'left', size: 14 },
  { x: 15.5, y: 268, text: '1.6K', color: '#dce4ef', align: 'left', bold: true, size: 14 },
];

test('the summary box spans the bar columns below the totals, with the delta and the total inside it', () => {
  // The bar's columns span -40 to 60, so the box is the hundred pixels between them. Ten pixels under the totals it
  // starts, fifty-two pixels tall with its six pixels of padding, and its two twenty-pixel lines are written sixteen
  // and thirty-six pixels into it. Both lines make one block — the thirty-one-pixel label column, the wider label plus
  // six pixels, and the twenty-pixel '1.6K' after it, so fifty-one pixels wide — which the box centres: it starts
  // -15.5, twenty-four and a half pixels in from the box's left edge and as far from its right one. A label stands on
  // the block's left edge and its value right after the label column, on 15.5.
  expect(summaryLayout(1000, 600, true)).toEqual({
    box: { left: -40, top: 232, width: 100, height: 52, radius: 6 },
    texts: [
      { x: -12, y: 215, text: '600', color: '#F23645', align: 'right', size: 14 },
      { x: 31, y: 215, text: '1K', color: '#089981', align: 'left', size: 14 },
      ...FIXTURE_BOX_LINES,
    ],
  });
});

test('the summary box centres its two lines, leaving them the same room either side', () => {
  // The block is fifty-one css px wide inside a hundred-pixel box, so it stands twenty-four and a half pixels in from
  // either edge: the left margin the leftmost text leaves and the right margin the rightmost text leaves are equal.
  const layout = summaryLayout(1000, 600, true);
  const margins = boxMargins(layout, textStyleOf(FOOTPRINT_FONT_SIZE));

  expect(boxMarks(layout)).toHaveLength(4);
  expect(margins.left).toBeCloseTo(24.5, 5);
  expect(margins.right).toBeCloseTo(24.5, 5);
  expect(Math.abs(margins.left - margins.right)).toBeLessThanOrEqual(1);
  // Centred or not, the block never leaves the box.
  expect(margins.left).toBeGreaterThan(0);
  expect(margins.right).toBeGreaterThan(0);
});

test('a one-column bar spans its summary box over its own column, leaving the empty sell slot out', () => {
  const columns = footprintBarColumns(10, 100, NO_SCALING, 'single-column');
  const layout = summaryLayoutOf(FOOTPRINT, columns, true);

  // The capped single column runs from 24 to 96: the box starts on that column's left edge and is exactly as wide
  // as it, rather than reaching back over the thin candle and its gap to the empty sell slot.
  expect(layout?.box?.left).toBe(columns.buy.left);
  expect(layout?.box?.width).toBe(columns.buy.width);
  expect(layout?.box).toEqual({ left: 24, top: 232, width: 72, height: 52, radius: 6 });
});

test('a one-column bar at the owner size writes both of its summary lines, centred in its box', () => {
  // The owner's Delta bars: rows of a hundred and ninety css px write at fourteen, and the capped single column is
  // seventy-two px wide, so the box is that column and its two lines of text have to share it. Both lines are
  // written, their labels on one x and their values on another, and the block they make is centred in the box.
  const style = textStyleOf(FOOTPRINT_FONT_SIZE, OWNER_FONT_TEXT);

  for (const { sellVolume, buyVolume, totals, deltaText, totalText } of OWNER_SUMMARY_CASES) {
    const layout = ownerSummary(sellVolume, buyVolume);
    const marks = boxMarks(layout);
    expect(totalsLineText(layout)).toBe(totals);
    expect(marks.map((text) => text.text)).toEqual(['Delta', deltaText, 'Total', totalText]);
    expect(marks[0].x).toBe(marks[2].x);
    expect(marks[1].x).toBe(marks[3].x);
    const margins = boxMargins(layout, style);
    expect(margins.left).toBeCloseTo(margins.right, 5);
    expect(margins.left).toBeGreaterThanOrEqual(0);
  }
});

test('a one-column bar writing at ten px still keeps both summary lines, its scaled sizes leaving them room', () => {
  // A bar of ten-css-px rows writes its summary at ten: the labels, the gaps, the padding and the box itself scale
  // with that size, so the two lines keep fitting the column the box spans.
  const style = textStyleOf(SHORT_ROW_TEXT_SIZE, OWNER_FONT_TEXT);
  const layout = ownerSummary(81, 74, SHORT_ROW_TEXT_SIZE);
  const marks = boxMarks(layout);

  expect(marks.map((text) => text.text)).toEqual(['Delta', '−7', 'Total', '155']);
  expect(marks.every((text) => text.size === SHORT_ROW_TEXT_SIZE)).toBe(true);
  const margins = boxMargins(layout, style);
  expect(margins.left).toBeCloseTo(margins.right, 5);
});

test('a one-column box keeps only the summary line it has room for, and centres the one it keeps', () => {
  // The bar traded 400 lots on its sell side and 1220 on its buy one: its delta '820' fits the box, while the total
  // '1.62K' is wider than the whole column. The delta line is written alone, and the block it makes on its own is
  // centred in the box rather than standing where the two-line block would have started.
  const style = textStyleOf(FOOTPRINT_FONT_SIZE, OWNER_FONT_TEXT);
  const layout = ownerSummary(400, 1220);
  const marks = boxMarks(layout);

  expect(marks.map((text) => text.text)).toEqual(['Delta', '820']);
  const margins = boxMargins(layout, style);
  expect(margins.left).toBeCloseTo(margins.right, 5);
  expect(margins.left).toBeGreaterThan(0);
});

test('a very wide bar spans its summary box over the capped group, not the whole body', () => {
  const columns = footprintBarColumns(10, 400, NO_SCALING, 'two-columns');
  const layout = summaryLayoutOf({ ...FOOTPRINT, buyVolume: 1000, sellVolume: 600 }, columns, true);

  // The box is the 216 device pixels of the capped group rather than the 400 of the body, and each total stands
  // inside its own capped column: eight pixels in from the sell column's right edge on -26, and eight pixels in
  // from the buy column's left one on 46.
  expect(layout?.box).toEqual({ left: -98, top: 232, width: 216, height: 52, radius: 6 });
  expect(layout?.texts.slice(0, 2)).toEqual([
    { x: -34, y: 215, text: '600', color: '#F23645', align: 'right', size: 14 },
    { x: 54, y: 215, text: '1K', color: '#089981', align: 'left', size: 14 },
  ]);
});

test('the totals and the summary lines are written at the size their own bar holds', () => {
  // A bar of ten-px rows writes everything under its columns at ten px: each total keeps 8 × 10/14 = 5.71 px of its
  // padding, its line is a line of ten px 8 × 10/14 = 5.71 px under the lowest row, and the box takes the scaled
  // gaps, line height, padding and radius: it starts 200 + (8 + 14 + 10) × 10/14 = 222.86, rounded to 223 px, is
  // (2 × 20 + 2 × 6) × 10/14 = 37.14, rounded to 37 px, tall, with a 6 × 10/14 = 4.29, rounded to 4, px radius.
  const layout = summaryLayout(1000, 600, true, 10);
  if (layout === null || layout.box === null) {
    throw new Error('a ten-pixel bar writes its summary box');
  }

  // Every text the bar writes — both totals and the box's four lines — is written at the bar's own size.
  expect(layout.texts.map((text) => text.size)).toEqual([10, 10, 10, 10, 10, 10]);
  // The totals stand a line of ten px and 5.71 px of padding in from their own columns' edges: the sell column ends
  // on -4 and the buy one starts on 23.
  expect(layout.texts[0].x).toBeCloseTo(-9.714286, 5);
  expect(layout.texts[1].x).toBeCloseTo(28.714286, 5);
  expect(layout.texts[0].y).toBeCloseTo(210.714286, 5);
  expect(layout.box).toEqual({ left: -40, top: 223, width: 100, height: 37, radius: 4 });
  // The box's two lines sit 20 × 10/14 = 14.29 px apart, the first one 6 × 10/14 = 4.29 px and half a line inside it.
  expect(layout.texts[2].y).toBeCloseTo(234.428571, 5);
  expect(layout.texts[4].y).toBeCloseTo(248.714286, 5);
});

test('a summary box with no line that fits it is left off rather than drawn empty', () => {
  // Six css px a character: the sixty-px box of the narrowest bar that writes a summary cannot hold a line of its
  // thirty-six-px label column and a value — the delta '−10.5K' needs thirty-six more px for it and the total '12.5K'
  // thirty. No line fits, so no box is drawn — not even an empty one — while the buy total still fits its own
  // twenty-px column.
  const sixPerCharacter: FootprintTextWidth = (text) => text.length * 6;
  const columns = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH, NO_SCALING, 'two-columns');
  const wideStyle = textStyleOf(FOOTPRINT_FONT_SIZE, sixPerCharacter);
  const traded = { ...FOOTPRINT, sellVolume: 11_500 };

  expect(footprintSummaryLayout(traded, columns, LOWEST_ROW_BOTTOM, SUMMARY_SETTINGS, wideStyle)).toEqual({
    box: null,
    texts: [{ x: 28, y: 215, text: '1K', color: '#089981', align: 'left', size: 14 }],
  });
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
  // more than its column has, so only the buy total is written. The box is sixty pixels wide, and both of its lines
  // fit that width — forty-six and fifty-one pixels of label column and value — so the block they make, fifty-one
  // pixels wide, is centred in it: it starts -15.5, four and a half pixels in from the box's left edge.
  const columns = footprintBarColumns(10, MIN_SUMMARY_BAR_WIDTH, NO_SCALING, 'two-columns');
  const sellColumn = { ...columns.sell, top: 0, height: TEXT_LINE_HEIGHT };

  expect(footprintCellShowsText(sellColumn, sellColumn.width, '600', textStyleOf(FOOTPRINT_FONT_SIZE))).toBe(false);
  expect(summaryLayoutOf(FOOTPRINT, columns, true)).toEqual({
    box: { left: -20, top: 232, width: 60, height: 52, radius: 6 },
    texts: [{ x: 28, y: 215, text: '1K', color: '#089981', align: 'left', size: 14 }, ...FIXTURE_BOX_LINES],
  });
});

test('an imbalance mark stands in the candle gap, one css px in from the inner edge of its column', () => {
  // The hundred-pixel bar's columns span -40 to 60: a thirty-six-pixel sell column, six css px of background, the
  // fifteen-pixel candle, another six and the thirty-seven-pixel buy column, so either mark has a gap six px wide to
  // stand in. A cell between the prices of its row, less the row gap under it, is four device pixels tall here.
  const columns = SUMMARY_COLUMNS;
  const cells = {
    sell: footprintCellBox(columns.sell, 10, 14, 2),
    buy: footprintCellBox(columns.buy, 10, 14, 2),
  };
  const sellMark = footprintImbalanceBox(cells.sell, 'sell', footprintInnerGap(columns, 'sell'), NO_SCALING);
  const buyMark = footprintImbalanceBox(cells.buy, 'buy', footprintInnerGap(columns, 'buy'), NO_SCALING);

  expect(IMBALANCE_MARK_WIDTH).toBe(3);
  expect(IMBALANCE_MARK_SPACE).toBe(1);
  expect(footprintInnerGap(columns, 'sell')).toBe(CANDLE_GAP);
  expect(footprintInnerGap(columns, 'buy')).toBe(CANDLE_GAP);
  expect(cells.sell).toEqual({ left: -40, width: 36, top: 20, height: 4 });
  expect(cells.buy).toEqual({ left: 23, width: 37, top: 20, height: 4 });
  // The sell column ends on -4, so its mark stands one css px right of it, and the buy column starts on 23, so its
  // mark stands the same css px left of that: neither takes the cell's outer edge any more.
  expect(sellMark).toEqual({ left: -3, top: 20, width: 3, height: 4 });
  expect(buyMark).toEqual({ left: 19, top: 20, width: 3, height: 4 });
  expect(sellMark.left - (cells.sell.left + cells.sell.width)).toBe(IMBALANCE_MARK_SPACE);
  expect(cells.buy.left - (buyMark.left + buyMark.width)).toBe(IMBALANCE_MARK_SPACE);
  // Both marks stop short of the thin candle the gap belongs to rather than standing over it.
  expect(sellMark.left + sellMark.width).toBeLessThan(columns.candle.left);
  expect(buyMark.left).toBeGreaterThan(columns.candle.left + columns.candle.width - 1);
  // A mark is exactly as tall as the cell it marks, so it never runs on over the gap under it: its top and its bottom
  // edge are the cell's own.
  for (const side of FOOTPRINT_SIDES) {
    const mark = footprintImbalanceBox(cells[side], side, footprintInnerGap(columns, side), NO_SCALING);
    expect(mark.top).toBe(cells[side].top);
    expect(mark.top + mark.height).toBe(cells[side].top + cells[side].height);
  }
  // Two device pixels per css px double the mark and its css px of space, so it reads the same on a dense screen: the
  // same hundred css px body is two hundred device pixels wide and leaves twelve px of gap either side of its candle.
  const dense = footprintBarColumns(10, 200, 2, 'two-columns');
  const denseCell = footprintCellBox(dense.sell, 10, 14, 2);
  expect(footprintInnerGap(dense, 'sell')).toBe(CANDLE_GAP * 2);
  expect(footprintImbalanceBox(denseCell, 'sell', footprintInnerGap(dense, 'sell'), 2)).toEqual({
    left: -5,
    top: 20,
    width: 6,
    height: 4,
  });
});

test('a one-column bar marks its imbalanced cells in the gap between the candle and its one column', () => {
  // The hundred-pixel body's one-column layout: the fifteen-pixel candle centred on the bar's x, spanning 3 to 17, six
  // css px of background after it, and the seventy-two-pixel capped column from 24 to 96. The one column is a buy
  // column, so its marks stand in the gap the candle leaves before it.
  const columns = footprintBarColumns(10, 100, NO_SCALING, 'single-column');
  const cell = footprintCellBox(columns.buy, 10, 14, 2);
  const mark = footprintImbalanceBox(cell, 'buy', footprintInnerGap(columns, 'buy'), NO_SCALING);

  expect(columns.buy).toEqual({ left: 24, width: MAX_COLUMN_WIDTH });
  expect(cell).toEqual({ left: 24, width: MAX_COLUMN_WIDTH, top: 20, height: 4 });
  // Three css px wide, one css px left of the column, and clear of the candle's last pixel on 17.
  expect(mark).toEqual({ left: 20, top: 20, width: 3, height: 4 });
  expect(columns.buy.left - (mark.left + mark.width)).toBe(IMBALANCE_MARK_SPACE);
  expect(mark.left).toBeGreaterThan(columns.candle.left + columns.candle.width - 1);
});

test('a mark the candle gap cannot hold shrinks to what fits, and never below one device pixel', () => {
  // A twelve-pixel body is laid out with a two-pixel candle, two px of background either side of it and a three-pixel
  // column on each side, so the gap holds neither the three-pixel mark nor its css px of space.
  const columns = footprintBarColumns(10, 12, NO_SCALING, 'two-columns');
  const cell = footprintCellBox(columns.buy, 10, 14, 2);
  const gap = footprintInnerGap(columns, 'buy');

  expect(columns).toEqual({
    sell: { left: 4, width: 3 },
    candle: { left: 9, width: 2 },
    buy: { left: 13, width: 3 },
  });
  expect(gap).toBe(2);
  // Two device pixels hold the mark's own css px of space and one pixel of mark, which is what it is drawn at.
  const mark = footprintImbalanceBox(cell, 'buy', gap, NO_SCALING);

  expect(mark).toEqual({ left: 11, top: 20, width: 1, height: 4 });
  expect(cell.left - (mark.left + mark.width)).toBe(IMBALANCE_MARK_SPACE);
  // The shrunken mark fills the gap exactly, its far edge on the candle's own first pixel rather than over it.
  expect(mark.left).toBe(columns.candle.left + columns.candle.width);
  // A gap holding the mark and its space exactly leaves the mark at its full width, and a narrower one still keeps the
  // one device pixel a mark is never drawn under.
  expect(footprintImbalanceBox(cell, 'buy', IMBALANCE_MARK_WIDTH + IMBALANCE_MARK_SPACE, NO_SCALING).width).toBe(3);
  expect(footprintImbalanceBox(cell, 'buy', 0, NO_SCALING).width).toBe(1);
});

test('a profile cell is marked in the very gap a cluster cell is, its column holding the mark', () => {
  // A profile cell keeps half of its column on the edge nearest the candle: the sell cell's coloured part starts on
  // -22 while its column starts on -40, so a mark that followed the cell's own edges would move away from the candle.
  const columns = SUMMARY_COLUMNS;
  const gap = footprintInnerGap(columns, 'sell');
  const cluster = footprintCellBox(columns.sell, 10, 14, 2);
  const profile = footprintProfileBox(cluster, 0.5, 'sell');

  expect(profile).toEqual({ left: -22, width: 18, top: 20, height: 4 });
  // The profile bar is anchored on the column's inner edge, so its mark stands where the cluster cell's does: in the
  // candle gap, one css px right of the column that holds both of them.
  expect(footprintImbalanceBox(profile, 'sell', gap, NO_SCALING)).toEqual(
    footprintImbalanceBox(cluster, 'sell', gap, NO_SCALING),
  );
  expect(footprintImbalanceBox(profile, 'sell', gap, NO_SCALING)).toEqual({ left: -3, top: 20, width: 3, height: 4 });
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
