import { useStore } from 'zustand';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import { useTicketGateProjection } from './useOrderTicketGates';
import type { OrderTicketActionProps } from './orderTicketEditorTypes';

export function useOrderTicketAction(): OrderTicketActionProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const gate = useTicketGateProjection();
  const orderCheckLoading = useStore(stores.broker, (state) => state.orderCheckLoading);
  const side = useStore(stores.draft, (state) => state.riskSide);
  return {
    canCheckOrder: gate.canCheckOrder,
    orderCheckLoading,
    startOrderReview: actions.startOrderReview,
    side,
  };
}
