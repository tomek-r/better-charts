import type { BrokerSymbol, OrderKind } from '../../../shared/bridge/types';
import { orderEntryPrice } from './orderEntryPrice';

/** The instrument's tick size; `tickKnown` is false while it is missing or not a positive number. */
export function tickSizeOf(instrument: BrokerSymbol | undefined): { tickSize: number; tickKnown: boolean } {
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  return { tickSize, tickKnown };
}

/** An absolute price cannot be converted to an offset without a live quote and a known tick size. */
export function isPriceSwapDisabled({
  orderKind,
  priceMode,
  hasQuote,
  tickKnown,
}: {
  orderKind: OrderKind;
  priceMode: 'offset' | 'absolute';
  hasQuote: boolean;
  tickKnown: boolean;
}): boolean {
  return orderKind === 'market' || (priceMode === 'absolute' && (!hasQuote || !tickKnown));
}

export function priceToTicks(
  price: string,
  tickKnown: boolean,
  orderKind: OrderKind,
  entry: string,
  limitPrice: string,
  tickSize: number,
): string {
  if (!tickKnown) {
    return '';
  }
  const base = Number(orderEntryPrice(orderKind, entry, limitPrice));
  const value = Number(price);
  if (!price.trim() || !Number.isFinite(base) || base <= 0 || !Number.isFinite(value) || value <= 0) {
    return '';
  }
  return String(Math.round(Math.abs(value - base) / tickSize));
}
