import { createContext } from 'react';
import { useRequiredContext } from '../../../shared/state/useRequiredContext';
import type { useOrderTicketActionsProducer } from './useOrderTicketActionsProducer';
import type { OrderTicketStores } from './orderTicketStores';

export type TicketActions = ReturnType<typeof useOrderTicketActionsProducer>;
type TicketInjection = { stores: OrderTicketStores; actions: TicketActions };

export const OrderTicketStoresContext = createContext<TicketInjection | null>(null);

export function useOrderTicketStores(): OrderTicketStores {
  return useRequiredContext(OrderTicketStoresContext, 'Order ticket hooks must be used inside OrderTicketProvider.')
    .stores;
}

export function useOrderTicketActions(): TicketActions {
  return useRequiredContext(OrderTicketStoresContext, 'Order ticket hooks must be used inside OrderTicketProvider.')
    .actions;
}
