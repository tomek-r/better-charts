import type { OrderTicketStateParams } from './useOrderTicketState';
import { useOrderTicketBrokerActions } from './useOrderTicketBrokerActions';
import { useOrderTicketDraft } from './useOrderTicketDraft';
import { useOrderTicketPricing } from './useOrderTicketPricing';
import { useOrderTicketSizing } from './useOrderTicketSizing';
import { useOrderTicketState } from './useOrderTicketState';
import { deriveStagedOrderDisplay } from '../domain/stagedOrderDisplay';

export type OrderTicketParams = OrderTicketStateParams;

export function useOrderTicket(params: OrderTicketParams) {
  const state = useOrderTicketState(params);
  const tickSize = state.instrument ? Number(state.instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled =
    state.orderKind === 'market' || (state.priceMode === 'absolute' && (!state.quote || !tickKnown));
  const ticket = { ...state, tickSize, tickKnown, priceSwapDisabled };

  const draft = useOrderTicketDraft(ticket);
  const pricing = useOrderTicketPricing(ticket);
  const sizing = useOrderTicketSizing({ ...ticket, enableRiskStopLoss: draft.enableRiskStopLoss });
  const brokerActions = useOrderTicketBrokerActions({ ...ticket, ...draft });
  const display = deriveStagedOrderDisplay({
    ...state,
    lastPreview:
      state.riskProjection?.draftVersion === state.draftVersion
        ? state.riskProjection
        : state.riskPreviewDisplayRef.current,
  });

  return {
    ...state,
    display: {
      ...display,
      // Hold the grabbed account-currency label while prices/volume continue calculating.
      slMoney:
        state.stagedDragging && state.unitsMode !== 'units' ? (state.dragSlMoney ?? display.slMoney) : display.slMoney,
    },
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
