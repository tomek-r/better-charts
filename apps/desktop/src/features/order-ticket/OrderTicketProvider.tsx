import { useMemo, useState, type ReactNode } from 'react';
import { useEventCallback } from '../../shared/hooks/useEventCallback';
import { OrderTicketStoresContext, type TicketActions } from './state/orderTicketContext';
import { createOrderTicketStores } from './state/orderTicketStores';
import { useOrderTicket } from './state/useOrderTicket';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import {
  useBridgeAccountSelector,
  useBridgeConnection,
  useBridgeMarketSelector,
  useBridgeQuote,
} from '../bridge/BridgeSessionProvider';

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
