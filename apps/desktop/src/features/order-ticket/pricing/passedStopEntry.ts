import type { OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { quoteTextFor } from '../sideFlip/sideFlip';

// The EA rejects a Stop / Stop Limit trigger that the live price has reached or passed
// (docs/protocol/bridge-v1.md, `INVALID_PRICE`). These are its wordings, matched case-insensitively.
const PASSED_TRIGGER_REJECTIONS = ['stop entry must be', 'stop_limit trigger must be'];

export type PassedStopEntryInput = {
  orderCheckError: string | undefined;
  orderKind: OrderKind;
  side: RiskSide;
  entry: string;
  quote: QuoteSnapshot | undefined;
};

function isPassedTriggerRejection(message: string | undefined): boolean {
  const text = message?.trim().toLowerCase();
  return text !== undefined && PASSED_TRIGGER_REJECTIONS.some((prefix) => text.startsWith(prefix));
}

function positive(value: string | number): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * Specific guidance text when the EA refused a Stop / Stop Limit trigger because the market reached it.
 * Undefined for every other error, or when the live quote shows the trigger is not passed (stale rejection).
 */
export function passedStopEntryGuidance(input: PassedStopEntryInput): string | undefined {
  const { orderCheckError, orderKind, side, entry, quote } = input;
  if (orderKind === 'market' || orderKind === 'limit' || (side !== 'buy' && side !== 'sell')) {
    return undefined;
  }
  if (!isPassedTriggerRejection(orderCheckError) || !quote) {
    return undefined;
  }
  const entryPrice = positive(entry.trim());
  const marketText = quoteTextFor(side, quote);
  const marketPrice = positive(marketText);
  if (entryPrice === undefined || marketPrice === undefined) {
    return undefined;
  }
  const passed = side === 'buy' ? entryPrice <= marketPrice : entryPrice >= marketPrice;
  if (!passed) {
    return undefined;
  }
  const reference = side === 'buy' ? 'Ask' : 'Bid';
  const direction = side === 'buy' ? 'above' : 'below';
  return `Price moved past your stop entry (${reference} ${marketText}). Move the entry ${direction} ${reference} or switch to Market.`;
}
