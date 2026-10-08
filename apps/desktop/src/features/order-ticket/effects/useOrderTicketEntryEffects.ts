import { useEffect, useRef } from 'react';
import type { OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { quoteDigits, ticketPrice } from '../../../shared/format';
import type { OrderTicketDraftStore, OrderTicketStores } from '../state/orderTicketStores';

export type OrderTicketEntryEffectsInput = Pick<
  OrderTicketDraftStore,
  | 'riskSide'
  | 'entry'
  | 'orderKind'
  | 'priceMode'
  | 'stagedOnChart'
  | 'stagedDragging'
  | 'ticketStage'
  | 'stopLoss'
  | 'takeProfit'
  | 'slOn'
  | 'tpOn'
> & {
  quote: QuoteSnapshot | undefined;
  setEntry: OrderTicketStores['setters']['draft']['setEntry'];
  setStopLoss: OrderTicketStores['setters']['draft']['setStopLoss'];
  setTakeProfit: OrderTicketStores['setters']['draft']['setTakeProfit'];
};

// Effect slots (4) + (5): entry reseed from the live quote and the market
// follow — registered at their former slot between the portfolio guard and the
// bridge-listener effect.
export function useOrderTicketEntryEffects(ticket: OrderTicketEntryEffectsInput): void {
  const previousMarketSelection = useRef<{ orderKind: OrderKind; riskSide: RiskSide } | undefined>(undefined);
  const {
    quote,
    riskSide,
    entry,
    setEntry,
    orderKind,
    priceMode,
    stagedOnChart,
    stagedDragging,
    ticketStage,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    setStopLoss,
    setTakeProfit,
  } = ticket;
  useEffect(() => {
    if (!stagedDragging && quote && !entry && !(priceMode === 'offset' && orderKind !== 'market')) {
      setEntry(riskSide === 'buy' ? quote.ask : quote.bid);
    }
  }, [quote, riskSide, entry, priceMode, orderKind, stagedDragging, setEntry]);
  // A staged market order follows quote ticks while it is being edited.
  // Translate enabled exits by the same delta to preserve their distances.
  useEffect(() => {
    const selectionChanged =
      previousMarketSelection.current !== undefined &&
      (previousMarketSelection.current.orderKind !== orderKind ||
        previousMarketSelection.current.riskSide !== riskSide);
    previousMarketSelection.current = { orderKind, riskSide };
    // Hold the draft's reference and exits under the pointer; release catches
    // up to the latest quote while preserving the edited distances.
    if (stagedDragging || orderKind !== 'market' || !quote) {
      return;
    }
    const nextEntryText = riskSide === 'buy' ? quote.ask : quote.bid;
    const nextEntry = Number(nextEntryText);
    if (!Number.isFinite(nextEntry) || nextEntry <= 0) {
      return;
    }
    if (!stagedOnChart || ticketStage !== 'edit') {
      if (selectionChanged) {
        setEntry(nextEntryText);
      }
      return;
    }

    const previousEntry = Number(entry);
    if (!Number.isFinite(previousEntry) || previousEntry <= 0) {
      setEntry(nextEntryText);
      return;
    }
    const delta = nextEntry - previousEntry;
    if (delta === 0) {
      return;
    }
    const digits = quoteDigits(quote.bid, quote.ask);
    const shiftLevel = (value: string, enabled: boolean, update: (next: string) => void) => {
      if (!enabled || !value.trim()) {
        return;
      }
      const level = Number(value);
      if (Number.isFinite(level) && level > 0) {
        update(ticketPrice(level + delta, digits));
      }
    };
    shiftLevel(stopLoss, slOn, setStopLoss);
    shiftLevel(takeProfit, tpOn, setTakeProfit);
    setEntry(nextEntryText);
  }, [
    orderKind,
    riskSide,
    quote,
    stagedOnChart,
    stagedDragging,
    ticketStage,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    setEntry,
    setStopLoss,
    setTakeProfit,
  ]);
}
