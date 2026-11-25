import type { ToggledColor } from '../barStyleAppearance';
import type { BarFootprint, ChartFootprintRow } from './footprintData';
import { SINGLE_COLUMN_SIDE } from './footprintGeometry';
import type { FootprintDisplay, FootprintType, FootprintValues } from './footprintModes';
import {
  FOOTPRINT_NEUTRAL_COLOR,
  FOOTPRINT_NEUTRAL_TEXT_COLOR,
  FOOTPRINT_SIDES,
  footprintCellBand,
  footprintRangeFromZero,
  footprintShadeColor,
  footprintTextColor,
  footprintTextOn,
  type FootprintBand,
  type FootprintSide,
  type FootprintVolumeRange,
} from './footprintShades';
import {
  footprintLargestValue,
  footprintRowDelta,
  footprintRowTotal,
  footprintSideRange,
  footprintSideValue,
} from './footprintValues';
import { footprintSignedText, footprintVolumeText } from './footprintVolumeText';

/** The share of its column a cell fills while the bar draws its cells in clusters. */
const FULL_WIDTH_SHARE = 1;

/** One cell of a footprint bar as the painter draws it. */
export interface FootprintCell {
  /** The column the cell is painted in, which is also the side whose imbalance mark stands on its edge. */
  readonly column: FootprintSide;
  /** The number the cell writes, in the units the values mode counts: a delta keeps its sign. */
  readonly value: number;
  readonly text: string;
  readonly fill: string;
  readonly textColor: string;
  /** The share of its column the cell fills: the whole column in Cluster, its share of the column's largest in Profile. */
  readonly widthShare: number;
  /** The sides whose imbalance marks stand on the cell's edges. */
  readonly marks: readonly FootprintSide[];
}

/** One row of a footprint bar as the painter draws it: the row's prices and the cells it fills. */
export interface FootprintRowCells {
  readonly row: ChartFootprintRow;
  readonly cells: readonly FootprintCell[];
}

/** One bar's rows as the painter draws them, lowest price first. */
export type FootprintCells = readonly FootprintRowCells[];

/** The settings drawing a bar's cells reads, which the footprint series' own options satisfy. */
export interface FootprintCellSettings {
  readonly type: FootprintType;
  readonly display: FootprintDisplay;
  readonly values: FootprintValues;
  readonly gradient: boolean;
  readonly sellShades: readonly string[];
  readonly buyShades: readonly string[];
  readonly poc: ToggledColor;
}

/** The sizes one bar's cells are graded and scaled against, in the units the values mode counts. */
interface FootprintBarSizes {
  readonly sell: FootprintVolumeRange;
  readonly buy: FootprintVolumeRange;
  /** The largest value one level holds either way, which both cells of a bid-ask level are shaded up from. */
  readonly level: FootprintVolumeRange;
  /** The largest distance a level's delta sits from zero, which a delta cell's shade spans from nothing up to. */
  readonly delta: FootprintVolumeRange;
  /** The largest value a level traded in all, which a total cell's shade spans from nothing up to. */
  readonly total: FootprintVolumeRange;
}

/** How a cell's fill is chosen: from a side's ramp of shades, or the neutral colour when it has no side to shade. */
type CellShade = FootprintSide | 'neutral';

/** One cell before its shade, its text colour and its width are read off the bar's own values. */
interface CellDraft {
  readonly column: FootprintSide;
  readonly value: number;
  /** The size the cell is drawn as wide as in Profile: the value itself, but a delta's distance from zero. */
  readonly magnitude: number;
  readonly text: string;
  readonly marks: readonly FootprintSide[];
  readonly shade: CellShade;
  readonly band: FootprintBand;
}

/** One row's cells, before the bar's largest values and the row it highlights are known. */
interface RowDrafts {
  readonly row: ChartFootprintRow;
  readonly cells: readonly CellDraft[];
}

/** The fields a side's cell builder supplies itself, leaving the ones every cell of the side shares. */
type CellBody = Omit<CellDraft, 'shade' | 'marks'>;

/** The number a cell writes for `value`, in the contract's own units. */
function cellText(value: number): string {
  return footprintVolumeText(value);
}

/**
 * Whether `row` traded enough more on `side` than on the other one for the host to call it an imbalance, which both
 * the cells' marks and the stacked zones read.
 */
export function footprintRowImbalanced(row: ChartFootprintRow, side: FootprintSide): boolean {
  return side === 'sell' ? row.sellImbalance : row.buyImbalance;
}

/** The sides whose imbalance marks a cell carries, which the painter draws only while highlighting is on. */
function imbalanceMarks(row: ChartFootprintRow, sides: readonly FootprintSide[]): readonly FootprintSide[] {
  const marks: FootprintSide[] = [];
  for (const side of sides) {
    if (footprintRowImbalanced(row, side)) {
      marks.push(side);
    }
  }
  return marks;
}

/** One cell drawn in its own side's shade, with that side's imbalance mark when the row is imbalanced. */
function sideCell(row: ChartFootprintRow, side: FootprintSide, body: CellBody): CellDraft {
  return { ...body, shade: side, marks: imbalanceMarks(row, [side]) };
}

