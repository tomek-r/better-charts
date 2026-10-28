import type { BrokerSymbol, OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { quoteDigits, ticketPrice } from '../../../shared/format';

export function defaultStopLossPrice(
  entry: number,
  side: RiskSide,
  orderKind: OrderKind,
  instrument: BrokerSymbol | undefined,
  quote: QuoteSnapshot | undefined,
  range?: { min: number; max: number },
): string | undefined {
  if (!Number.isFinite(entry) || entry <= 0) {
    return undefined;
  }
  const point = Number(instrument?.pointSize);
  const tick = Number(instrument?.tickSize);
  const known = Number.isFinite(point) && point > 0 && Number.isFinite(tick) && tick > 0;
  const visible = range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min;
  const fallbackDistance = visible ? (range.max - range.min) * 0.25 : entry * 0.001;
  const minimum = known ? Math.max((instrument?.stopsLevel ?? 0) * point, 20 * tick) : 0;
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const hasQuote = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0;
  let reference = entry;
  if (orderKind === 'market' && hasQuote) {
    reference = side === 'buy' ? bid : ask;
  }
  const direction = side === 'buy' ? -1 : 1;
  const digits = instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : 2);
  const step = known ? Math.max(tick, minimum * 0.25) : fallbackDistance * 0.25;
  let distance = known ? minimum + 2 * tick : fallbackDistance;
  for (let attempt = 0; attempt < 5; attempt++) {
    let candidate = reference + direction * distance;
    if (visible) {
      const inset = known ? tick : Math.min(10 ** -digits, (range.max - range.min) * 0.1);
      candidate = side === 'buy' ? Math.min(candidate, range.max - inset) : Math.max(candidate, range.min + inset);
    }
    const stopLoss = ticketPrice(candidate, digits);
    const actual = direction * (Number(stopLoss) - reference);
    if (stopLoss !== '' && Number(stopLoss) > 0 && actual > minimum) {
      if (visible && (Number(stopLoss) <= range.min || Number(stopLoss) >= range.max)) {
        return undefined;
      }
      return stopLoss;
    }
    distance += step;
  }
  return undefined;
}
