import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { deriveQuotePresentation } from '../../../shared/format';
import { useBridgeMarketSelector, useBridgeQuoteSelector } from '../../bridge/BridgeSessionProvider';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketQuoteProps } from './orderTicketEditorTypes';

export function useOrderTicketQuotes(): OrderTicketQuoteProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const pointSize = useBridgeMarketSelector((market) => market.instrument?.pointSize);
  const side = useStore(stores.draft, (state) => state.riskSide);
  const { bidText, askText, spreadText, spreadPoints } = useBridgeQuoteSelector(
    useShallow((quote) => deriveQuotePresentation(quote, pointSize)),
  );
  return { bidText, askText, spreadText, spreadPoints, side, stageFromQuote: actions.stageFromQuote };
}
