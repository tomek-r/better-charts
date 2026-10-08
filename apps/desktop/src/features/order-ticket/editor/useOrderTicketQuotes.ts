import { useStore } from 'zustand';
import { useBridgeMarketSelector } from '../../bridge/BridgeSessionProvider';
import { useBridgeQuotePresentation } from '../../bridge/useBridgeQuotePresentation';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketQuoteProps } from './orderTicketEditorTypes';

export function useOrderTicketQuotes(): OrderTicketQuoteProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const pointSize = useBridgeMarketSelector((market) => market.instrument?.pointSize);
  const side = useStore(stores.draft, (state) => state.riskSide);
  const { bidText, askText, spreadText, spreadPoints } = useBridgeQuotePresentation(pointSize);
  return { bidText, askText, spreadText, spreadPoints, side, stageFromQuote: actions.stageFromQuote };
}
