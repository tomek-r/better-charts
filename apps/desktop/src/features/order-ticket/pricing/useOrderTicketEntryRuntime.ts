import { useStore } from 'zustand';
import type { OrderTicketEntryEffectsInput } from './useOrderTicketEntryEffects';
import type { OrderTicketInputs } from '../draft/orderTicketInputs';
import { useOrderTicketStores } from '../draft/orderTicketContext';

export function useOrderTicketEntryRuntime(inputs: Pick<OrderTicketInputs, 'quote'>): OrderTicketEntryEffectsInput {
  const stores = useOrderTicketStores();
  const draft = useStore(stores.draft);
  const setters = stores.setters.draft;

  return {
    riskSide: draft.riskSide,
    entry: draft.entry,
    orderKind: draft.orderKind,
    priceMode: draft.priceMode,
    stagedOnChart: draft.stagedOnChart,
    stagedDragging: draft.stagedDragging,
    ticketStage: draft.ticketStage,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    quote: inputs.quote,
    setEntry: setters.setEntry,
    setStopLoss: setters.setStopLoss,
    setTakeProfit: setters.setTakeProfit,
  };
}
