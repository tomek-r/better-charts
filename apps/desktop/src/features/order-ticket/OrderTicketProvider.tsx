import { createContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useRequiredContext } from '../../shared/state/useRequiredContext';
import { deriveQuotePresentation } from '../../shared/format';
import { accountMoneyBasis } from '../../shared/money';
import { useEventCallback } from '../../shared/hooks/useEventCallback';
import { OrderTicketReview } from './review/OrderTicketReview';
import {
  useBridgeAccountSelector,
  useBridgeConnection,
  useBridgeConnectionSelector,
  useBridgeMarketSelector,
  useBridgeQuote,
  useBridgeQuoteSelector,
} from '../bridge/BridgeSessionProvider';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { deriveOrderRiskBasis, type OrderRiskBasis } from './domain/riskBasis';
import { orderVolumeIssue, deriveOrderTicket, stopDistanceGuard } from './domain/ticketRules';
import { deriveStagedOrderDisplay } from './domain/stagedOrderDisplay';
import { accountEnvironment } from './domain/ticketFormatting';
import { priceToTicks } from './state/useOrderTicketPricing';
import type {
  OrderTicketActionProps,
  OrderTicketExitsProps,
  OrderTicketExtraSettingsProps,
  OrderTicketPricingProps,
  OrderTicketQuoteProps,
  OrderTicketSizingProps,
  OrderTicketTickValueProps,
} from './editor/orderTicketEditorTypes';
import { createOrderTicketStores, type OrderTicketStores } from './state/orderTicketStores';
import { useOrderTicket, type OrderTicketState } from './state/useOrderTicket';

type HeaderEnvironment = ReturnType<typeof accountEnvironment>;
type HeaderState = { environment: HeaderEnvironment | undefined; symbol: string | undefined };
type ReviewProps = ComponentProps<typeof OrderTicketReview>;
type TicketActions = Pick<
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

const OrderTicketStoresContext = createContext<TicketInjection | null>(null);

export function OrderTicketProvider({ children }: { children: ReactNode }) {
  const [stores] = useState(createOrderTicketStores);
  const { chart, stagedOrderState, instrumentDigitsRef, stagedActiveRef } = useChartResources();
  const { instrument, snapshot, latestCandle } = useBridgeMarketSelector((market) => market);
  const quote = useBridgeQuote();
  const account = useBridgeAccountSelector((value) => value);
  const { status } = useBridgeConnection();
  const ticket = useOrderTicket({
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
    stores,
  });

  const togglePriceMode = useEventCallback(ticket.togglePriceMode);
  const priceToTicks = useEventCallback(ticket.priceToTicks);
  const ticksToPrice = useEventCallback(ticket.ticksToPrice);
  const applyExitTicks = useEventCallback(ticket.applyExitTicks);
  const swapExitUnit = useEventCallback(ticket.swapExitUnit);
  const toggleExit = useEventCallback(ticket.toggleExit);
  const resetOrderDraft = useEventCallback(ticket.resetOrderDraft);
  const resetTicketToDefaults = useEventCallback(ticket.resetTicketToDefaults);
  const enableRiskStopLoss = useEventCallback(ticket.enableRiskStopLoss);
  const stageOrderDraft = useEventCallback(ticket.stageOrderDraft);
  const clearStagedWidget = useEventCallback(ticket.clearStagedWidget);
  const unstageOrderDraft = useEventCallback(ticket.unstageOrderDraft);
  const stageFromQuote = useEventCallback(ticket.stageFromQuote);
  const setRiskAmountFromInput = useEventCallback(ticket.setRiskAmountFromInput);
  const applyUnitsMode = useEventCallback(ticket.applyUnitsMode);
  const requestOrderCheck = useEventCallback(ticket.requestOrderCheck);
  const submitOrder = useEventCallback(ticket.submitOrder);
  const startOrderReview = useEventCallback(ticket.startOrderReview);
  const actions = useMemo<TicketActions>(
    () => ({
      togglePriceMode,
      priceToTicks,
      ticksToPrice,
      applyExitTicks,
      swapExitUnit,
      toggleExit,
      resetOrderDraft,
      resetTicketToDefaults,
      enableRiskStopLoss,
      stageOrderDraft,
      clearStagedWidget,
      unstageOrderDraft,
      stageFromQuote,
      setRiskAmountFromInput,
      applyUnitsMode,
      requestOrderCheck,
      submitOrder,
      startOrderReview,
    }),
    [
      togglePriceMode,
      priceToTicks,
      ticksToPrice,
      applyExitTicks,
      swapExitUnit,
      toggleExit,
      resetOrderDraft,
      resetTicketToDefaults,
      enableRiskStopLoss,
      stageOrderDraft,
      clearStagedWidget,
      unstageOrderDraft,
      stageFromQuote,
      setRiskAmountFromInput,
      applyUnitsMode,
      requestOrderCheck,
      submitOrder,
      startOrderReview,
    ],
  );
  const injection = useMemo(() => ({ stores, actions }), [stores, actions]);

  return <OrderTicketStoresContext value={injection}>{children}</OrderTicketStoresContext>;
}

