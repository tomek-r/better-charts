import type { OrderKind } from '../../../shared/bridge/types';
import { orderEntryPrice } from './ticketRules';

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
