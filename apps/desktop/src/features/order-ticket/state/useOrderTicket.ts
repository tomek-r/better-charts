import type { OrderTicketStateParams } from './useOrderTicketState';
import { useOrderTicketBrokerActions } from './useOrderTicketBrokerActions';
import { useOrderTicketDraft } from './useOrderTicketDraft';
import { useOrderTicketPricing } from './useOrderTicketPricing';
import { useOrderTicketSizing } from './useOrderTicketSizing';
import { useOrderTicketState } from './useOrderTicketState';

export type OrderTicketParams = OrderTicketStateParams;

export function useOrderTicket(params: OrderTicketParams) {
  const state = useOrderTicketState(params);
  const tickSize = state.instrument ? Number(state.instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled =
    state.priceMode === 'absolute' && (state.orderKind === 'market' || !state.quote || !tickKnown);
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

export type OrderTicketState = ReturnType<typeof useOrderTicket>;
