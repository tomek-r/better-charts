import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react';
import { useOrderTicket, type OrderTicketState } from './state/useOrderTicket';
import { deriveQuotePresentation } from '../../shared/format';
import { accountMoneyBasis } from '../../shared/money';
import { OrderTicketReview } from './review/OrderTicketReview';
import {
  useBridgeAccount,
  useBridgeConnection,
  useBridgeMarket,
  useBridgeQuote,
} from '../bridge/BridgeSessionProvider';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { deriveOrderRiskBasis, type OrderRiskBasis } from './domain/riskBasis';
import { accountEnvironment } from './domain/ticketFormatting';
import type {
  OrderTicketActionProps,
  OrderTicketExitsProps,
  OrderTicketExtraSettingsProps,
  OrderTicketPricingProps,
  OrderTicketQuoteProps,
  OrderTicketSizingProps,
  OrderTicketTickValueProps,
} from './editor/orderTicketEditorTypes';

const OrderTicketContext = createContext<OrderTicketState | null>(null);
type HeaderEnvironment = ReturnType<typeof accountEnvironment>;
type HeaderState = { environment: HeaderEnvironment | undefined; symbol: string | undefined };
type ReviewProps = ComponentProps<typeof OrderTicketReview>;
const HeaderContext = createContext<HeaderState | null>(null);
const RiskBasisContext = createContext<OrderRiskBasis | null>(null);
const StageContext = createContext<'edit' | 'review' | null>(null);
const ReviewContext = createContext<ReviewProps | null>(null);
const QuoteContext = createContext<OrderTicketQuoteProps | null>(null);
const PricingContext = createContext<OrderTicketPricingProps | null>(null);
const SizingContext = createContext<OrderTicketSizingProps | null>(null);
const TickValueContext = createContext<OrderTicketTickValueProps | null>(null);
const ExitsContext = createContext<OrderTicketExitsProps | null>(null);
const ExtraSettingsContext = createContext<OrderTicketExtraSettingsProps | null>(null);
const ActionContext = createContext<OrderTicketActionProps | null>(null);

