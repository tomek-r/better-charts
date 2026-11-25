/** How a footprint bar places its cells: the two sides' columns, or one column the cells are scaled inside. */
export const FOOTPRINT_DISPLAYS = ['cluster', 'profile'] as const;

export type FootprintDisplay = (typeof FOOTPRINT_DISPLAYS)[number];

/** What the cells of a footprint bar write: each side's own value, or what a level makes of both. */
export const FOOTPRINT_TYPES = ['buySell', 'bidAsk', 'delta', 'total', 'ladder'] as const;

export type FootprintType = (typeof FOOTPRINT_TYPES)[number];

/** How a footprint bar lays its columns out: both sides' columns around the candle, or one column right of it. */
export const FOOTPRINT_LAYOUTS = ['two-columns', 'single-column'] as const;

export type FootprintLayout = (typeof FOOTPRINT_LAYOUTS)[number];

/**
 * The layout each type draws: Buy and Sell, Bid × Ask and Ladder hold both sides, while Delta and Total write a
 * single cell a row.
 */
const LAYOUT_BY_TYPE: Readonly<Record<FootprintType, FootprintLayout>> = {
  buySell: 'two-columns',
  bidAsk: 'two-columns',
  ladder: 'two-columns',
  delta: 'single-column',
  total: 'single-column',
};

/** The layout a type draws its bar in, which is the only place the type decides where its columns sit. */
export function footprintLayoutOf(type: FootprintType): FootprintLayout {
  return LAYOUT_BY_TYPE[type];
}

/** The unit a footprint number is counted in: the volume each side traded, or the trades behind it. */
export const FOOTPRINT_VALUES = ['volume', 'tradeCount'] as const;

export type FootprintValues = (typeof FOOTPRINT_VALUES)[number];

/** How a footprint row's width is chosen: the host's automatic ATR rows, or a count of the symbol's ticks. */
export const FOOTPRINT_ROW_SIZE_MODES = ['auto', 'manual'] as const;

export type FootprintRowSizeMode = (typeof FOOTPRINT_ROW_SIZE_MODES)[number];
