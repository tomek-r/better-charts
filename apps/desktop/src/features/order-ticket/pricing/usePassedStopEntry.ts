import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { QuoteSnapshot } from '../../../shared/bridge/types';
import type { OrderTicketStores } from '../draft/orderTicketStores';
import { passedStopEntryGuidance } from './passedStopEntry';

/** The guidance for a Stop / Stop Limit trigger the market passed, from the ticket's current draft and check error. */
export function usePassedStopEntry(stores: OrderTicketStores, quote: QuoteSnapshot | undefined): string | undefined {
  const orderCheckError = useStore(stores.broker, (state) => state.orderCheckError);
  const { riskSide, orderKind, entry } = useStore(
    stores.draft,
    useShallow((state) => ({ riskSide: state.riskSide, orderKind: state.orderKind, entry: state.entry })),
  );
  return passedStopEntryGuidance({ orderCheckError, orderKind, side: riskSide, entry, quote });
}
