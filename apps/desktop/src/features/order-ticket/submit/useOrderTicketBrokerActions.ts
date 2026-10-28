import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { errorText } from '../../../shared/errorText';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { OrderTicketInputs } from '../draft/orderTicketInputs';
import type { OrderTicketStores } from '../draft/orderTicketStores';
import type { RiskSide } from '../../../shared/bridge/types';
import { dispatchStatusFromError } from '../../execution/dispatchStatus';
import {
  buildTicketDerivationInput,
  selectTicketDerivationBroker,
  selectTicketDerivationDraft,
} from '../derivation/ticketDerivation';
import { usePassedStopEntry } from '../pricing/usePassedStopEntry';
import { ORDER_CHECK_REQUEST_FAILED, withoutStopLossTooClose } from '../orderCheck/orderCheckErrors';
import { useErrorNotification } from '../../../shared/ui/notification/ErrorNotifications';

export function useOrderTicketBrokerActions(
  inputs: Pick<OrderTicketInputs, 'instrument' | 'account' | 'quote' | 'snapshot' | 'status'>,
  stores: OrderTicketStores,
  resetTicketToDefaults: () => void,
) {
  const { instrument, account, quote, snapshot, status } = inputs;
  const draft = useStore(stores.draft, useShallow(selectTicketDerivationDraft));
  const derivationBroker = useStore(stores.broker, useShallow(selectTicketDerivationBroker));
  const { riskError, orderCheckLoading, submittingSide, submitStatus } = useStore(
    stores.broker,
    useShallow((state) => ({
      riskError: state.riskError,
      orderCheckLoading: state.orderCheckLoading,
      submittingSide: state.submittingSide,
      submitStatus: state.submitStatus,
    })),
  );
  const orderCheckError = useStore(stores.broker, (state) => state.orderCheckError);
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
      derivationBroker,
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
  const { orderCheck } = derivationBroker;
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

  useErrorNotification(withoutStopLossTooClose(riskError));
  // The review notification carries the specific "price moved past your stop entry" guidance.
  const passedStopEntry = usePassedStopEntry(stores, quote);
  useErrorNotification(passedStopEntry ? undefined : withoutStopLossTooClose(orderCheckError));
  useErrorNotification(submitStatus?.text);

  // Fields the check and the submit command both carry, in wire order.
  const orderWireFields = (side: RiskSide) => ({
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
        ...orderWireFields(riskSide),
        draftVersion,
      });
    } catch (error) {
      if (orderCheckPendingRef.current?.generation === generation) {
        orderCheckPendingRef.current = undefined;
        setters.broker.setOrderCheckLoading(false);
        const reason = errorText(error).trim();
        setters.broker.setOrderCheckError(
          reason ? `${ORDER_CHECK_REQUEST_FAILED}: ${reason}` : `${ORDER_CHECK_REQUEST_FAILED}.`,
        );
      }
    }
  });

  // Submit only the accepted check's draft, then keep its chart widget frozen until fill sync.
  const submitOrder = useEventCallback(async (side: RiskSide) => {
    if (!canSubmitOrder || !orderCheck?.draftId || !account || orderCheckEntry === null || submittingSide) {
      return;
    }
    setters.broker.setSubmittingSide(side);
    try {
      await invoke('submit_order', {
        draftId: orderCheck.draftId,
        accountLogin: account.accountLogin,
        brokerServer: account.brokerServer,
        ...orderWireFields(side),
      });
      submitSwapPendingRef.current = true;
      setters.draft.setStagedOnChart(false);
      resetTicketToDefaults();
    } catch (error) {
      setters.broker.setSubmitStatus(dispatchStatusFromError(errorText(error)));
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
