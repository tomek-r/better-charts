import { invoke } from '@tauri-apps/api/core';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { OrderTicketBaseState } from './useOrderTicketState';
import type { OrderTicketDraft } from './useOrderTicketDraft';

type BrokerInput = Pick<
  OrderTicketBaseState,
  | 'canCheckOrder'
  | 'snapshot'
  | 'account'
  | 'orderCheckEntry'
  | 'riskVersion'
  | 'pendingRiskRequestRef'
  | 'orderCheckGeneration'
  | 'orderCheckPending'
  | 'setOrderCheck'
  | 'setOrderCheckError'
  | 'setOrderCheckLoading'
  | 'setSubmittingSide'
  | 'setSubmitStatus'
  | 'orderCheck'
  | 'canSubmitOrder'
  | 'submittingSide'
  | 'riskSide'
  | 'orderKind'
  | 'effectiveVolume'
  | 'slOn'
  | 'orderCheckStopLoss'
  | 'tpOn'
  | 'orderCheckTakeProfit'
  | 'timeInForce'
  | 'normalizedLimitPrice'
  | 'orderCheckLoading'
  | 'setTicketStage'
  | 'setStagedOnChart'
  | 'submitSwapPendingRef'
> &
  Pick<OrderTicketDraft, 'resetTicketToDefaults'>;

export function useOrderTicketBrokerActions(ticket: BrokerInput) {
  const {
    canCheckOrder,
    snapshot,
    account,
    orderCheckEntry,
    riskVersion,
    pendingRiskRequestRef,
    orderCheckGeneration: orderCheckGenerationRef,
    orderCheckPending: orderCheckPendingRef,
    setOrderCheck,
    setOrderCheckError,
    setOrderCheckLoading,
    setSubmittingSide,
    setSubmitStatus,
    orderCheck,
    canSubmitOrder,
    submittingSide,
    riskSide,
    orderKind,
    effectiveVolume,
    slOn,
    orderCheckStopLoss,
    tpOn,
    orderCheckTakeProfit,
    timeInForce,
    normalizedLimitPrice,
    resetTicketToDefaults,
    orderCheckLoading,
    setTicketStage,
    setStagedOnChart,
    submitSwapPendingRef,
  } = ticket;
  const requestOrderCheck = async () => {
    if (!canCheckOrder || !snapshot.symbol || !account || orderCheckEntry === null) {
      return;
    }
    // The explicit draft can be newer than the last sizing response.
    const draftVersion = riskVersion.current;
    const generation = ++orderCheckGenerationRef.current;
    const pending = { generation, draftVersion, symbol: snapshot.symbol, accountLogin: account.accountLogin };
    orderCheckPendingRef.current = { ...pending, brokerServer: account.brokerServer };
    setOrderCheck(undefined);
    setOrderCheckError(undefined);
    setOrderCheckLoading(true);
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
    } catch (error) {
      if (orderCheckPendingRef.current?.generation === generation) {
        orderCheckPendingRef.current = undefined;
        setOrderCheckLoading(false);
        setOrderCheckError('OrderCheck could not be requested.');
      }
      console.info('MT5 OrderCheck unavailable.', error);
    }
  };
  // Submit only the accepted check's draft, then keep its chart widget frozen until fill sync.
  const submitOrder = async (side: typeof riskSide) => {
    const check = orderCheck;
    const currentAccount = account;
    if (!canSubmitOrder || !check?.draftId || !currentAccount || orderCheckEntry === null || submittingSide) {
      return;
    }
    setSubmittingSide(side);
    console.info(`[submit-order] ${JSON.stringify({ side, symbol: snapshot.symbol, orderKind })}`);
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
      setStagedOnChart(false);
      resetTicketToDefaults();
      console.info(`[submit-order] submitted ${side} ${snapshot.symbol}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.info(`[submit-order] rejected ${text}`);
      setSubmitStatus(
        /dispatch is disabled/i.test(text)
          ? { kind: 'locked', text: 'Dispatch locked — nothing was sent to MT5. Owner approval required.' }
          : { kind: 'error', text },
      );
    } finally {
      setSubmittingSide(undefined);
    }
  };
  const startOrderReview = useEventCallback(() => {
    if (!canCheckOrder || orderCheckLoading) {
      return;
    }
    setSubmitStatus(undefined);
    setTicketStage('review');
    void requestOrderCheck();
  });
  return { requestOrderCheck, submitOrder, startOrderReview };
}