export function useOrderTicketStores(): OrderTicketStores {
  return useRequiredContext(OrderTicketStoresContext, 'Order ticket hooks must be used inside OrderTicketProvider.')
    .stores;
}

function useOrderTicketActions(): TicketActions {
  return useRequiredContext(OrderTicketStoresContext, 'Order ticket hooks must be used inside OrderTicketProvider.')
    .actions;
}

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

export function useOrderTicketHeader(): HeaderState {
  const { symbol } = useBridgeMarketSelector((market) => ({ symbol: market.snapshot.symbol }));
  const accountPresent = useBridgeAccountSelector((account) => account !== undefined);
  const { tradeModeName, tradeMode, accountLogin, brokerServer } = useBridgeAccountSelector(
    useShallow((account) => ({
      tradeModeName: account?.accountTradeModeName,
      tradeMode: account?.accountTradeMode,
      accountLogin: account?.accountLogin,
      brokerServer: account?.brokerServer,
    })),
  );
  const environment = accountPresent
    ? accountEnvironment({
        accountLogin,
        brokerServer,
        accountTradeModeName: tradeModeName,
        accountTradeMode: tradeMode,
      })
    : undefined;
  return { environment, symbol };
}

export function useOrderTicketStage(): 'edit' | 'review' {
  const { draft } = useOrderTicketStores();
  return useStore(draft, (state) => state.ticketStage);
}

export function useOrderTicketReviewProps(): ReviewProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const gate = useTicketGateProjection();
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const orderCheck = useStore(stores.broker, (state) => state.orderCheck);
  const orderCheckError = useStore(stores.broker, (state) => state.orderCheckError);
  const orderCheckLoading = useStore(stores.broker, (state) => state.orderCheckLoading);
  const submitStatus = useStore(stores.broker, (state) => state.submitStatus);
  const submittingSide = useStore(stores.broker, (state) => state.submittingSide);
  const { riskSide } = useStore(
    stores.draft,
    useShallow((state) => ({ riskSide: state.riskSide })),
  );
  return {
    account: currency === undefined ? undefined : { currency, currencyDigits },
    canSubmitOrder: gate.canSubmitOrder,
    effectiveVolume: gate.effectiveVolume,
    orderCheck,
    orderCheckError,
    orderCheckLoading,
    orderKindDisplay: gate.orderKindDisplay,
    ticketBlockedReason: gate.ticketBlockedReason,
    riskSide,
    setTicketStage: stores.setters.draft.setTicketStage,
    submitOrder: actions.submitOrder,
    submitStatus,
    submittingSide,
  };
}

