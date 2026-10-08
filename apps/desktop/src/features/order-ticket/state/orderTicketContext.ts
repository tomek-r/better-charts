import { createContext } from 'react';
import { useRequiredContext } from '../../../shared/state/useRequiredContext';
import type { OrderTicketState } from './useOrderTicket';
import type { OrderTicketStores } from './orderTicketStores';

export type TicketActions = Pick<
  OrderTicketState,
  | 'togglePriceMode'
  | 'priceToTicks'
  | 'ticksToPrice'
  | 'applyExitTicks'
  | 'swapExitUnit'
  | 'toggleExit'
  | 'resetOrderDraft'
  | 'resetTicketToDefaults'
  | 'enableRiskStopLoss'
  | 'stageOrderDraft'
  | 'clearStagedWidget'
  | 'unstageOrderDraft'
  | 'stageFromQuote'
  | 'setRiskAmountFromInput'
  | 'applyUnitsMode'
  | 'requestOrderCheck'
  | 'submitOrder'
  | 'startOrderReview'
>;
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
