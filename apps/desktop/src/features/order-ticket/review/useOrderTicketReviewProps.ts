import type { ComponentProps } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useBridgeAccountSelector, useBridgeQuote } from '../../bridge/bridgeSelectors';
import { passedStopEntryGuidance } from '../pricing/passedStopEntry';
import { useOrderTicketActions, useOrderTicketStores } from '../draft/orderTicketContext';
import type { OrderTicketReview } from './OrderTicketReview';
import { useTicketGateProjection } from '../submit/useOrderTicketGates';

type ReviewProps = ComponentProps<typeof OrderTicketReview>;

export function useOrderTicketReviewProps(): ReviewProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const gate = useTicketGateProjection();
  const { currency, currencyDigits, marginCallLevel, stopOutLevel, marginLevelsUnit } = useBridgeAccountSelector(
    useShallow((account) => ({
      currency: account?.currency,
      currencyDigits: account?.currencyDigits,
      marginCallLevel: account?.marginCallLevel,
      stopOutLevel: account?.stopOutLevel,
      marginLevelsUnit: account?.marginLevelsUnit,
    })),
  );
  const orderCheck = useStore(stores.broker, (state) => state.orderCheck);
  const orderCheckError = useStore(stores.broker, (state) => state.orderCheckError);
  const orderCheckLoading = useStore(stores.broker, (state) => state.orderCheckLoading);
  const submitStatus = useStore(stores.broker, (state) => state.submitStatus);
  const submittingSide = useStore(stores.broker, (state) => state.submittingSide);
  const { riskSide, orderKind, entry } = useStore(
    stores.draft,
    useShallow((state) => ({ riskSide: state.riskSide, orderKind: state.orderKind, entry: state.entry })),
  );
  const quote = useBridgeQuote();
  const passedStopEntry = passedStopEntryGuidance({
    orderCheckError,
    orderKind,
    side: riskSide,
    entry,
    quote,
  });
  return {
    account:
      currency === undefined
        ? undefined
        : { currency, currencyDigits, marginCallLevel, stopOutLevel, marginLevelsUnit },
    canSubmitOrder: gate.canSubmitOrder,
    effectiveVolume: gate.effectiveVolume,
    orderCheck,
    orderCheckError,
    orderCheckLoading,
    localFigures: {
      entry: gate.orderCheckEntry,
      stopLoss: gate.orderCheckStopLoss,
      takeProfit: gate.orderCheckTakeProfit,
      volume: gate.effectiveVolume,
    },
    orderKindDisplay: gate.orderKindDisplay,
    passedStopEntry,
    ticketBlockedReason: gate.ticketBlockedReason,
    riskSide,
    setTicketStage: stores.setters.draft.setTicketStage,
    submitOrder: actions.submitOrder,
    submitStatus,
    submittingSide,
  };
}