function useTicketGateProjection() {
  const stores = useOrderTicketStores();
  const { symbol, instrument } = useBridgeMarketSelector((market) => ({
    symbol: market.snapshot.symbol,
    instrument: market.instrument,
  }));
  const { bridgeState, marketOpen } = useBridgeConnectionSelector(
    useShallow((connection) => ({
      bridgeState: connection.status.state,
      marketOpen: connection.status.marketSession?.isOpen,
    })),
  );
  const { accountLogin, brokerServer } = useBridgeAccountSelector(
    useShallow((account) => ({ accountLogin: account?.accountLogin, brokerServer: account?.brokerServer })),
  );
  const draft = useStore(
    stores.draft,
    useShallow((state) => ({
      stagedOnChart: state.stagedOnChart,
      riskSide: state.riskSide,
      entry: state.entry,
      stopLoss: state.stopLoss,
      takeProfit: state.takeProfit,
      slOn: state.slOn,
      tpOn: state.tpOn,
      orderKind: state.orderKind,
      limitPrice: state.limitPrice,
      timeInForce: state.timeInForce,
      unitsMode: state.unitsMode,
      equityAllocationPercent: state.equityAllocationPercent,
      orderVolume: state.orderVolume,
      draftVersion: state.draftVersion,
    })),
  );
  const quote = useBridgeQuoteSelector((value) =>
    draft.stagedOnChart && draft.orderKind === 'market' ? value : undefined,
  );
  const { orderCheck, riskPreview, riskLoading } = useStore(
    stores.broker,
    useShallow((state) => ({
      orderCheck: state.orderCheck,
      riskPreview: state.riskPreview,
      riskLoading: state.riskLoading,
    })),
  );
  return deriveOrderTicket({
    symbol,
    bridgeState,
    account: accountLogin === undefined ? undefined : { accountLogin, brokerServer },
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
    orderCheck,
    riskPreview,
    draftVersion: draft.draftVersion,
    riskLoading,
    instrument,
    quote,
    marketOpen,
  });
}

export function useOrderTicketQuotes(): OrderTicketQuoteProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const pointSize = useBridgeMarketSelector((market) => market.instrument?.pointSize);
  const side = useStore(stores.draft, (state) => state.riskSide);
  const { bidText, askText, spreadText, spreadPoints } = useBridgeQuoteSelector(
    useShallow((quote) => deriveQuotePresentation(quote, pointSize)),
  );
  return { bidText, askText, spreadText, spreadPoints, side, stageFromQuote: actions.stageFromQuote };
}

export function useOrderTicketPricing(): OrderTicketPricingProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const instrument = useBridgeMarketSelector((market) => market.instrument);
  const hasQuote = useBridgeQuoteSelector((quote) => quote !== undefined);
  const { orderKind, entry, priceMode, priceOffset, priceReference, limitPrice, side } = useStore(
    stores.draft,
    useShallow((state) => ({
      orderKind: state.orderKind,
      entry: state.entry,
      priceMode: state.priceMode,
      priceOffset: state.priceOffset,
      priceReference: state.priceReference,
      limitPrice: state.limitPrice,
      side: state.riskSide,
    })),
  );
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled = orderKind === 'market' || (priceMode === 'absolute' && (!hasQuote || !tickKnown));
  let priceSwapTitle: string;
  if (priceMode === 'offset') {
    priceSwapTitle = 'Enter an absolute price';
  } else if (orderKind === 'market') {
    priceSwapTitle = 'Market orders follow the quote — no offset';
  } else if (!hasQuote) {
    priceSwapTitle = 'Offset needs a live quote';
  } else if (!tickKnown) {
    priceSwapTitle = 'Tick size unknown — offset conversion unavailable';
  } else {
    priceSwapTitle = 'Enter a price offset from the reference';
  }
  const limitPriceNum = Number(limitPrice.trim());
  const limitPriceValid =
    orderKind !== 'stop_limit' || (limitPrice.trim() !== '' && Number.isFinite(limitPriceNum) && limitPriceNum > 0);
  const limitPriceMisaligned =
    limitPriceValid &&
    orderKind === 'stop_limit' &&
    tickKnown &&
    Math.abs(limitPriceNum / tickSize - Math.round(limitPriceNum / tickSize)) > 1e-6;
  return {
    instrument,
    orderKind,
    setOrderKind: stores.setters.draft.setOrderKind,
    entry,
    setEntry: stores.setters.draft.setEntry,
    priceMode,
    priceOffset,
    setPriceOffset: stores.setters.draft.setPriceOffset,
    priceReference,
    setPriceReference: stores.setters.draft.setPriceReference,
    priceSwapDisabled,
    priceSwapTitle,
    togglePriceMode: actions.togglePriceMode,
    limitPrice,
    setLimitPrice: stores.setters.draft.setLimitPrice,
    limitPriceValid,
    limitPriceMisaligned,
    side,
    hasQuote,
  };
}

