import { useErrorNotification } from '../../../shared/ui/ErrorNotifications';
import { useDomainField } from '../../../shared/state/domainStore';
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
import { deriveOrderTicket } from '../domain/ticketRules';
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
  const [draftVersion, setDraftVersion] = useDomainField(stores.draft, 'draftVersion');
  const [riskSide, setRiskSide] = useDomainField(stores.draft, 'riskSide');
  const [entry, setEntry] = useDomainField(stores.draft, 'entry');
  const [stopLoss, setStopLoss] = useDomainField(stores.draft, 'stopLoss');
  const [takeProfit, setTakeProfit] = useDomainField(stores.draft, 'takeProfit');
  const [equityAllocationPercent, setEquityAllocationPercent] = useDomainField(stores.draft, 'equityAllocationPercent');
  const [riskAmount, setRiskAmount] = useDomainField(stores.draft, 'riskAmount');
  const [riskPreview, setRiskPreview] = useDomainField(stores.broker, 'riskPreview');
  const [riskProjection, setRiskProjection] = useDomainField(stores.broker, 'riskProjection');
  // Keep the last broker quote available for chart labels while freshness clears the active preview.
  const [riskLoading, setRiskLoading] = useDomainField(stores.broker, 'riskLoading');
  const [riskError, setRiskError] = useDomainField(stores.broker, 'riskError');
  const [orderKind, setOrderKind] = useDomainField(stores.draft, 'orderKind');
  const [timeInForce, setTimeInForce] = useDomainField(stores.draft, 'timeInForce');
  const [limitPrice, setLimitPrice] = useDomainField(stores.draft, 'limitPrice');
  const [orderCheck, setOrderCheck] = useDomainField(stores.broker, 'orderCheck');
  const [orderCheckLoading, setOrderCheckLoading] = useDomainField(stores.broker, 'orderCheckLoading');
  const [orderCheckError, setOrderCheckError] = useDomainField(stores.broker, 'orderCheckError');
  const [ticketStage, setTicketStage] = useDomainField(stores.draft, 'ticketStage');
  const [priceMode, setPriceMode] = useDomainField(stores.draft, 'priceMode');
  const [priceReference, setPriceReference] = useDomainField(stores.draft, 'priceReference');
  const [priceOffset, setPriceOffset] = useDomainField(stores.draft, 'priceOffset');
  const [unitsMode, setUnitsMode] = useDomainField(stores.draft, 'unitsMode');
  const [exitsOpen, setExitsOpen] = useDomainField(stores.editor, 'exitsOpen');
  const [extraSettingsOpen, setExtraSettingsOpen] = useDomainField(stores.editor, 'extraSettingsOpen');
  const [tpOn, setTpOn] = useDomainField(stores.draft, 'tpOn');
  const [slOn, setSlOn] = useDomainField(stores.draft, 'slOn');
  const [slUnit, setSlUnit] = useDomainField(stores.draft, 'slUnit');
  const [tpUnit, setTpUnit] = useDomainField(stores.draft, 'tpUnit');
  const [stagedOnChart, setStagedOnChart] = useDomainField(stores.draft, 'stagedOnChart');
  const [stagedDragging, setStagedDragging] = useDomainField(stores.draft, 'stagedDragging');
  const [dragSlMoney, setDragSlMoney] = useDomainField(stores.draft, 'dragSlMoney');
  const [submittingSide, setSubmittingSide] = useDomainField(stores.broker, 'submittingSide');
  const [submitStatus, setSubmitStatus] = useDomainField(stores.broker, 'submitStatus');
  const [orderVolume, setOrderVolume] = useDomainField(stores.draft, 'orderVolume');
  const [volumeManual, setVolumeManual] = useDomainField(stores.draft, 'volumeManual');
  useErrorNotification(riskError);
  useErrorNotification(orderCheckError);
  useErrorNotification(submitStatus?.text);
  // Ticket fields stay canonical for check/submit; risk preview enhances sizing and risk estimates.
  const derived = deriveOrderTicket({
    symbol: snapshot.symbol,
    bridgeState: status.state,
    account,
    stagedOnChart,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    orderKind,
    limitPrice,
    timeInForce,
    unitsMode,
    equityAllocationPercent,
    orderVolume,
    orderCheck,
    riskPreview,
    draftVersion,
    riskLoading,
    instrument,
    quote,
    marketOpen: status.marketSession?.isOpen,
  });
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
