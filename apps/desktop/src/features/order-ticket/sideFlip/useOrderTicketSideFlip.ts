import { useCallback } from 'react';
import type { RiskSide } from '../../../shared/bridge/types';
import { quoteDigits, ticketPrice } from '../../../shared/format';
import { flipExits, sideReference } from './sideFlip';
import type { OrderTicketInputs } from '../draft/orderTicketInputs';
import type { OrderTicketStores } from '../draft/orderTicketStores';

/** Buy/Sell from the quote: stages the draft, or flips an existing one to the other side keeping its exit distances. */
export function useOrderTicketSideFlip(
  inputs: Pick<OrderTicketInputs, 'instrument' | 'quote' | 'instrumentDigitsRef'>,
  stores: OrderTicketStores,
  staging: {
    resetOrderDraft: () => void;
    stageOrderDraft: (side: RiskSide, fresh?: boolean) => void;
    quoteEntryFor: (side: RiskSide) => number;
  },
) {
  const { instrument, quote, instrumentDigitsRef } = inputs;
  const { resetOrderDraft, stageOrderDraft, quoteEntryFor } = staging;
  const setters = stores.setters.draft;

  // Symbol-info may not have arrived yet, so the quote text carries the precision;
  // the entry and exits must share it or the market-follow effect sees a nonzero delta.
  const ticketDigits = useCallback(
    () => instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : instrumentDigitsRef.current),
    [instrument, quote, instrumentDigitsRef],
  );

  return useCallback(
    (side: RiskSide) => {
      const draft = stores.draft.getState();
      const switched = draft.riskSide !== side;
      setters.setPriceReference(sideReference(side));
      if (!switched) {
        stageOrderDraft(side, false);
        return;
      }
      const newEntry = quoteEntryFor(side);
      const flipped = draft.riskSide === '' ? undefined : flipExits(draft, newEntry, ticketDigits());
      setters.setRiskSide(side);
      if (!flipped) {
        resetOrderDraft();
        stageOrderDraft(side, true);
        return;
      }
      // The levels keep their distance on the other side; the entry is the new side's quote.
      setters.setEntry(ticketPrice(newEntry, ticketDigits()));
      setters.setStopLoss(flipped.stopLoss);
      setters.setTakeProfit(flipped.takeProfit);
      setters.setSlOn(flipped.stopLoss !== '');
      setters.setTpOn(flipped.takeProfit !== '');
      stageOrderDraft(side, false);
    },
    [stores.draft, resetOrderDraft, stageOrderDraft, setters, quoteEntryFor, ticketDigits],
  );
}
