import { useRef, useState } from 'react';
import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  MarketSnapshot,
  OrderCheckResult,
  OrderKind,
  QuoteSnapshot,
  RiskPreview,
  RiskSide,
  TimeInForce,
} from '../../../shared/bridge/types';
import type { ChartController } from '../../chart/engine/chartController';
import type { StagedOrderState } from '../../chart/engine/stagedOrderOverlay';
import { deriveOrderTicket } from '../domain/ticketRules';

export type OrderTicketStateParams = {
  chart: { current: ChartController | null };
  stagedOrderState: { current: StagedOrderState };
  instrumentDigitsRef: { current: number | undefined };
  stagedActiveRef: { current: boolean };
  instrument: BrokerSymbol | undefined;
  account: AccountSnapshot | undefined;
  quote: QuoteSnapshot | undefined;
  snapshot: MarketSnapshot;
  status: BridgeStatus;
};

export function useOrderTicketState(params: OrderTicketStateParams) {
  const { instrument, account, quote, snapshot, status } = params;
  // Keep a sent order's staged widget frozen until portfolio sync draws the fill.
  const submitSwapPendingRef = useRef(false);
  // The overlay mirror uses this for its light current-price repaint path.
  const stagedPrevPriceRef = useRef<number | undefined>(undefined);
  const riskVersion = useRef(0);
  const [draftVersion, setDraftVersion] = useState(0);
  const orderCheckGeneration = useRef(0);
  const orderCheckPending = useRef<
    { generation: number; draftVersion: number; symbol: string; accountLogin: string; brokerServer: string } | undefined
  >(undefined);
  const unitsAutoMode = useRef<'money' | 'equity'>('money');
  const [riskSide, setRiskSide] = useState<RiskSide>('');
  const [entry, setEntry] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [riskAmount, setRiskAmount] = useState('');
  const [riskPreview, setRiskPreview] = useState<RiskPreview>();
  // Keep the last broker quote available for chart labels while freshness clears the active preview.
  const riskPreviewDisplayRef = useRef<RiskPreview | undefined>(undefined);
  const [riskLoading, setRiskLoading] = useState(false);
  const [, setRiskError] = useState<string>();
  const [orderKind, setOrderKind] = useState<OrderKind>('market');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('gtc');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderCheck, setOrderCheck] = useState<OrderCheckResult>();
  const [orderCheckLoading, setOrderCheckLoading] = useState(false);
  const [orderCheckError, setOrderCheckError] = useState<string>();
  const [ticketStage, setTicketStage] = useState<'edit' | 'review'>('edit');
  const [priceMode, setPriceMode] = useState<'offset' | 'absolute'>('absolute');
  const [priceReference, setPriceReference] = useState<'ask' | 'bid' | 'last'>('ask');
  const [priceOffset, setPriceOffset] = useState('0');
  const [unitsMode, setUnitsMode] = useState<'money' | 'equity' | 'units'>('units');
  const [exitsOpen, setExitsOpen] = useState(true);
  const [extraSettingsOpen, setExtraSettingsOpen] = useState(false);
  const [tpOn, setTpOn] = useState(false);
  const [slOn, setSlOn] = useState(false);
  const [slUnit, setSlUnit] = useState<'ticks' | 'price'>('ticks');
  const [tpUnit, setTpUnit] = useState<'ticks' | 'price'>('ticks');
  const [stagedOnChart, setStagedOnChart] = useState(false);
  const [submittingSide, setSubmittingSide] = useState<RiskSide>();
  const [submitStatus, setSubmitStatus] = useState<{ kind: 'locked' | 'error'; text: string }>();
  const [orderVolume, setOrderVolume] = useState('1');
  const [volumeManual, setVolumeManual] = useState(false);
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
    riskPreview,
    setRiskPreview,
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
