import type { RiskSide } from '../../../../shared/bridge/types';

/**
 * Allowed stop-loss band for risk-sized orders, as absolute prices. Display and
 * gesture aid only: the backend/EA risk preview stays the sizing authority, so
 * any missing or inconsistent metadata yields no band and no clamp.
 */
export interface StagedSlBand {
  /** Closest permitted SL (broker stop distance, or the volumeMax cap). */
  nearPrice: number;
  /** Farthest permitted SL: the minimum lot spends the whole risk budget. */
  farPrice: number;
  /** No price satisfies both edges: nothing is shaded or clamped. */
  empty: boolean;
  emptyHint: string;
}

/** Holds a dragged SL inside the allowed band; `edge` names the edge that caught it. */
export function clampStopLoss(
  price: number,
  side: RiskSide,
  band: StagedSlBand | undefined,
): { price: number; edge: 'near' | 'far' | null } {
  if (!band || band.empty) {
    return { price, edge: null };
  }
  // BUY stops sit below the entry: far = lowest allowed, near = highest allowed.
  const [lowest, highest] = side === 'buy' ? [band.farPrice, band.nearPrice] : [band.nearPrice, band.farPrice];
  if (price < lowest) {
    return { price: lowest, edge: side === 'buy' ? 'far' : 'near' };
  }
  if (price > highest) {
    return { price: highest, edge: side === 'buy' ? 'near' : 'far' };
  }
  return { price, edge: null };
}

/**
 * The band edges' distances from the entry when the band is measured from the entry itself (Limit and Stop;
 * a Stop Limit measures from its fixed limit price, a Market order follows the quote). null = the band does
 * not move with an entry drag.
 */
export function entryCarriedBand(order: {
  entry: number;
  orderKindLabel: string;
  slBand?: StagedSlBand;
}): { near: number; far: number } | null {
  const { slBand } = order;
  if (!slBand || slBand.empty || (order.orderKindLabel !== 'Limit' && order.orderKindLabel !== 'Stop')) {
    return null;
  }
  return { near: Math.abs(slBand.nearPrice - order.entry), far: Math.abs(slBand.farPrice - order.entry) };
}
