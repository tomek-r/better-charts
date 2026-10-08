import { useStore } from 'zustand';
import { buildTicketDerivationInput } from '../domain/ticketDerivation';
import { deriveStagedOrderDisplay } from '../domain/stagedOrderDisplay';
import { useOrderTicketActions, useOrderTicketStores } from './orderTicketContext';
import type { OrderTicketStateParams } from './useOrderTicketState';
import type { OrderTicketState } from './useOrderTicket';

/** Rebuild the lifecycle projection from canonical stores; this does not create a second producer or refs. */
export function useOrderTicketRuntime(params: OrderTicketStateParams): OrderTicketState {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const draft = useStore(stores.draft);
  const broker = useStore(stores.broker);
  const editor = useStore(stores.editor);
  const { instrument, snapshot, quote, account, status } = params;
  const derived = stores.deriveTicket(
    buildTicketDerivationInput(
      {
        symbol: snapshot.symbol,
        bridgeState: status.state,
        account,
        instrument,
        quote,
        marketOpen: status.marketSession?.isOpen,
      },
      draft,
      broker,
    ),
  );
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled = draft.orderKind === 'market' || (draft.priceMode === 'absolute' && (!quote || !tickKnown));
  const display = deriveStagedOrderDisplay({
    ...params,
    ...draft,
    ...derived,
    effectiveVolume: derived.effectiveVolume,
    riskPreview: broker.riskPreview,
    draftVersion: draft.draftVersion,
    lastPreview:
      broker.riskProjection?.draftVersion === draft.draftVersion
        ? broker.riskProjection
        : stores.coordination.riskPreviewDisplayRef.current,
  });
  return {
    ...params,
    ...stores.coordination,
    ...draft,
    ...stores.setters.draft,
    ...broker,
    ...stores.setters.broker,
    ...editor,
    ...stores.setters.editor,
    ...derived,
    ...actions,
    display: {
      ...display,
      slMoney:
        draft.stagedDragging && draft.unitsMode !== 'units' ? (draft.dragSlMoney ?? display.slMoney) : display.slMoney,
    },
    tickSize,
    tickKnown,
    priceSwapDisabled,
  };
}