export function OrderTicketProvider({ children }: { children: ReactNode }) {
  const { chart, stagedOrderState, instrumentDigitsRef, stagedActiveRef } = useChartResources();
  const { instrument, snapshot, latestCandle } = useBridgeMarket();
  const quote = useBridgeQuote();
  const account = useBridgeAccount();
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
  });
  const accountPresent = account !== undefined;
  const { kind: environmentKind, label: environmentLabel, title: environmentTitle } = accountEnvironment(account);
  const symbol = snapshot.symbol;
  const header = useMemo<HeaderState>(
    () => ({
      symbol,
      environment: accountPresent
        ? { kind: environmentKind, label: environmentLabel, title: environmentTitle }
        : undefined,
    }),
    [symbol, accountPresent, environmentKind, environmentLabel, environmentTitle],
  );
  const basis = useMemo(
    () =>
      deriveOrderRiskBasis({
        unitsMode: ticket.unitsMode,
        riskAmount: ticket.riskAmount,
        equity: account?.equity,
        equityAllocationPercent: ticket.equityAllocationPercent,
        currency: account?.currency,
        currencyDigits: account?.currencyDigits,
        stagedOnChart: ticket.stagedOnChart,
      }),
    [
      ticket.unitsMode,
      ticket.riskAmount,
      ticket.equityAllocationPercent,
      account?.equity,
      account?.currency,
      account?.currencyDigits,
      ticket.stagedOnChart,
    ],
  );
  const { bidText, askText, spreadText, spreadPoints } = deriveQuotePresentation(quote, instrument?.pointSize);
  const tickValueRaw =
    accountMoneyBasis(instrument, account?.currency, account?.currencyDigits)?.tickValueProfit ?? NaN;
  const tickValueText =
    Number.isFinite(tickValueRaw) && tickValueRaw > 0 ? String(Number(tickValueRaw.toPrecision(8))) : '—';
  const limitPriceNum = Number(ticket.limitPrice.trim());
  const limitPriceMisaligned =
    ticket.limitPriceValid &&
    ticket.orderKind === 'stop_limit' &&
    ticket.tickKnown &&
    Math.abs(limitPriceNum / ticket.tickSize - Math.round(limitPriceNum / ticket.tickSize)) > 1e-6;
  let priceSwapTitle: string;
  if (ticket.priceMode === 'offset') {
    priceSwapTitle = 'Enter an absolute price';
  } else if (ticket.orderKind === 'market') {
    priceSwapTitle = 'Market orders follow the quote — no offset';
  } else if (!quote) {
    priceSwapTitle = 'Offset needs a live quote';
  } else if (!ticket.tickKnown) {
    priceSwapTitle = 'Tick size unknown — offset conversion unavailable';
  } else {
    priceSwapTitle = 'Enter a price offset from the reference';
  }
  const review = useMemo<ReviewProps>(
    () => ({
      account,
      canSubmitOrder: ticket.canSubmitOrder,
      effectiveVolume: ticket.effectiveVolume,
      orderCheck: ticket.orderCheck,
      orderCheckError: ticket.orderCheckError,
      orderCheckLoading: ticket.orderCheckLoading,
      orderKindDisplay: ticket.orderKindDisplay,
      ticketBlockedReason: ticket.ticketBlockedReason,
      riskSide: ticket.riskSide,
      setTicketStage: ticket.setTicketStage,
      submitOrder: ticket.submitOrder,
      submitStatus: ticket.submitStatus,
      submittingSide: ticket.submittingSide,
    }),
    [
      account,
      ticket.canSubmitOrder,
      ticket.effectiveVolume,
      ticket.orderCheck,
      ticket.orderCheckError,
      ticket.orderCheckLoading,
      ticket.orderKindDisplay,
      ticket.ticketBlockedReason,
      ticket.riskSide,
      ticket.setTicketStage,
      ticket.submitOrder,
      ticket.submitStatus,
      ticket.submittingSide,
    ],
  );
  const quoteProps = useMemo<OrderTicketQuoteProps>(
    () => ({
      bidText,
      askText,
      spreadText,
      spreadPoints,
      side: ticket.riskSide,
      stageFromQuote: ticket.stageFromQuote,
    }),
    [bidText, askText, spreadText, spreadPoints, ticket.riskSide, ticket.stageFromQuote],
  );
  const hasQuote = quote !== undefined;
  const pricingProps = useMemo<OrderTicketPricingProps>(
    () => ({
      instrument,
      orderKind: ticket.orderKind,
      setOrderKind: ticket.setOrderKind,
      entry: ticket.entry,
      setEntry: ticket.setEntry,
      priceMode: ticket.priceMode,
      priceOffset: ticket.priceOffset,
      setPriceOffset: ticket.setPriceOffset,
      priceReference: ticket.priceReference,
      setPriceReference: ticket.setPriceReference,
      priceSwapDisabled: ticket.priceSwapDisabled,
      priceSwapTitle,
      togglePriceMode: ticket.togglePriceMode,
      limitPrice: ticket.limitPrice,
      setLimitPrice: ticket.setLimitPrice,
      limitPriceValid: ticket.limitPriceValid,
      limitPriceMisaligned,
      side: ticket.riskSide,
      hasQuote,
    }),
    [
      instrument,
      ticket.orderKind,
      ticket.setOrderKind,
      ticket.entry,
      ticket.setEntry,
      ticket.priceMode,
      ticket.priceOffset,
      ticket.setPriceOffset,
      ticket.priceReference,
      ticket.setPriceReference,
      ticket.priceSwapDisabled,
      priceSwapTitle,
      ticket.togglePriceMode,
      ticket.limitPrice,
      ticket.setLimitPrice,
      ticket.limitPriceValid,
      limitPriceMisaligned,
      ticket.riskSide,
      hasQuote,
    ],
  );
  const sizingProps = useMemo<OrderTicketSizingProps>(
    () => ({
      currency: account?.currency,
      unitsMode: ticket.unitsMode,
      orderVolume: ticket.orderVolume,
      setOrderVolume: ticket.setOrderVolume,
      setVolumeManual: ticket.setVolumeManual,
      equityAllocationPercent: ticket.equityAllocationPercent,
      setEquityAllocationPercent: ticket.setEquityAllocationPercent,
      riskAmount: ticket.riskAmount,
      setRiskAmount: ticket.setRiskAmountFromInput,
      applyUnitsMode: ticket.applyUnitsMode,
      unitsAutoMode: ticket.unitsAutoMode,
      volumeIssue: ticket.volumeIssue,
      equityValue: basis.equityValue,
      riskModeHint: basis.riskModeHint,
      stagedOnChart: ticket.stagedOnChart,
      slOn: ticket.slOn,
      stopLoss: ticket.stopLoss,
    }),
    [
      account?.currency,
      ticket.unitsMode,
      ticket.orderVolume,
      ticket.setOrderVolume,
      ticket.setVolumeManual,
      ticket.equityAllocationPercent,
      ticket.setEquityAllocationPercent,
      ticket.riskAmount,
      ticket.setRiskAmountFromInput,
      ticket.applyUnitsMode,
      ticket.unitsAutoMode,
      ticket.volumeIssue,
      basis.equityValue,
      basis.riskModeHint,
      ticket.stagedOnChart,
      ticket.slOn,
      ticket.stopLoss,
    ],
  );
  const hasInstrument = instrument !== undefined;
  const currency = account?.currency;
  const tickValueProps = useMemo<OrderTicketTickValueProps>(
    () => ({ hasInstrument, tickValueText, currency }),
    [hasInstrument, tickValueText, currency],
  );
  const slTooClose = ticket.stagedOnChart && Boolean(ticket.stopGuard?.slTooClose);
  const tpTooClose = ticket.stagedOnChart && Boolean(ticket.stopGuard?.tpTooClose);
  const tpTicksView = ticket.priceToTicks(ticket.takeProfit, 'tp');
  const slTicksView = ticket.priceToTicks(ticket.stopLoss, 'sl');
  const riskRewardLabel = ticket.display.riskRewardLabel;
  const exitsProps = useMemo<OrderTicketExitsProps>(
    () => ({
      riskRewardLabel,
      open: ticket.exitsOpen,
      setOpen: ticket.setExitsOpen,
      slTooClose,
      tpTooClose,
      tickKnown: ticket.tickKnown,
      tpOn: ticket.tpOn,
      slOn: ticket.slOn,
      tpUnit: ticket.tpUnit,
      slUnit: ticket.slUnit,
      tpTicksView,
      slTicksView,
      takeProfit: ticket.takeProfit,
      setTakeProfit: ticket.setTakeProfit,
      stopLoss: ticket.stopLoss,
      setStopLoss: ticket.setStopLoss,
      toggleExit: ticket.toggleExit,
      applyExitTicks: ticket.applyExitTicks,
      swapExitUnit: ticket.swapExitUnit,
      side: ticket.riskSide,
      orderKind: ticket.orderKind,
      entry: ticket.entry,
      limitPrice: ticket.limitPrice,
      stagedOnChart: ticket.stagedOnChart,
    }),
    [
      riskRewardLabel,
      ticket.exitsOpen,
      ticket.setExitsOpen,
      slTooClose,
      tpTooClose,
      ticket.tickKnown,
      ticket.tpOn,
      ticket.slOn,
      ticket.tpUnit,
      ticket.slUnit,
      tpTicksView,
      slTicksView,
      ticket.takeProfit,
      ticket.stopLoss,
      ticket.setTakeProfit,
      ticket.setStopLoss,
      ticket.toggleExit,
      ticket.applyExitTicks,
      ticket.swapExitUnit,
      ticket.riskSide,
      ticket.orderKind,
      ticket.entry,
      ticket.limitPrice,
      ticket.stagedOnChart,
    ],
  );
  const extraSettingsProps = useMemo<OrderTicketExtraSettingsProps>(
    () => ({
      open: ticket.extraSettingsOpen,
      setOpen: ticket.setExtraSettingsOpen,
      timeInForce: ticket.timeInForce,
      setTimeInForce: ticket.setTimeInForce,
    }),
    [ticket.extraSettingsOpen, ticket.setExtraSettingsOpen, ticket.timeInForce, ticket.setTimeInForce],
  );
  const actionProps = useMemo<OrderTicketActionProps>(
    () => ({
      canCheckOrder: ticket.canCheckOrder,
      orderCheckLoading: ticket.orderCheckLoading,
      startOrderReview: ticket.startOrderReview,
      side: ticket.riskSide,
    }),
    [ticket.canCheckOrder, ticket.orderCheckLoading, ticket.startOrderReview, ticket.riskSide],
  );

  return (
    <OrderTicketContext.Provider value={ticket}>
      <HeaderContext.Provider value={header}>
        <RiskBasisContext.Provider value={basis}>
          <StageContext.Provider value={ticket.ticketStage}>
            <ReviewContext.Provider value={review}>
              <QuoteContext.Provider value={quoteProps}>
                <PricingContext.Provider value={pricingProps}>
                  <SizingContext.Provider value={sizingProps}>
                    <TickValueContext.Provider value={tickValueProps}>
                      <ExitsContext.Provider value={exitsProps}>
                        <ExtraSettingsContext.Provider value={extraSettingsProps}>
                          <ActionContext.Provider value={actionProps}>{children}</ActionContext.Provider>
                        </ExtraSettingsContext.Provider>
                      </ExitsContext.Provider>
                    </TickValueContext.Provider>
                  </SizingContext.Provider>
                </PricingContext.Provider>
              </QuoteContext.Provider>
            </ReviewContext.Provider>
          </StageContext.Provider>
        </RiskBasisContext.Provider>
      </HeaderContext.Provider>
    </OrderTicketContext.Provider>
  );
}

