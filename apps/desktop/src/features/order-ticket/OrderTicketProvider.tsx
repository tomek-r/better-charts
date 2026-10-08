import { useMemo, useState, type ReactNode } from 'react';
import { useEventCallback } from '../../shared/hooks/useEventCallback';
import { OrderTicketStoresContext, type TicketActions } from './state/orderTicketContext';
import { createOrderTicketStores } from './state/orderTicketStores';
import { useOrderTicketActionsProducer } from './state/useOrderTicketActionsProducer';
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
  const ticketActions = useOrderTicketActionsProducer({
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

  const togglePriceMode = useEventCallback(ticketActions.togglePriceMode);
  const priceToTicks = useEventCallback(ticketActions.priceToTicks);
  const ticksToPrice = useEventCallback(ticketActions.ticksToPrice);
  const applyExitTicks = useEventCallback(ticketActions.applyExitTicks);
  const swapExitUnit = useEventCallback(ticketActions.swapExitUnit);
  const toggleExit = useEventCallback(ticketActions.toggleExit);
  const resetOrderDraft = useEventCallback(ticketActions.resetOrderDraft);
  const resetTicketToDefaults = useEventCallback(ticketActions.resetTicketToDefaults);
  const enableRiskStopLoss = useEventCallback(ticketActions.enableRiskStopLoss);
  const stageOrderDraft = useEventCallback(ticketActions.stageOrderDraft);
  const clearStagedWidget = useEventCallback(ticketActions.clearStagedWidget);
  const unstageOrderDraft = useEventCallback(ticketActions.unstageOrderDraft);
  const stageFromQuote = useEventCallback(ticketActions.stageFromQuote);
  const setRiskAmountFromInput = useEventCallback(ticketActions.setRiskAmountFromInput);
  const applyUnitsMode = useEventCallback(ticketActions.applyUnitsMode);
  const requestOrderCheck = useEventCallback(ticketActions.requestOrderCheck);
  const submitOrder = useEventCallback(ticketActions.submitOrder);
  const startOrderReview = useEventCallback(ticketActions.startOrderReview);
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
