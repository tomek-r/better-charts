import type { RiskSide } from '../../../shared/bridge/types';
import { ticketPrice } from '../../../shared/format';

/** The quote a side's entry and price offset are measured from: Buy fills at the ask, Sell at the bid. */
export function sideReference(side: RiskSide): 'ask' | 'bid' {
  return side === 'sell' ? 'bid' : 'ask';
}

/** The exit levels a draft carries when its side is switched. */
export type FlippedExits = { stopLoss: string; takeProfit: string };

/**
 * Mirrors each enabled exit across the new entry at its old distance: a buy stop 50 points below the entry
 * becomes a sell stop 50 points above the new entry. Returns undefined when there is nothing to flip
 * (no enabled level) or a price is unusable, so the caller starts a fresh draft instead.
 */
export function flipExits(
  draft: { entry: string; stopLoss: string; takeProfit: string; slOn: boolean; tpOn: boolean },
  newEntry: number,
  digits: number | undefined,
): FlippedExits | undefined {
  const oldEntry = Number(draft.entry);
  if (!Number.isFinite(oldEntry) || oldEntry <= 0 || !Number.isFinite(newEntry) || newEntry <= 0) {
    return undefined;
  }
  const mirror = (enabled: boolean, level: string): string | undefined => {
    if (!enabled || level.trim() === '') {
      return '';
    }
    const price = Number(level);
    if (!Number.isFinite(price) || price <= 0) {
      return undefined;
    }
    const flipped = ticketPrice(newEntry - (price - oldEntry), digits);
    return flipped === '' ? undefined : flipped;
  };
  const stopLoss = mirror(draft.slOn, draft.stopLoss);
  const takeProfit = mirror(draft.tpOn, draft.takeProfit);
  if (stopLoss === undefined || takeProfit === undefined || (stopLoss === '' && takeProfit === '')) {
    return undefined;
  }
  return { stopLoss, takeProfit };
}