export function useOrderTicketSizing(): OrderTicketSizingProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const { currency, equity, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({
      currency: account?.currency,
      equity: account?.equity,
      currencyDigits: account?.currencyDigits,
    })),
  );
  const instrument = useBridgeMarketSelector((market) => market.instrument);
  const { unitsMode, orderVolume, equityAllocationPercent, riskAmount, stagedOnChart, slOn, stopLoss } = useStore(
    stores.draft,
    useShallow((state) => ({
      unitsMode: state.unitsMode,
      orderVolume: state.orderVolume,
      equityAllocationPercent: state.equityAllocationPercent,
      riskAmount: state.riskAmount,
      stagedOnChart: state.stagedOnChart,
      slOn: state.slOn,
      stopLoss: state.stopLoss,
    })),
  );
  const unitsAutoMode = stores.coordination.unitsAutoMode;
  const basis = deriveOrderRiskBasis({
    unitsMode,
    riskAmount,
    equity,
    equityAllocationPercent,
    currency,
    currencyDigits,
    stagedOnChart,
  });
  return {
    currency,
    unitsMode,
    orderVolume,
    setOrderVolume: stores.setters.draft.setOrderVolume,
    setVolumeManual: stores.setters.draft.setVolumeManual,
    equityAllocationPercent,
    setEquityAllocationPercent: stores.setters.draft.setEquityAllocationPercent,
    riskAmount,
    setRiskAmount: actions.setRiskAmountFromInput,
    applyUnitsMode: actions.applyUnitsMode,
    unitsAutoMode,
    volumeIssue: orderVolumeIssue(orderVolume, instrument),
    equityValue: basis.equityValue,
    riskModeHint: basis.riskModeHint,
    stagedOnChart,
    slOn,
    stopLoss,
  };
}

