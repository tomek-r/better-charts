import type { BrokerSymbol, OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { ticketPrice } from '../../../shared/format';

// The EA rejects a Stop / Stop Limit trigger that the live price has reached or passed
// (docs/protocol/bridge-v1.md, `INVALID_PRICE`). These are its wordings, matched case-insensitively.
const PASSED_TRIGGER_REJECTIONS = ['stop entry must be', 'stop_limit trigger must be'];

/** Guards the float noise of `price / tick` so an exact tick multiple is not pushed one tick further. */
const TICK_GRID_TOLERANCE = 1e-9;

export type PassedStopEntryGuidance = {
  message: string;
  actionLabel: string;
  /** Nearest valid trigger: beyond the market by the broker stops level, on the tick grid. */
  suggestedEntry: string;
};

export type PassedStopEntryInput = {
  orderCheckError: string | undefined;
  orderKind: OrderKind;
  side: RiskSide;
  entry: string;
  quote: QuoteSnapshot | undefined;
  instrument: BrokerSymbol | undefined;
};

function isPassedTriggerRejection(message: string | undefined): boolean {
  const text = message?.trim().toLowerCase();
  return text !== undefined && PASSED_TRIGGER_REJECTIONS.some((prefix) => text.startsWith(prefix));
}

function positive(value: string | number): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Buy triggers sit above Ask and sell triggers below Bid; the trigger must clear the stops level and land on a tick. */
function nearestValidTrigger(side: 'buy' | 'sell', marketPrice: number, instrument: BrokerSymbol): string | undefined {
  const tick = positive(instrument.tickSize);
  if (tick === undefined) {
    return undefined;
  }
  const point = positive(instrument.pointSize) ?? tick;
  const distance = Math.max(instrument.stopsLevel * point, tick);
  const ticks =
    side === 'buy'
      ? Math.ceil((marketPrice + distance) / tick - TICK_GRID_TOLERANCE)
      : Math.floor((marketPrice - distance) / tick + TICK_GRID_TOLERANCE);
  return ticketPrice(ticks * tick, instrument.digits) || undefined;
}

/**
 * Specific guidance when the EA refused a Stop / Stop Limit trigger because the market reached it.
 * Undefined for every other error, or when the live quote shows the trigger is not passed (stale rejection).
 */
export function passedStopEntryGuidance(input: PassedStopEntryInput): PassedStopEntryGuidance | undefined {
  const { orderCheckError, orderKind, side, entry, quote, instrument } = input;
  if (orderKind === 'market' || orderKind === 'limit' || (side !== 'buy' && side !== 'sell')) {
    return undefined;
  }
  if (!isPassedTriggerRejection(orderCheckError) || !quote || !instrument) {
    return undefined;
  }
  const entryPrice = positive(entry.trim());
  const marketText = side === 'buy' ? quote.ask : quote.bid;
  const marketPrice = positive(marketText);
  if (entryPrice === undefined || marketPrice === undefined) {
    return undefined;
  }
  const passed = side === 'buy' ? entryPrice <= marketPrice : entryPrice >= marketPrice;
  const suggestedEntry = nearestValidTrigger(side, marketPrice, instrument);
  if (!passed || suggestedEntry === undefined) {
    return undefined;
  }
  const reference = side === 'buy' ? 'Ask' : 'Bid';
  const direction = side === 'buy' ? 'above' : 'below';
  return {
    message: `Price moved past your stop entry (${reference} ${marketText}). Move the entry ${direction} ${reference} or switch to Market.`,
    actionLabel: `Move entry ${direction} ${reference}`,
    suggestedEntry,
  };
}
