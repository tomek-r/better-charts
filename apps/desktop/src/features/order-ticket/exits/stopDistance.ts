import type { BrokerSymbol, OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { withMinusSign } from '../../../shared/format';
import { orderEntryPrice } from '../pricing/orderEntryPrice';

/** Ticks of margin the EA/Rust preflight requires beyond the broker's stops level. */
export const STOP_DISTANCE_MIN_TICKS = 20;

/**
 * Check/submit guard that mirrors the EA/Rust preflight: required distance =
 * max(stopsLevel x pointSize, STOP_DISTANCE_MIN_TICKS x tickSize) in price units, rendered in points
 * (price / pointSize). Market levels are measured from live quote sides (BUY: SL vs bid, TP vs ask; SELL
 * mirrored). Pending levels use their executable entry reference, and stop_limit uses its resting limit price
 * rather than its trigger. A distance at or below the minimum violates the EA's strict "distance > min"
 * requirement; unknown/invalid instrument sizes disable the guard.
 */
export type StopDistanceGuard = {
  slTooClose: boolean;
  tpTooClose: boolean;
  reason?: string;
};

export function stopDistanceGuard(
  instrument: BrokerSymbol | undefined,
  side: RiskSide,
  entry: string,
  stopLoss: string,
  takeProfit: string,
  quote: QuoteSnapshot | undefined,
  orderKind: OrderKind = 'market',
  limitPrice = '',
): StopDistanceGuard | undefined {
  if (!instrument) {
    return undefined;
  }
  const point = Number(instrument.pointSize);
  const tick = Number(instrument.tickSize);
  if (!Number.isFinite(point) || point <= 0 || !Number.isFinite(tick) || tick <= 0) {
    return undefined;
  }
  const minimum = Math.max(instrument.stopsLevel * point, STOP_DISTANCE_MIN_TICKS * tick);
  const minimumPoints = Math.round(minimum / point);
  const buy = side === 'buy';
  const entryValue = Number(entry.trim());
  const stopValue = Number(stopLoss.trim());
  const takeText = takeProfit.trim();
  const takeValue = Number(takeText);
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const hasQuote = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0;
  const referenceText = orderEntryPrice(orderKind, entry, limitPrice).trim();
  const reference = Number(referenceText);
  const hasReference = referenceText !== '' && Number.isFinite(reference) && reference > 0;
  const useQuote = orderKind === 'market' && hasQuote;
  let slReference = reference;
  let tpReference = reference;
  if (useQuote) {
    slReference = buy ? bid : ask;
    tpReference = buy ? ask : bid;
  }
  const hasEntry = entry.trim() !== '' && Number.isFinite(entryValue) && entryValue > 0;
  const hasStop = stopLoss.trim() !== '' && Number.isFinite(stopValue) && stopValue > 0;
  const hasTake = takeText !== '' && Number.isFinite(takeValue) && takeValue > 0;
  let slDistance: number | undefined;
  if (hasReference && hasEntry && hasStop) {
    slDistance = buy ? slReference - stopValue : stopValue - slReference;
  }
  let tpDistance: number | undefined;
  if (hasReference && hasEntry && hasTake) {
    tpDistance = buy ? takeValue - tpReference : tpReference - takeValue;
  }
  const isTooClose = (distance: number | undefined, reference: number, level: number): boolean => {
    if (distance === undefined) {
      return false;
    }
    // Decimal prices such as 98.20 - 98 can land a few ULPs above 0.20.
    // Keep the strict `distance > minimum` contract stable at that boundary.
    const tolerance = Number.EPSILON * Math.max(Math.abs(reference), Math.abs(level), Math.abs(minimum), 1) * 4;
    return distance <= minimum + tolerance;
  };
  const slTooClose = isTooClose(slDistance, slReference, stopValue);
  const tpTooClose = isTooClose(tpDistance, tpReference, takeValue);
  const points = (distance: number) => Math.round(distance / point);
  let reason: string | undefined;
  // A too-close stop blocks without wording; the SL band keeps drafts out of it.
  if (!slTooClose && tpTooClose && tpDistance !== undefined) {
    // A take profit on the wrong side measures a negative distance, and this message is display text.
    const distanceText = withMinusSign(String(points(tpDistance)));
    reason = `take_profit too close: distance ${distanceText} pts, required >= ${minimumPoints} pts (${STOP_DISTANCE_MIN_TICKS} ticks margin)`;
  }
  return { slTooClose, tpTooClose, reason };
}