/** One cell drawn neutral, for a level whose other side is the one the shade belongs to. */
function neutralCell(row: ChartFootprintRow, side: FootprintSide, body: CellBody): CellDraft {
  return { ...body, shade: 'neutral', marks: imbalanceMarks(row, [side]) };
}

/** The shades a side's cells are graded through, which the settings hold for each side. */
function shadesOf(settings: FootprintCellSettings, side: FootprintSide): readonly string[] {
  return side === 'sell' ? settings.sellShades : settings.buyShades;
}

/** The share of its column a cell fills: the whole column in Cluster, its share of the largest in Profile. */
function widthShareOf(magnitude: number, largest: number, display: FootprintDisplay): number {
  if (display !== 'profile' || largest <= 0) {
    return FULL_WIDTH_SHARE;
  }
  return Math.min(FULL_WIDTH_SHARE, magnitude / largest);
}

/** One cell of a side: its value, its text and the band that side's own range grades it to. */
function valueCell(
  row: ChartFootprintRow,
  side: FootprintSide,
  value: number,
  range: FootprintVolumeRange,
  settings: FootprintCellSettings,
): CellDraft {
  const body: CellBody = {
    column: side,
    value,
    magnitude: value,
    text: cellText(value),
    band: footprintCellBand(value, range, settings.gradient),
  };
  return sideCell(row, side, body);
}

/** Both sides of one row, each cell in its own side's shade: the look the Buy and Sell type draws. */
function bothSidesOf(row: ChartFootprintRow, settings: FootprintCellSettings, sizes: FootprintBarSizes): CellDraft[] {
  return FOOTPRINT_SIDES.map((side) =>
    valueCell(row, side, footprintSideValue(row, side, settings.values), sizes[side], settings),
  );
}

/**
 * Both cells of a bid-ask level in the one shade it takes: the larger side's, graded by that side's share of the
 * bar's largest level, with the sell shading a level the sell side won or shared and the buy shading the rest. The
 * bid (sell) cell writes the sell number with the sell mark, the ask (buy) cell the buy number with the buy mark.
 */
function bidAskCells(row: ChartFootprintRow, settings: FootprintCellSettings, sizes: FootprintBarSizes): CellDraft[] {
  const sell = footprintSideValue(row, 'sell', settings.values);
  const buy = footprintSideValue(row, 'buy', settings.values);
  const larger = Math.max(sell, buy);
  const shade: CellShade = sell >= buy ? 'sell' : 'buy';
  const band = footprintCellBand(larger, sizes.level, settings.gradient);
  return FOOTPRINT_SIDES.map((side) => {
    const value = side === 'sell' ? sell : buy;
    return {
      column: side,
      value,
      magnitude: value,
      text: cellText(value),
      marks: imbalanceMarks(row, [side]),
      shade,
      band,
    };
  });
}

/** The shade a delta takes: the buy side's above zero, the sell side's below it, and none on it. */
function deltaShade(delta: number): CellShade {
  if (delta === 0) {
    return 'neutral';
  }
  return delta > 0 ? 'buy' : 'sell';
}

/** One cell writing the row's delta, shaded by its distance from zero and hued by the side it points at. */
function deltaCell(row: ChartFootprintRow, settings: FootprintCellSettings, sizes: FootprintBarSizes): CellDraft {
  const delta = footprintRowDelta(row, settings.values);
  return {
    column: SINGLE_COLUMN_SIDE,
    value: delta,
    magnitude: Math.abs(delta),
    text: footprintSignedText(delta),
    marks: [],
    shade: deltaShade(delta),
    band: footprintCellBand(Math.abs(delta), sizes.delta, settings.gradient),
  };
}

/** One cell writing what the row traded in all, shaded by the bar's total in the buy shades. */
function totalCell(row: ChartFootprintRow, settings: FootprintCellSettings, sizes: FootprintBarSizes): CellDraft {
  const total = footprintRowTotal(row, settings.values);
  return {
    column: SINGLE_COLUMN_SIDE,
    value: total,
    magnitude: total,
    text: cellText(total),
    marks: [],
    shade: 'buy',
    band: footprintCellBand(total, sizes.total, settings.gradient),
  };
}

/** The shade each side of a ladder's level takes: only the larger side's, and none while both traded alike. */
function ladderShades(sell: number, buy: number): Readonly<Record<FootprintSide, CellShade>> {
  return {
    sell: sell > buy ? 'sell' : 'neutral',
    buy: buy > sell ? 'buy' : 'neutral',
  };
}

/**
 * Both sides of one row, of which only the larger side is shaded: the ladder type. A level both sides traded alike
 * keeps both of its cells neutral.
 */
function ladderOf(row: ChartFootprintRow, settings: FootprintCellSettings, sizes: FootprintBarSizes): CellDraft[] {
  const sell = footprintSideValue(row, 'sell', settings.values);
  const buy = footprintSideValue(row, 'buy', settings.values);
  const shades = ladderShades(sell, buy);
  return FOOTPRINT_SIDES.map((side) => {
    const value = side === 'sell' ? sell : buy;
    const cell: CellBody = {
      column: side,
      value,
      magnitude: value,
      text: cellText(value),
      band: footprintCellBand(value, sizes[side], settings.gradient),
    };
    return shades[side] === 'neutral' ? neutralCell(row, side, cell) : sideCell(row, side, cell);
  });
}

