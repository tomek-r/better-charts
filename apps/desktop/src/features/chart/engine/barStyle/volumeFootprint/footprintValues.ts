import type { BarFootprint, ChartFootprintRow } from './footprintData';
import type { FootprintValues } from './footprintModes';
import type { FootprintSide, FootprintVolumeRange } from './footprintShades';

/** The value one row traded on one side, in the units the values mode counts. */
export function footprintSideValue(row: ChartFootprintRow, side: FootprintSide, values: FootprintValues): number {
  if (values === 'tradeCount') {
    return side === 'sell' ? row.sellTrades : row.buyTrades;
  }
  return side === 'sell' ? row.sellVolume : row.buyVolume;
}

/** The value a row traded in all, both sides together. */
export function footprintRowTotal(row: ChartFootprintRow, values: FootprintValues): number {
  return footprintSideValue(row, 'buy', values) + footprintSideValue(row, 'sell', values);
}

/** How much more a row's buy side took than its sell side, negative when the sell side took more. */
export function footprintRowDelta(row: ChartFootprintRow, values: FootprintValues): number {
  return footprintSideValue(row, 'buy', values) - footprintSideValue(row, 'sell', values);
}

/** What a bar traded on each side, in the units the values mode counts. */
export interface FootprintBarSides {
  readonly buy: number;
  readonly sell: number;
}

/** One bar's values on one side, which that side's cells are graded between. */
export function footprintSideRange(
  rows: readonly ChartFootprintRow[],
  side: FootprintSide,
  values: FootprintValues,
): FootprintVolumeRange {
  return footprintValueRange(rows, (row) => footprintSideValue(row, side, values));
}

/** The values `valueOf` reads off `rows` span, from their quietest to their busiest. */
export function footprintValueRange(
  rows: readonly ChartFootprintRow[],
  valueOf: (row: ChartFootprintRow) => number,
): FootprintVolumeRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const value = valueOf(row);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min)) {
    return { min: 0, max: 0 };
  }
  return { min, max };
}

/** The largest value `valueOf` reads off `rows`; nothing while the bar holds no row. */
export function footprintLargestValue(
  rows: readonly ChartFootprintRow[],
  valueOf: (row: ChartFootprintRow) => number,
): number {
  let largest = 0;
  for (const row of rows) {
    largest = Math.max(largest, valueOf(row));
  }
  return largest;
}

/** The value each side of `footprint` traded in all, in the units the values mode counts. */
export function footprintBarSides(footprint: BarFootprint, values: FootprintValues): FootprintBarSides {
  if (values === 'tradeCount') {
    return { buy: footprint.buyTrades, sell: footprint.sellTrades };
  }
  return { buy: footprint.buyVolume, sell: footprint.sellVolume };
}
