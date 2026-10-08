import { useStore } from 'zustand';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';
import {
  useBridgeAccountSelector,
  useBridgeConnection,
  useBridgeMarketSelector,
  useBridgeQuote,
} from '../../bridge/BridgeSessionProvider';
import { deriveOrderTicket } from '../domain/ticketRules';
import { deriveStagedOrderDisplay } from '../domain/stagedOrderDisplay';
import { useOrderTicketActions, useOrderTicketStores } from './orderTicketContext';
import type { OrderTicketState } from './useOrderTicket';

/** Rebuild the lifecycle projection from canonical stores; this does not create a second producer or refs. */
export function useOrderTicketRuntime(): OrderTicketState {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const draft = useStore(stores.draft);
  const broker = useStore(stores.broker);
  const editor = useStore(stores.editor);
  const { chart, stagedOrderState, instrumentDigitsRef, stagedActiveRef } = useChartResources();
  const { instrument, snapshot, latestCandle } = useBridgeMarketSelector((market) => market);
  const quote = useBridgeQuote();
  const account = useBridgeAccountSelector((value) => value);
  const { status } = useBridgeConnection();
  const params = {
    chart,
    stagedOrderState,
    instrumentDigitsRef,
    stagedActiveRef,
    instrument,
    account,
    quote,
    snapshot,
    latestCandle,
    status,
  };
  const derived = deriveOrderTicket({
    symbol: snapshot.symbol,
    bridgeState: status.state,
    account,
    stagedOnChart: draft.stagedOnChart,
    riskSide: draft.riskSide,
    entry: draft.entry,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    slOn: draft.slOn,
    tpOn: draft.tpOn,
    orderKind: draft.orderKind,
    limitPrice: draft.limitPrice,
    timeInForce: draft.timeInForce,
    unitsMode: draft.unitsMode,
    equityAllocationPercent: draft.equityAllocationPercent,
    orderVolume: draft.orderVolume,
    orderCheck: broker.orderCheck,
    riskPreview: broker.riskPreview,
    draftVersion: draft.draftVersion,
    riskLoading: broker.riskLoading,
    instrument,
    quote,
    marketOpen: status.marketSession?.isOpen,
  });
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