function useRequiredOrderTicket(): OrderTicketState {
  const ticket = useContext(OrderTicketContext);
  if (ticket === null) {
    throw new Error('Order ticket hooks must be used inside OrderTicketProvider.');
  }
  return ticket;
}

/** Full ticket state for lifecycle integrations and effect-slot registration. */
export function useOrderTicketRuntime(): OrderTicketState {
  return useRequiredOrderTicket();
}

export function useOrderTicketHeader(): HeaderState {
  const value = useContext(HeaderContext);
  if (value === null) {
    throw new Error('Order ticket hooks must be used inside OrderTicketProvider.');
  }
  return value;
}

export function useOrderTicketStage(): 'edit' | 'review' {
  const value = useContext(StageContext);
  if (value === null) {
    throw new Error('Order ticket hooks must be used inside OrderTicketProvider.');
  }
  return value;
}

export function useOrderTicketReviewProps(): ReviewProps {
  const value = useContext(ReviewContext);
  if (value === null) {
    throw new Error('Order ticket hooks must be used inside OrderTicketProvider.');
  }
  return value;
}

export function useOrderTicketQuotes(): OrderTicketQuoteProps {
  const value = useContext(QuoteContext);
  if (value === null) {
    throw new Error('Order ticket hooks must be used inside OrderTicketProvider.');
  }
  return value;
}

