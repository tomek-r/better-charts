import { useStore } from 'zustand';
import { useStableByContent } from '../../../shared/hooks/useStableByContent';
import type { ChartTicketOverlayState } from '../../chart/workspace/useChartOverlaySync';
import { deriveOrderRiskBasis } from '../sizing/riskBasis';
import { deriveStagedOrderDisplay } from './stagedOrderDisplay';
import { deriveStopLossBand, type StopLossBand } from './stopLossBand';
import { useOrderTicketActions, useOrderTicketStores, type TicketActions } from '../draft/orderTicketContext';
import type { OrderTicketInputs } from '../draft/orderTicketInputs';
import type { OrderTicketStores } from '../draft/orderTicketStores';

export function useOrderTicketChartRuntime(
  inputs: Pick<OrderTicketInputs, 'instrument' | 'account' | 'snapshot' | 'quote'>,
): ChartTicketOverlayState {
  const stores = useOrderTicketStores();
  const draft = useStore(stores.draft);
  const broker = useStore(stores.broker);
  const { instrument, account, quote } = inputs;
  const { unitsMode, riskAmount, equityAllocationPercent, stagedOnChart } = draft;
  const { riskSide, orderKind, entry, limitPrice } = draft;
  // Stable between equal bands so the chart mirror effect does not re-run.
  const slBand = useStableByContent<StopLossBand>(
    stagedOnChart
      ? deriveStopLossBand({
          instrument,
          account,
          unitsMode,
          riskBudget: deriveOrderRiskBasis({
            unitsMode,
            riskAmount,
            equity: account?.equity,
            equityAllocationPercent,
            currency: account?.currency,
            currencyDigits: account?.currencyDigits,
            stagedOnChart,
          }).sizingRiskAmount,
          side: riskSide,
          orderKind,
          entry,
          limitPrice,
          quote,
        })
      : undefined,
  );
  const effectiveVolume = draft.orderVolume.trim();
  const fullDisplay = deriveStagedOrderDisplay({
    instrument: inputs.instrument,
    account: inputs.account,
    snapshot: inputs.snapshot,
    riskSide: draft.riskSide,
    entry: draft.entry,
    limitPrice: draft.limitPrice,
    orderKind: draft.orderKind,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    slOn: draft.slOn,
    tpOn: draft.tpOn,
    effectiveVolume,
    unitsMode: draft.unitsMode,
    volumeManual: draft.volumeManual,
    sizingFailed: broker.riskError !== undefined,
    riskPreview: broker.riskPreview,
    draftVersion: draft.draftVersion,
    lastPreview:
      broker.riskProjection?.draftVersion === draft.draftVersion
        ? broker.riskProjection
        : stores.coordination.riskPreviewDisplayRef.current,
  });
  const display = {
    ...fullDisplay,
    slMoney:
      draft.stagedDragging && draft.unitsMode !== 'units'
        ? (draft.dragSlMoney ?? fullDisplay.slMoney)
        : fullDisplay.slMoney,
  };

  return {
    submitSwapPendingRef: stores.coordination.submitSwapPendingRef,
    stagedPrevPriceRef: stores.coordination.stagedPrevPriceRef,
    stagedOnChart: draft.stagedOnChart,
    entry: draft.entry,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    slOn: draft.slOn,
    tpOn: draft.tpOn,
    riskSide: draft.riskSide,
    orderKind: draft.orderKind,
    effectiveVolume,
    display,
    slBand,
  };
}

export type OrderTicketChartControls = Pick<
  OrderTicketStores['setters']['draft'],
  'setEntry' | 'setSlOn' | 'setStopLoss' | 'setTpOn' | 'setTakeProfit' | 'setStagedDragging' | 'setDragSlMoney'
>;

export function useOrderTicketChartControls(): OrderTicketChartControls {
  const setters = useOrderTicketStores().setters.draft;
  return {
    setEntry: setters.setEntry,
    setSlOn: setters.setSlOn,
    setStopLoss: setters.setStopLoss,
    setTpOn: setters.setTpOn,
    setTakeProfit: setters.setTakeProfit,
    setStagedDragging: setters.setStagedDragging,
    setDragSlMoney: setters.setDragSlMoney,
  };
}

export type OrderTicketChartActions = Pick<TicketActions, 'clearStagedWidget' | 'unstageOrderDraft' | 'toggleExit'>;

export function useOrderTicketChartActions(): OrderTicketChartActions {
  const actions = useOrderTicketActions();
  return {
    clearStagedWidget: actions.clearStagedWidget,
    unstageOrderDraft: actions.unstageOrderDraft,
    toggleExit: actions.toggleExit,
  };
}
