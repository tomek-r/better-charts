import { useErrorNotification } from '../../../shared/ui/ErrorNotifications';
import { useStore } from 'zustand';
import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  Candle,
  MarketSnapshot,
  QuoteSnapshot,
} from '../../../shared/bridge/types';
import type { ChartController } from '../../chart/engine/chartController';
import type { StagedOrderState } from '../../chart/engine/stagedOrderOverlay';
import { buildTicketDerivationInput } from '../domain/ticketDerivation';
import type { OrderTicketStores } from './orderTicketStores';

export type OrderTicketStateParams = {
  chart: { current: ChartController | null };
  stagedOrderState: { current: StagedOrderState };
  instrumentDigitsRef: { current: number | undefined };
  stagedActiveRef: { current: boolean };
  instrument: BrokerSymbol | undefined;
  account: AccountSnapshot | undefined;
  quote: QuoteSnapshot | undefined;
  snapshot: MarketSnapshot;
  latestCandle: Candle | undefined;
  status: BridgeStatus;
};

export function useOrderTicketState(params: OrderTicketStateParams, stores: OrderTicketStores) {
  const { instrument, account, quote, snapshot, status } = params;
  const {
    submitSwapPendingRef,
    stagedPrevPriceRef,
    riskVersion,
    pendingRiskRequestRef,
    orderCheckGeneration,
    orderCheckPending,
    unitsAutoMode,
    riskBrokerVersion,
    riskPreviewDisplayRef,
  } = stores.coordination;
  const draft = useStore(stores.draft);
  // Keep the last broker quote available for chart labels while freshness clears the active preview.
  const broker = useStore(stores.broker);
  const editor = useStore(stores.editor);
  const {
    draftVersion,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    equityAllocationPercent,
    riskAmount,
    orderKind,
    timeInForce,
    limitPrice,
    ticketStage,
    priceMode,
    priceReference,
    priceOffset,
    unitsMode,
    tpOn,
    slOn,
    slUnit,
    tpUnit,
    stagedOnChart,
    stagedDragging,
    dragSlMoney,
    orderVolume,
    volumeManual,
  } = draft;
  const {
    riskPreview,
    riskProjection,
    riskLoading,
    riskError,
    orderCheck,
    orderCheckLoading,
    orderCheckError,
    submittingSide,
    submitStatus,
  } = broker;
  const { exitsOpen, extraSettingsOpen } = editor;
  const {
    setDraftVersion,
    setRiskSide,
    setEntry,
    setStopLoss,
    setTakeProfit,
    setEquityAllocationPercent,
    setRiskAmount,
    setOrderKind,
    setTimeInForce,
    setLimitPrice,
    setTicketStage,
    setPriceMode,
    setPriceReference,
    setPriceOffset,
    setUnitsMode,
    setTpOn,
    setSlOn,
    setSlUnit,
    setTpUnit,
    setStagedOnChart,
    setStagedDragging,
    setDragSlMoney,
    setOrderVolume,
    setVolumeManual,
  } = stores.setters.draft;
  const {
    setRiskPreview,
    setRiskProjection,
    setRiskLoading,
    setRiskError,
    setOrderCheck,
    setOrderCheckLoading,
    setOrderCheckError,
    setSubmittingSide,
    setSubmitStatus,
  } = stores.setters.broker;
  const { setExitsOpen, setExtraSettingsOpen } = stores.setters.editor;
  useErrorNotification(riskError);
  useErrorNotification(orderCheckError);
  useErrorNotification(submitStatus?.text);
  // Ticket fields stay canonical for check/submit; risk preview enhances sizing and risk estimates.
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
  return {
    ...params,
    submitSwapPendingRef,
    stagedPrevPriceRef,
    riskVersion,
    pendingRiskRequestRef,
    draftVersion,
    setDraftVersion,
    orderCheckGeneration,
    orderCheckPending,
    unitsAutoMode,
    riskSide,
    setRiskSide,
    entry,
    setEntry,
    stopLoss,
    setStopLoss,
    takeProfit,
    setTakeProfit,
    riskAmount,
    setRiskAmount,
    equityAllocationPercent,
    setEquityAllocationPercent,
    riskPreview,
    setRiskPreview,
    riskProjection,
    setRiskProjection,
    riskBrokerVersion,
    riskPreviewDisplayRef,
    riskLoading,
    setRiskLoading,
    setRiskError,
    orderKind,
    setOrderKind,
    timeInForce,
    setTimeInForce,
    limitPrice,
    setLimitPrice,
    orderCheck,
    setOrderCheck,
    orderCheckLoading,
    setOrderCheckLoading,
    orderCheckError,
    setOrderCheckError,
    ticketStage,
    setTicketStage,
    priceMode,
    setPriceMode,
    priceReference,
    setPriceReference,
    priceOffset,
    setPriceOffset,
    unitsMode,
    setUnitsMode,
    exitsOpen,
    setExitsOpen,
    extraSettingsOpen,
    setExtraSettingsOpen,
    tpOn,
    setTpOn,
    slOn,
    setSlOn,
    slUnit,
    setSlUnit,
    tpUnit,
    setTpUnit,
    stagedOnChart,
    setStagedOnChart,
    stagedDragging,
    setStagedDragging,
    dragSlMoney,
    setDragSlMoney,
    submittingSide,
    setSubmittingSide,
    submitStatus,
    setSubmitStatus,
    orderVolume,
    setOrderVolume,
    volumeManual,
    setVolumeManual,
    ...derived,
  };
}

export type OrderTicketBaseState = ReturnType<typeof useOrderTicketState>;
