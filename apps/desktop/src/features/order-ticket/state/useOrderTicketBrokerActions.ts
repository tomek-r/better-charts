import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketStores } from './orderTicketStores';
import { buildTicketDerivationInput } from '../domain/ticketDerivation';
import { useErrorNotification } from '../../../shared/ui/ErrorNotifications';

export function useOrderTicketBrokerActions(
  inputs: Pick<OrderTicketInputs, 'instrument' | 'account' | 'quote' | 'snapshot' | 'status'>,
  stores: OrderTicketStores,
  resetTicketToDefaults: () => void,
) {
  const { instrument, account, quote, snapshot, status } = inputs;
  const draft = useStore(
    stores.draft,
    useShallow((state) => ({
      draftVersion: state.draftVersion,
      riskSide: state.riskSide,
      entry: state.entry,
      stopLoss: state.stopLoss,
      takeProfit: state.takeProfit,
      equityAllocationPercent: state.equityAllocationPercent,
      orderKind: state.orderKind,
      timeInForce: state.timeInForce,
      limitPrice: state.limitPrice,
      unitsMode: state.unitsMode,
      tpOn: state.tpOn,
      slOn: state.slOn,
      stagedOnChart: state.stagedOnChart,
      orderVolume: state.orderVolume,
    })),
  );
  const broker = useStore(
    stores.broker,
    useShallow((state) => ({
      riskPreview: state.riskPreview,
      riskLoading: state.riskLoading,
      riskError: state.riskError,
      orderCheck: state.orderCheck,
      orderCheckLoading: state.orderCheckLoading,
      orderCheckError: state.orderCheckError,
      submittingSide: state.submittingSide,
      submitStatus: state.submitStatus,
    })),
  );
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
  const {
    riskVersion: riskVersionRef,
    pendingRiskRequestRef,
    orderCheckGeneration: orderCheckGenerationRef,
    orderCheckPending: orderCheckPendingRef,
    submitSwapPendingRef,
  } = stores.coordination;
  const setters = stores.setters;
  const { orderCheck, orderCheckLoading, submittingSide } = broker;
  const { riskSide, orderKind, timeInForce, slOn, tpOn } = draft;
  const {
    orderCheckEntry,
    orderCheckStopLoss,
    orderCheckTakeProfit,
    normalizedLimitPrice,
    effectiveVolume,
    canCheckOrder,
    canSubmitOrder,
  } = derived;

  useErrorNotification(broker.riskError);
  useErrorNotification(broker.orderCheckError);
  useErrorNotification(broker.submitStatus?.text);

  const requestOrderCheck = useEventCallback(async () => {
    if (!canCheckOrder || !snapshot.symbol || !account || orderCheckEntry === null) {
      return;
    }

    // The explicit draft can be newer than the last sizing response.
    const draftVersion = riskVersionRef.current;
    const generation = ++orderCheckGenerationRef.current;
    const pending = { generation, draftVersion, symbol: snapshot.symbol, accountLogin: account.accountLogin };
    orderCheckPendingRef.current = { ...pending, brokerServer: account.brokerServer };
    setters.broker.setOrderCheck(undefined);
    setters.broker.setOrderCheckError(undefined);
    setters.broker.setOrderCheckLoading(true);
    try {
      // Queue any debounced sizing first: a later sizing command would clear
      // the backend check. This also refreshes projections used after a drag.
      await pendingRiskRequestRef.current?.();
      if (orderCheckPendingRef.current?.generation !== generation) {
        return;
      }
      await invoke('request_order_check', {
        accountLogin: account.accountLogin,
        brokerServer: account.brokerServer,
        symbol: snapshot.symbol,
        side: riskSide,
        orderKind,
        volume: effectiveVolume,
        entry: orderCheckEntry,
        stopLoss: slOn ? orderCheckStopLoss : null,
        takeProfit: tpOn ? orderCheckTakeProfit : null,
        timeInForce,
        limitPrice: normalizedLimitPrice,
        draftVersion,
      });
    } catch {
      if (orderCheckPendingRef.current?.generation === generation) {
        orderCheckPendingRef.current = undefined;
        setters.broker.setOrderCheckLoading(false);
        setters.broker.setOrderCheckError('OrderCheck could not be requested.');
      }
    }
  });

  // Submit only the accepted check's draft, then keep its chart widget frozen until fill sync.
  const submitOrder = useEventCallback(async (side: typeof riskSide) => {
    const check = orderCheck;
    const currentAccount = account;
    if (!canSubmitOrder || !check?.draftId || !currentAccount || orderCheckEntry === null || submittingSide) {
      return;
    }
    setters.broker.setSubmittingSide(side);
    try {
      await invoke('submit_order', {
        draftId: check.draftId,
        accountLogin: currentAccount.accountLogin,
        brokerServer: currentAccount.brokerServer,
        symbol: snapshot.symbol,
        side,
        orderKind,
        volume: effectiveVolume,
        entry: orderCheckEntry,
        stopLoss: slOn ? orderCheckStopLoss : null,
        takeProfit: tpOn ? orderCheckTakeProfit : null,
        timeInForce,
        limitPrice: normalizedLimitPrice,
      });
      submitSwapPendingRef.current = true;
      setters.draft.setStagedOnChart(false);
      resetTicketToDefaults();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setters.broker.setSubmitStatus(
        /dispatch is disabled/i.test(text)
          ? { kind: 'locked', text: 'Dispatch locked — nothing was sent to MT5. Owner approval required.' }
          : { kind: 'error', text },
      );
    } finally {
      setters.broker.setSubmittingSide(undefined);
    }
  });

  const startOrderReview = useEventCallback(() => {
    if (!canCheckOrder || orderCheckLoading) {
      return;
    }
    setters.broker.setSubmitStatus(undefined);
    setters.draft.setTicketStage('review');
    void requestOrderCheck();
  });

  return { requestOrderCheck, submitOrder, startOrderReview };
}