export function useOrderTicketExits(): OrderTicketExitsProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const { instrument, symbol } = useBridgeMarketSelector((market) => ({
    instrument: market.instrument,
    symbol: market.snapshot.symbol,
  }));
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const {
    riskSide,
    entry,
    limitPrice,
    orderKind,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    unitsMode,
    orderVolume,
    draftVersion,
    stagedOnChart,
    tpUnit,
    slUnit,
  } = useStore(
    stores.draft,
    useShallow((state) => ({
      riskSide: state.riskSide,
      entry: state.entry,
      limitPrice: state.limitPrice,
      orderKind: state.orderKind,
      stopLoss: state.stopLoss,
      takeProfit: state.takeProfit,
      slOn: state.slOn,
      tpOn: state.tpOn,
      unitsMode: state.unitsMode,
      orderVolume: state.orderVolume,
      draftVersion: state.draftVersion,
      stagedOnChart: state.stagedOnChart,
      tpUnit: state.tpUnit,
      slUnit: state.slUnit,
    })),
  );
  const { riskPreview, riskProjection } = useStore(
    stores.broker,
    useShallow((state) => ({ riskPreview: state.riskPreview, riskProjection: state.riskProjection })),
  );
  const quote = useBridgeQuoteSelector((value) => (stagedOnChart && orderKind === 'market' ? value : undefined));
  const exitsOpen = useStore(stores.editor, (state) => state.exitsOpen);
  const effectiveVolume = orderVolume.trim();
  const account = currency === undefined ? undefined : { currency, currencyDigits };
  const display = deriveStagedOrderDisplay({
    instrument,
    account,
    snapshot: { symbol },
    riskSide,
    entry,
    limitPrice,
    orderKind,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    effectiveVolume,
    unitsMode,
    riskPreview,
    draftVersion,
    lastPreview:
      riskProjection?.draftVersion === draftVersion
        ? riskProjection
        : stores.coordination.riskPreviewDisplayRef.current,
  });
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const stopGuard = stopDistanceGuard(
    instrument,
    riskSide,
    entry,
    slOn ? stopLoss : '',
    tpOn ? takeProfit : '',
    quote,
    orderKind,
    limitPrice,
  );
  return {
    riskRewardLabel: display.riskRewardLabel,
    open: exitsOpen,
    setOpen: stores.setters.editor.setExitsOpen,
    slTooClose: stagedOnChart && Boolean(stopGuard?.slTooClose),
    tpTooClose: stagedOnChart && Boolean(stopGuard?.tpTooClose),
    tickKnown,
    tpOn,
    slOn,
    tpUnit,
    slUnit,
    tpTicksView: priceToTicks(takeProfit, tickKnown, orderKind, entry, limitPrice, tickSize),
    slTicksView: priceToTicks(stopLoss, tickKnown, orderKind, entry, limitPrice, tickSize),
    takeProfit,
    setTakeProfit: stores.setters.draft.setTakeProfit,
    stopLoss,
    setStopLoss: stores.setters.draft.setStopLoss,
    toggleExit: actions.toggleExit,
    applyExitTicks: actions.applyExitTicks,
    swapExitUnit: actions.swapExitUnit,
    side: riskSide,
    orderKind,
    entry,
    limitPrice,
    stagedOnChart,
  };
}

export function useOrderTicketExtraSettings(): OrderTicketExtraSettingsProps {
  const stores = useOrderTicketStores();
  const open = useStore(stores.editor, (state) => state.extraSettingsOpen);
  const timeInForce = useStore(stores.draft, (state) => state.timeInForce);
  return {
    open,
    setOpen: stores.setters.editor.setExtraSettingsOpen,
    timeInForce,
    setTimeInForce: stores.setters.draft.setTimeInForce,
  };
}

export function useOrderTicketAction(): OrderTicketActionProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const gate = useTicketGateProjection();
  const orderCheckLoading = useStore(stores.broker, (state) => state.orderCheckLoading);
  const side = useStore(stores.draft, (state) => state.riskSide);
  return {
    canCheckOrder: gate.canCheckOrder,
    orderCheckLoading,
    startOrderReview: actions.startOrderReview,
    side,
  };
}

export function useOrderRiskBasis(): OrderRiskBasis {
  const stores = useOrderTicketStores();
  const { accountEquity, currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({
      accountEquity: account?.equity,
      currency: account?.currency,
      currencyDigits: account?.currencyDigits,
    })),
  );
  const { unitsMode, riskAmount, equityAllocationPercent, stagedOnChart } = useStore(
    stores.draft,
    useShallow((state) => ({
      unitsMode: state.unitsMode,
      riskAmount: state.riskAmount,
      equityAllocationPercent: state.equityAllocationPercent,
      stagedOnChart: state.stagedOnChart,
    })),
  );
  return deriveOrderRiskBasis({
    unitsMode,
    riskAmount,
    equity: accountEquity,
    equityAllocationPercent,
    currency,
    currencyDigits,
    stagedOnChart,
  });
}

export function useOrderTicketTickValue(): OrderTicketTickValueProps {
  const { instrument } = useBridgeMarketSelector((market) => ({ instrument: market.instrument }));
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const tickValueRaw = accountMoneyBasis(instrument, currency, currencyDigits)?.tickValueProfit ?? NaN;
  const tickValueText =
    Number.isFinite(tickValueRaw) && tickValueRaw > 0 ? String(Number(tickValueRaw.toPrecision(8))) : '—';
  return { hasInstrument: instrument !== undefined, tickValueText, currency };
}