/** The cells one row fills in the type the settings name. */
function rowDrafts(row: ChartFootprintRow, settings: FootprintCellSettings, sizes: FootprintBarSizes): CellDraft[] {
  switch (settings.type) {
    case 'bidAsk':
      return bidAskCells(row, settings, sizes);
    case 'delta':
      return [deltaCell(row, settings, sizes)];
    case 'total':
      return [totalCell(row, settings, sizes)];
    case 'ladder':
      return ladderOf(row, settings, sizes);
    case 'buySell':
      return bothSidesOf(row, settings, sizes);
  }
}

/** The larger of one row's two sides, whose share of it sets the shade both cells of a bid-ask level take. */
function largestSideOfRow(row: ChartFootprintRow, values: FootprintValues): number {
  return Math.max(footprintSideValue(row, 'sell', values), footprintSideValue(row, 'buy', values));
}

/** The sizes every cell of one bar is graded and scaled against. */
function barSizes(footprint: BarFootprint, values: FootprintValues): FootprintBarSizes {
  const rows = footprint.rows;
  return {
    sell: footprintSideRange(rows, 'sell', values),
    buy: footprintSideRange(rows, 'buy', values),
    level: footprintRangeFromZero(footprintLargestValue(rows, (row) => largestSideOfRow(row, values))),
    delta: footprintRangeFromZero(footprintLargestValue(rows, (row) => Math.abs(footprintRowDelta(row, values)))),
    total: footprintRangeFromZero(footprintLargestValue(rows, (row) => footprintRowTotal(row, values))),
  };
}

/** The largest magnitude each column of the bar holds, which the Profile widths are their share of. */
function largestByColumn(rows: readonly RowDrafts[]): Readonly<Record<FootprintSide, number>> {
  const largest: Record<FootprintSide, number> = { sell: 0, buy: 0 };
  for (const { cells } of rows) {
    for (const cell of cells) {
      largest[cell.column] = Math.max(largest[cell.column], cell.magnitude);
    }
  }
  return largest;
}

/**
 * The row a bar highlights as its point of control: the host's own row while the cells count volume, and the row the
 * bar traded most in while they count trades. The host computes a bar's point of control and its value area from
 * volume alone, so a bar counting trades highlights its own busiest row instead.
 */
function pocRowOf(footprint: BarFootprint, values: FootprintValues): number | null {
  if (values === 'volume') {
    return footprint.poc;
  }
  let busiest: ChartFootprintRow | null = null;
  for (const row of footprint.rows) {
    if (busiest === null || footprintRowTotal(row, values) > footprintRowTotal(busiest, values)) {
      busiest = row;
    }
  }
  return busiest === null ? null : busiest.row;
}

/** The colour of a draft's fill, before the highlight of the row a bar traded most at is applied. */
function fillOf(draft: CellDraft, settings: FootprintCellSettings): string {
  if (draft.shade === 'neutral') {
    return FOOTPRINT_NEUTRAL_COLOR;
  }
  return footprintShadeColor(shadesOf(settings, draft.shade), draft.band);
}

/** The colour of a draft's number, which a neutral cell takes from the neutral fill. */
function textColorOf(draft: CellDraft): string {
  return draft.shade === 'neutral' ? FOOTPRINT_NEUTRAL_TEXT_COLOR : footprintTextColor(draft.band);
}

/** One draft as the painter draws it, the highlight of the row a bar traded most at over its own shade. */
function cellOf(
  draft: CellDraft,
  settings: FootprintCellSettings,
  largest: Readonly<Record<FootprintSide, number>>,
  pocRow: number | null,
  rowNumber: number,
): FootprintCell {
  const highlighted = settings.poc.visible && rowNumber === pocRow;
  const fill = highlighted ? settings.poc.color : fillOf(draft, settings);
  return {
    column: draft.column,
    value: draft.value,
    text: draft.text,
    fill,
    textColor: highlighted ? footprintTextOn(fill) : textColorOf(draft),
    widthShare: widthShareOf(draft.magnitude, largest[draft.column], settings.display),
    marks: draft.marks,
  };
}

/**
 * What one bar's rows paint, in the type, display and values mode the settings name: each row with the cells its
 * columns fill. The painter places them; this decides every number, shade and width they are drawn with.
 */
export function footprintCells(footprint: BarFootprint, settings: FootprintCellSettings): FootprintCells {
  const sizes = barSizes(footprint, settings.values);
  const rows = footprint.rows.map((row) => ({ row, cells: rowDrafts(row, settings, sizes) }));
  const largest = largestByColumn(rows);
  const pocRow = pocRowOf(footprint, settings.values);
  return rows.map(({ row, cells }) => ({
    row,
    cells: cells.map((draft) => cellOf(draft, settings, largest, pocRow, row.row)),
  }));
}
