import { paintsUnderBars, type SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { ChartLayerEntry } from '../chart/engine/drawings/chartDrawings';
import { objectTreeIndicatorPanes, type ObjectTreeIndicator } from './objectTreeIndicatorEntries';

/** One row of the price pane, topmost first: a drawing or the price bars, or an indicator the price pane draws. */
export type PricePaneRow =
  | { readonly kind: 'layer'; readonly layer: ChartLayerEntry }
  | { readonly kind: 'indicator'; readonly indicator: ObjectTreeIndicator };

/** What moving those rows means to the chart's layer list and to the saved indicators. */
export interface PricePaneRowEdits {
  /** The moved drawing or bars row, as topmost-first indexes of the chart's layer list. */
  readonly layers?: { readonly fromIndex: number; readonly toIndex: number };
  /** The price-pane indicators in their new order, and how many of them stand over the price bars. */
  readonly indicators?: { readonly order: readonly string[]; readonly aboveBars: number };
}

/** The price-pane indicators in row order, and how many of them the rows list over the price bars. */
interface IndicatorRowOrder {
  readonly order: readonly string[];
  readonly aboveBars: number;
}

/** The layer rows of one price pane: the ones over the bars, the bars row, and the ones under it. */
interface LayerSides {
  readonly overBars: readonly ChartLayerEntry[];
  readonly bars: readonly ChartLayerEntry[];
  readonly underBars: readonly ChartLayerEntry[];
}

/** A move that leaves both orders as they were, which a drag or a key that lands on the row's own place makes. */
const NO_EDITS: PricePaneRowEdits = {};

function layerRow(layer: ChartLayerEntry): PricePaneRow {
  return { kind: 'layer', layer };
}

function indicatorRow(indicator: ObjectTreeIndicator): PricePaneRow {
  return { kind: 'indicator', indicator };
}

/** The layer entries split around the bars marker, each side topmost first; the marker is always in the list. */
function layerSides(layers: readonly ChartLayerEntry[]): LayerSides {
  const barsIndex = layers.findIndex((layer) => layer.kind === 'bars');
  if (barsIndex === -1) {
    return { overBars: layers, bars: [], underBars: [] };
  }
  return {
    overBars: layers.slice(0, barsIndex),
    bars: layers.slice(barsIndex, barsIndex + 1),
    underBars: layers.slice(barsIndex + 1),
  };
}

/**
 * The price pane's rows, topmost first: the drawings over the price bars, the price-pane indicators over the candles,
 * the bars row, the indicators under the candles and the drawings under the bars. A row paints over the candles while
 * it stands over the bars row and under them below it, which the chart follows through its series order.
 */
export function pricePaneRows(
  layers: readonly ChartLayerEntry[],
  saved: readonly SavedIndicator[],
): readonly PricePaneRow[] {
  const { pricePane } = objectTreeIndicatorPanes(saved);
  const sides = layerSides(layers);
  return [
    ...sides.overBars.map(layerRow),
    ...pricePane.filter((entry) => !paintsUnderBars(entry.saved)).map(indicatorRow),
    ...sides.bars.map(layerRow),
    ...pricePane.filter((entry) => paintsUnderBars(entry.saved)).map(indicatorRow),
    ...sides.underBars.map(layerRow),
  ];
}

/** The layer entries of the rows, in their order: the chart's own layer list, which the tree prints topmost first. */
function layerEntries(rows: readonly PricePaneRow[]): readonly ChartLayerEntry[] {
  return rows.flatMap((row) => (row.kind === 'layer' ? [row.layer] : []));
}

/** The price-pane indicators of the rows in their order, and how many of them stand over the price bars. */
function indicatorRowOrder(rows: readonly PricePaneRow[]): IndicatorRowOrder {
  const order: string[] = [];
  let aboveBars = 0;
  let underBars = false;
  for (const row of rows) {
    if (row.kind === 'layer') {
      if (row.layer.kind === 'bars') {
        underBars = true;
      }
      continue;
    }
    order.push(row.indicator.saved.instanceId);
    if (!underBars) {
      aboveBars += 1;
    }
  }
  return { order, aboveBars };
}

function isRowIndex(rows: readonly PricePaneRow[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < rows.length;
}

/** The rows with the one at `fromIndex` moved to `toIndex`, which is what a dropped or lifted row does. */
function movedRows(rows: readonly PricePaneRow[], fromIndex: number, toIndex: number): readonly PricePaneRow[] {
  const moved = [...rows];
  const [row] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, row);
  return moved;
}

/** The layer move the moved row implies, found by the identity of the chart's own entry; none while it stayed. */
function layerMove(
  rows: readonly PricePaneRow[],
  moved: readonly PricePaneRow[],
  movedRow: PricePaneRow,
): PricePaneRowEdits {
  if (movedRow.kind !== 'layer') {
    return NO_EDITS;
  }
  const fromIndex = layerEntries(rows).indexOf(movedRow.layer);
  const toIndex = layerEntries(moved).indexOf(movedRow.layer);
  return fromIndex === -1 || toIndex === -1 || fromIndex === toIndex ? NO_EDITS : { layers: { fromIndex, toIndex } };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((instanceId, index) => instanceId === right[index]);
}

/** The indicator order and the side of the bars the rows hold now; none while a moved drawing left both as they were. */
function indicatorChange(rows: readonly PricePaneRow[], moved: readonly PricePaneRow[]): PricePaneRowEdits {
  const before = indicatorRowOrder(rows);
  const after = indicatorRowOrder(moved);
  const settled = before.aboveBars === after.aboveBars && sameOrder(before.order, after.order);
  return settled ? NO_EDITS : { indicators: after };
}

/**
 * What the chart and the saved settings make of a row move: the drawing stack move it implies, and the price-pane
 * order with the side of the price bars the moved indicator or bars row leaves them on.
 */
export function pricePaneRowEdits(
  rows: readonly PricePaneRow[],
  fromIndex: number,
  toIndex: number,
): PricePaneRowEdits {
  if (fromIndex === toIndex || !isRowIndex(rows, fromIndex) || !isRowIndex(rows, toIndex)) {
    return NO_EDITS;
  }
  const movedRow = rows[fromIndex];
  const moved = movedRows(rows, fromIndex, toIndex);
  return { ...layerMove(rows, moved, movedRow), ...indicatorChange(rows, moved) };
}