function useEditorContext<T>(value: T | null, hookName: string): T {
  if (value === null) {
    throw new Error(`${hookName} must be used inside OrderTicketProvider.`);
  }
  return value;
}

export function useOrderTicketPricing(): OrderTicketPricingProps {
  return useEditorContext(useContext(PricingContext), 'useOrderTicketPricing');
}

export function useOrderTicketSizing(): OrderTicketSizingProps {
  return useEditorContext(useContext(SizingContext), 'useOrderTicketSizing');
}

export function useOrderTicketExits(): OrderTicketExitsProps {
  return useEditorContext(useContext(ExitsContext), 'useOrderTicketExits');
}

export function useOrderTicketExtraSettings(): OrderTicketExtraSettingsProps {
  return useEditorContext(useContext(ExtraSettingsContext), 'useOrderTicketExtraSettings');
}

export function useOrderTicketAction(): OrderTicketActionProps {
  return useEditorContext(useContext(ActionContext), 'useOrderTicketAction');
}

export function useOrderRiskBasis(): OrderRiskBasis {
  const value = useContext(RiskBasisContext);
  if (value === null) {
    throw new Error('useOrderRiskBasis must be used inside OrderTicketProvider.');
  }
  return value;
}

export function useOrderTicketTickValue(): OrderTicketTickValueProps {
  return useEditorContext(useContext(TickValueContext), 'useOrderTicketTickValue');
}
