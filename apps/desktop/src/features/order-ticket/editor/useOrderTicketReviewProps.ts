import type { ComponentProps } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useBridgeAccountSelector } from '../../bridge/BridgeSessionProvider';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketReview } from '../review/OrderTicketReview';
import { useTicketGateProjection } from './useOrderTicketGates';

type ReviewProps = ComponentProps<typeof OrderTicketReview>;

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
