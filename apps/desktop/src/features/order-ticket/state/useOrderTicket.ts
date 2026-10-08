import type { OrderTicketStateParams } from './useOrderTicketState';
import { useOrderTicketBrokerActions } from './useOrderTicketBrokerActions';
import { useOrderTicketDraft } from './useOrderTicketDraft';
import { useOrderTicketPricing } from './useOrderTicketPricing';
import { useOrderTicketSizing } from './useOrderTicketSizing';
import { useOrderTicketState } from './useOrderTicketState';
import type { deriveStagedOrderDisplay } from '../domain/stagedOrderDisplay';
import type { OrderTicketStores } from './orderTicketStores';

export type OrderTicketParams = OrderTicketStateParams & { stores: OrderTicketStores };

export function useOrderTicket(params: OrderTicketParams) {
  const { stores, ...stateParams } = params;
  const state = useOrderTicketState(stateParams, stores);
  const tickSize = state.instrument ? Number(state.instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled =
    state.orderKind === 'market' || (state.priceMode === 'absolute' && (!state.quote || !tickKnown));
  const ticket = { ...state, tickSize, tickKnown, priceSwapDisabled };

  const draft = useOrderTicketDraft(ticket);
  const pricing = useOrderTicketPricing(ticket);
  const sizing = useOrderTicketSizing({ ...ticket, enableRiskStopLoss: draft.enableRiskStopLoss });
  const brokerActions = useOrderTicketBrokerActions({ ...ticket, ...draft });

  return {
    ...state,
    tickSize,
    tickKnown,
    priceSwapDisabled,
    ...draft,
    ...pricing,
    ...sizing,
    ...brokerActions,
  };
}

export type OrderTicketProducerState = ReturnType<typeof useOrderTicket>;
export type OrderTicketState = OrderTicketProducerState & {
  display: ReturnType<typeof deriveStagedOrderDisplay>;
};
