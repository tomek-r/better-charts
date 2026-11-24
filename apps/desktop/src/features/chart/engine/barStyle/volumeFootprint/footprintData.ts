/**
 * The footprint the volume footprint series draws, in the numbers its cells are measured with. The wire's own copy
 * lives in `shared/bridge/types.ts`, where prices and volumes stay the decimal strings trading-core serializes; the
 * chart-footprint adapter reads them across once, as the events arrive, so nothing in the engine parses a decimal.
 */

/**
 * One price row of a drawn footprint: the row's number, the price range it spans, the volume each side traded in it,
 * the number of trades each side took in it, and the imbalances the host found in it.
 */
export interface ChartFootprintRow {
  /** The row's number: the ticks `row * ticksPerRow` up to the next row's, negative below price zero. */
  readonly row: number;
  /** The row's lower price bound, inclusive. */
  readonly downPrice: number;
  /** The row's upper price bound, exclusive. */
  readonly upPrice: number;
  /** The volume that traded into the ask. */
  readonly buyVolume: number;
  /** The volume that traded into the bid. */
  readonly sellVolume: number;
  /** The number of buy trades the row counted: one per tick the bar's trade rule keeps. */
  readonly buyTrades: number;
  /** The number of sell trades the row counted, by the same rule. */
  readonly sellTrades: number;
  /** Whether the row's buy volume is imbalanced against the row below. */
  readonly buyImbalance: boolean;
  /** Whether the row's sell volume is imbalanced against the row above. */
  readonly sellImbalance: boolean;
}

/**
 * One bar's drawn footprint: the rows of its price levels, contiguous from the lowest the bar reached to the
 * highest, and the summary of them, with the POC and the value area named by row number rather than by index.
 */
export interface BarFootprint {
  /** The bar's opening time, epoch milliseconds. */
  readonly openMs: number;
  /** The bar's rows, lowest price first. */
  readonly rows: ChartFootprintRow[];
  readonly buyVolume: number;
  readonly sellVolume: number;
  /** The number of buy trades the bar counted, the sum of its rows' buy trades. */
  readonly buyTrades: number;
  /** The number of sell trades the bar counted, the sum of its rows' sell trades. */
  readonly sellTrades: number;
  /** The row with the largest total volume, as a row number. */
  readonly poc: number | null;
  /** The highest row of the value area, as a row number. */
  readonly vah: number | null;
  /** The lowest row of the value area, as a row number. */
  readonly val: number | null;
  /** Whether the volumes are the lots MT5 reports, or the trades it counts when it reports no volume. */
  readonly volume: 'real' | 'ticks';
}
