import { expect, test } from '@playwright/test';
import {
  footprintCellNumberColor,
  footprintCells,
  type FootprintCellSettings,
  type FootprintRowCells,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintCells';
import {
  FOOTPRINT_DEFAULT_BUY_SHADES,
  FOOTPRINT_DEFAULT_SELL_SHADES,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintDefaults';
import { footprintProfileBox } from '../src/features/chart/engine/barStyle/volumeFootprint/footprintGeometry';
import {
  FOOTPRINT_NEUTRAL_COLOR,
  FOOTPRINT_NEUTRAL_TEXT_COLOR,
  FOOTPRINT_POC_COLOR,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintShades';
import {
  FOOTPRINT_FONT_SIZE,
  footprintCellShowsText,
  type FootprintTextStyle,
  type FootprintTextWidth,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintTextSize';
import type {
  BarFootprint,
  ChartFootprintRow,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintData';

/**
 * What each footprint type makes of one bar's rows: the number every cell writes, the shade it is graded to, the
 * colour that number is written in, the imbalance marks on its edges and, in Profile, the share of its column it
 * fills. The bar holds three rows, so every band and every share below is hand-computed from those rows.
 */

/** The four values each side of a row carries: the volume it traded and the trades behind it. */
type RowSides = Pick<ChartFootprintRow, 'buyVolume' | 'sellVolume' | 'buyTrades' | 'sellTrades'>;

/** The light text colour every number written on a sell or buy shade takes, whatever band that shade is. */
const LIGHT_TEXT_COLOR = '#ffffff';
/** The dark text colour a number keeps on the white fill a bar's point of control row is drawn in. */
const DARK_TEXT_COLOR = '#0b0e14';
/** How wide the spec's text is in css px: five pixels a character, which a stub measures without any canvas. */
const MEASURED_TEXT: FootprintTextWidth = (text) => text.length * 5;
/** The text style the cells' numbers are fitted to their boxes with, at one device pixel per css px. */
const CELL_TEXT_STYLE: FootprintTextStyle = {
  size: FOOTPRINT_FONT_SIZE,
  textWidth: MEASURED_TEXT,
  horizontalPixelRatio: 1,
  verticalPixelRatio: 1,
};
/** The box of one column a cell is drawn in, in device pixels: seventy-two wide, one twenty-px row tall. */
const CELL_COLUMN = { left: 0, width: 72, top: 0, height: 20 };

/** One row of the fixture: its number, the prices it spans and what each side of it took. */
function row(rowNumber: number, downPrice: number, upPrice: number, sides: RowSides): ChartFootprintRow {
  return { row: rowNumber, downPrice, upPrice, ...sides, buyImbalance: false, sellImbalance: false };
}

/**
 * The bar every test draws: its lowest row traded 600 buy against 200 sell, its middle one 100 each way, its top one
 * 300 buy against 500 sell. Its trades are counted on their own, so the row busiest by trades is the top one while
 * the row the host calls the point of control is the lowest.
 */
const ROWS: readonly ChartFootprintRow[] = [
  row(0, 1.1, 1.11, { buyVolume: 600, sellVolume: 200, buyTrades: 5, sellTrades: 5 }),
  { ...row(1, 1.11, 1.12, { buyVolume: 100, sellVolume: 100, buyTrades: 15, sellTrades: 5 }), sellImbalance: true },
  { ...row(2, 1.12, 1.13, { buyVolume: 300, sellVolume: 500, buyTrades: 30, sellTrades: 30 }), buyImbalance: true },
];

const FOOTPRINT: BarFootprint = {
  openMs: 0,
  rows: [...ROWS],
  buyVolume: 1000,
  sellVolume: 800,
  buyTrades: 50,
  sellTrades: 40,
  poc: 0,
  vah: 2,
  val: 0,
  volume: 'real',
};

/** The settings every test starts on: Buy and Sell cells, clustered, of volume, with no row highlighted. */
const SETTINGS: FootprintCellSettings = {
  type: 'buySell',
  display: 'cluster',
  values: 'volume',
  gradient: true,
  sellShades: FOOTPRINT_DEFAULT_SELL_SHADES,
  buyShades: FOOTPRINT_DEFAULT_BUY_SHADES,
  poc: { visible: false, color: FOOTPRINT_POC_COLOR },
};

/** The view's settings with a few of them changed. */
function settingsWith(changes: Partial<FootprintCellSettings>): FootprintCellSettings {
  return { ...SETTINGS, ...changes };
}

/**
 * The bar whose point of control traded both sides alike: its lowest row carries the volume and no delta at all, so
 * in Profile the highlighted row's cell fills none of its column.
 */
const BALANCED_POC_FOOTPRINT: BarFootprint = {
  ...FOOTPRINT,
  rows: [{ ...ROWS[0], buyVolume: 300, sellVolume: 300 }, ROWS[1], ROWS[2]],
};

/** One row's cells as a painter sees them: the column, the number and the fill of each, in one line per cell. */
function paintedCells(rows: readonly FootprintRowCells[]): string[][] {
  return rows.map(({ cells }) => cells.map((cell) => `${cell.column} ${cell.text} ${cell.fill}`));
}

test('Buy and Sell draws both sides of every row, each graded in its own side shades', () => {
  // The sell values 200, 100 and 500 span 100..500: 200 is a quarter of the way, band 2, the quietest is band 1 and
  // the busiest band 4. The buy values 600, 100 and 300 span 100..600: the busiest is band 4, the quietest band 1 and
  // 300, 0.4 of the way, band 2.
  expect(paintedCells(footprintCells(FOOTPRINT, SETTINGS))).toEqual([
    ['sell 200 #f7525f', 'buy 600 #004d40'],
    ['sell 100 #ff99a0', 'buy 100 #5cc4b4'],
    ['sell 500 #801922', 'buy 300 #089981'],
  ]);
});

test('a cell carries only the imbalance mark of a side the host called imbalanced', () => {
  const marked = footprintCells(FOOTPRINT, SETTINGS).map(({ cells }) => cells.map((cell) => cell.marks.join(' ')));

  expect(marked).toEqual([
    ['', ''],
    ['sell', ''],
    ['', 'buy'],
  ]);
});

test("Bid × Ask writes each row's bid left of the candle and its ask right of it, both in the row's one shade", () => {
  // The largest level is 600, the lowest row's buy side: that row is all of it, band 4; 100 of 600 is 0.17, band 1;
  // 500 of 600 is 0.83, band 4. The sell shades take a level the sell side won, or one both sides shared, and the buy
  // shades the rest, so both cells of a row take the one shade of that row's larger side.
  expect(paintedCells(footprintCells(FOOTPRINT, settingsWith({ type: 'bidAsk' })))).toEqual([
    ['sell 200 #004d40', 'buy 600 #004d40'],
    ['sell 100 #ff99a0', 'buy 100 #ff99a0'],
    ['sell 500 #801922', 'buy 300 #801922'],
  ]);
});

test("Bid × Ask stands each side's imbalance mark on its own cell", () => {
  const rows = footprintCells(FOOTPRINT, settingsWith({ type: 'bidAsk' }));
  const marked = rows.map(({ cells }) => cells.map((cell) => cell.marks));

  expect(marked).toEqual([
    [[], []],
    [['sell'], []],
    [[], ['buy']],
  ]);
});

test('Delta writes each row signed difference, shaded by its distance from zero', () => {
  // The deltas are +400, 0 and -200: 400 of the largest 400 is band 4 of the buy shades, zero is neutral, and 200 of
  // 400 is band 3 of the sell shades.
  expect(paintedCells(footprintCells(FOOTPRINT, settingsWith({ type: 'delta' })))).toEqual([
    ['buy 400 #004d40'],
    [`buy 0 ${FOOTPRINT_NEUTRAL_COLOR}`],
    ['buy −200 #cc2f3c'],
  ]);
});

test('Total writes what each row traded in all, in the buy shades graded by the bar largest total', () => {
  // The totals are 800, 200 and 800: the largest is band 4 and 200, a quarter of it, is band 2.
  expect(paintedCells(footprintCells(FOOTPRINT, settingsWith({ type: 'total' })))).toEqual([
    ['buy 800 #004d40'],
    ['buy 200 #089981'],
    ['buy 800 #004d40'],
  ]);
});

test('Ladder shades only the larger side of every level and leaves the smaller one neutral', () => {
  expect(paintedCells(footprintCells(FOOTPRINT, settingsWith({ type: 'ladder' })))).toEqual([
    [`sell 200 ${FOOTPRINT_NEUTRAL_COLOR}`, 'buy 600 #004d40'],
    [`sell 100 ${FOOTPRINT_NEUTRAL_COLOR}`, `buy 100 ${FOOTPRINT_NEUTRAL_COLOR}`],
    ['sell 500 #801922', `buy 300 ${FOOTPRINT_NEUTRAL_COLOR}`],
  ]);
});

test('Cluster fills the whole column, while Profile widens each cell to its share of the column largest', () => {
  const profile = footprintCells(FOOTPRINT, settingsWith({ display: 'profile' }));

  // The sell column is as wide as 500 and the buy one as wide as 600: 200/500 = 0.4, 100/500 = 0.2 and 500/500 = 1
  // on the sell side, then 600/600 = 1, 100/600 and 300/600 = 0.5 on the buy side.
  expect(profile.map(({ cells }) => cells.map((cell) => cell.widthShare))).toEqual([
    [0.4, 1],
    [0.2, 100 / 600],
    [1, 0.5],
  ]);
  expect(footprintCells(FOOTPRINT, SETTINGS).map(({ cells }) => cells.map((cell) => cell.widthShare))).toEqual([
    [1, 1],
    [1, 1],
    [1, 1],
  ]);
});

test('Profile widens the single column of the total type by the bar largest total', () => {
  const cells = footprintCells(FOOTPRINT, settingsWith({ type: 'total', display: 'profile' }));

  // The totals 800, 200 and 800 against the largest 800: the whole column, a quarter of it, the whole column.
  expect(cells.map(({ cells: painted }) => painted[0].widthShare)).toEqual([1, 0.25, 1]);
});

test('Trade count writes and grades the cells by the trades behind the volume', () => {
  // The trades are 5 sell against 5 buy, 5 against 15 and 30 against 30: the sell side spans 5..30, so its quiet rows
  // are band 1 and its busiest band 4, while the buy side runs band 1, then 0.4 of the way as band 2, then band 4.
  expect(paintedCells(footprintCells(FOOTPRINT, settingsWith({ values: 'tradeCount' })))).toEqual([
    ['sell 5 #ff99a0', 'buy 5 #5cc4b4'],
    ['sell 5 #ff99a0', 'buy 15 #089981'],
    ['sell 30 #801922', 'buy 30 #004d40'],
  ]);
});

test('Trade count leaves the delta of the trade counts neutral where both sides traded alike', () => {
  // The trades' deltas are 0, +10 and 0: only the middle row points anywhere, at the whole of the largest 10.
  expect(paintedCells(footprintCells(FOOTPRINT, settingsWith({ values: 'tradeCount', type: 'delta' })))).toEqual([
    [`buy 0 ${FOOTPRINT_NEUTRAL_COLOR}`],
    ['buy 10 #004d40'],
    [`buy 0 ${FOOTPRINT_NEUTRAL_COLOR}`],
  ]);
});

test('counting volume highlights the host point of control, counting trades the busiest row', () => {
  const highlight = { visible: true, color: FOOTPRINT_POC_COLOR };
  const litRows = (rows: readonly FootprintRowCells[]) =>
    rows.map(({ cells }) => cells.every((cell) => cell.fill === FOOTPRINT_POC_COLOR));

  // The host calls the lowest row the point of control, while the row the bar traded most in is the top one.
  expect(litRows(footprintCells(FOOTPRINT, settingsWith({ poc: highlight })))).toEqual([true, false, false]);
  expect(litRows(footprintCells(FOOTPRINT, settingsWith({ poc: highlight, values: 'tradeCount' })))).toEqual([
    false,
    false,
    true,
  ]);
});

test('every number on a sell or buy shade is the light text colour, whatever band that shade is', () => {
  const rows = footprintCells(FOOTPRINT, SETTINGS);

  // Both lightest cells of the bar are band 1 of their side's ramp — the quietest row's two sides — which is where
  // dark text used to be written: on them, and on the darker bands, every number is now light.
  expect(rows[1].cells.map((cell) => cell.fill)).toEqual(['#ff99a0', '#5cc4b4']);
  expect(rows[1].cells.map((cell) => cell.textColor)).toEqual([LIGHT_TEXT_COLOR, LIGHT_TEXT_COLOR]);
  expect(rows.map(({ cells }) => cells.map((cell) => cell.textColor))).toEqual([
    [LIGHT_TEXT_COLOR, LIGHT_TEXT_COLOR],
    [LIGHT_TEXT_COLOR, LIGHT_TEXT_COLOR],
    [LIGHT_TEXT_COLOR, LIGHT_TEXT_COLOR],
  ]);
  // The cells of the other types take the same colour in every band, and only a cell of no side keeps its neutral
  // fill's own contrast: the zero delta of the middle row is written in the neutral text colour.
  const deltas = footprintCells(FOOTPRINT, settingsWith({ type: 'delta' }));
  expect(deltas.map(({ cells }) => cells.map((cell) => cell.fill))).toEqual([
    ['#004d40'],
    [FOOTPRINT_NEUTRAL_COLOR],
    ['#cc2f3c'],
  ]);
  expect(deltas.map(({ cells }) => cells.map((cell) => cell.textColor))).toEqual([
    [LIGHT_TEXT_COLOR],
    [FOOTPRINT_NEUTRAL_TEXT_COLOR],
    [LIGHT_TEXT_COLOR],
  ]);
});

test('the point of control row keeps its dark numbers on the white fill it is drawn in', () => {
  const highlight = { visible: true, color: FOOTPRINT_POC_COLOR };
  const rows = footprintCells(FOOTPRINT, settingsWith({ poc: highlight }));

  // The host calls the lowest row the point of control: both of its cells are white and keep the dark text a light
  // fill takes, while every other row still writes its numbers on a side shade, in the light colour.
  expect(rows[0].cells.map((cell) => cell.fill)).toEqual([FOOTPRINT_POC_COLOR, FOOTPRINT_POC_COLOR]);
  expect(rows[0].cells.map((cell) => cell.textColor)).toEqual([DARK_TEXT_COLOR, DARK_TEXT_COLOR]);
  expect(rows[2].cells.map((cell) => cell.textColor)).toEqual([LIGHT_TEXT_COLOR, LIGHT_TEXT_COLOR]);
});

test('a number that runs past its own box is written light, while one inside its box keeps its fill colour', () => {
  const highlight = { visible: true, color: FOOTPRINT_POC_COLOR };
  // In Cluster a cell's box is its whole column, so the point of control's white fill holds the number and the dark
  // text that fill gives it stays.
  const clustered = footprintCells(FOOTPRINT, settingsWith({ type: 'delta', poc: highlight }))[0].cells[0];
  const clusteredBox = footprintProfileBox(CELL_COLUMN, clustered.widthShare, 'buy');
  expect(clustered.textColor).toBe(DARK_TEXT_COLOR);
  expect(footprintCellNumberColor(clustered, clusteredBox, CELL_TEXT_STYLE)).toBe(DARK_TEXT_COLOR);

  // In Profile that same cell fills only its share of the column, and a delta that points nowhere fills none of it:
  // its box is one device px wide, so its number is written over the chart's dark background — while the whole column
  // still holds it — and takes the light text colour rather than the dark one of its own fill.
  const profile = settingsWith({ type: 'delta', display: 'profile', poc: highlight });
  const profiled = footprintCells(BALANCED_POC_FOOTPRINT, profile)[0].cells[0];
  const profiledBox = footprintProfileBox(CELL_COLUMN, profiled.widthShare, 'buy');

  expect(profiled.widthShare).toBe(0);
  expect(profiledBox.width).toBe(1);
  expect(profiled.textColor).toBe(DARK_TEXT_COLOR);
  expect(footprintCellShowsText(profiledBox, CELL_COLUMN.width, profiled.text, CELL_TEXT_STYLE)).toBe(true);
  expect(footprintCellNumberColor(profiled, profiledBox, CELL_TEXT_STYLE)).toBe(LIGHT_TEXT_COLOR);
});

test('the shades a cell takes come from the settings, so an edited ramp repaints the bar', () => {
  const repainted = footprintCells(
    FOOTPRINT,
    settingsWith({ type: 'total', buyShades: ['#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd'] }),
  );

  // The totals are 800, 200 and 800: the darkest shade for the largest, the second for the quarter.
  expect(repainted.map(({ cells }) => cells[0].fill)).toEqual(['#dddddd', '#bbbbbb', '#dddddd']);
});
