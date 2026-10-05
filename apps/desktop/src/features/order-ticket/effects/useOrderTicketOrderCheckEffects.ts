import { useEffect, useLayoutEffect } from 'react';
import type { OrderTicketState } from '../state/useOrderTicket';

// Effect slots (1) + (3): the OrderCheck reset [layout] and the §11 volume
// auto-fill [passive] register together at their former App slot — after the
// account-login sync, before the favorites/recent persistence effects — so
// both effect lists stay 1:1. Dep arrays frozen (identical expressions,
// identical position order to the former inline effects in App).
export function useOrderTicketOrderCheckEffects(
  ticket: Pick<
    OrderTicketState,
    | 'snapshot'
    | 'status'
    | 'account'
    | 'orderCheckGeneration'
    | 'orderCheckPending'
    | 'setOrderCheck'
    | 'setOrderCheckError'
    | 'setOrderCheckLoading'
    | 'setSubmitStatus'
    | 'setTicketStage'
    | 'riskSide'
    | 'entry'
    | 'stopLoss'
    | 'takeProfit'
    | 'riskAmount'
    | 'orderKind'
    | 'slOn'
    | 'tpOn'
    | 'limitPrice'
    | 'timeInForce'
    | 'unitsMode'
    | 'volumeManual'
    | 'riskPreview'
    | 'setOrderVolume'
    | 'riskVersion'
    | 'setStopLoss'
  >,
): void {
  const {
    snapshot,
    status,
    account,
    orderCheckGeneration,
    orderCheckPending,
    setOrderCheck,
    setOrderCheckError,
    setOrderCheckLoading,
    setSubmitStatus,
    setTicketStage,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    riskAmount,
    orderKind,
    slOn,
    tpOn,
    limitPrice,
    timeInForce,
    unitsMode,
    volumeManual,
    riskPreview,
    setOrderVolume,
    riskVersion,
    setStopLoss,
  } = ticket;
  const orderCheckGenerationRef = orderCheckGeneration;
  const orderCheckPendingRef = orderCheckPending;
  useLayoutEffect(() => {
    orderCheckGenerationRef.current += 1;
    orderCheckPendingRef.current = undefined;
    setOrderCheck(undefined);
    setOrderCheckError(undefined);
    setOrderCheckLoading(false);
    setSubmitStatus(undefined);
    setTicketStage('edit');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: refs/setters come from the hook return (stable identities); dep array frozen 1:1 with the former inline effect
  }, [
    snapshot.symbol,
    snapshot.timeframe,
    account?.accountLogin,
    account?.brokerServer,
    account?.currency,
    status.state,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    riskAmount,
    orderKind,
    slOn,
    tpOn,
    limitPrice,
    timeInForce,
    unitsMode,
  ]);
  // §11 volume auto-sync: mirror each NEW risk-sizing volume while the user has not
  // overridden the field. Deps track only the preview on purpose — re-running on
  // volumeManual would instantly refill a just-cleared field instead of letting the
  // user type a fresh volume (clearing is what returns the field to auto mode).
  useEffect(() => {
    if (
      riskPreview &&
      riskPreview.draftVersion === riskVersion.current &&
      riskPreview.symbol === snapshot.symbol &&
      riskPreview.side === riskSide &&
      slOn &&
      riskPreview.stopLoss !== stopLoss
    ) {
      // MT5 normalizes SL to the instrument's tick grid. Make that broker
      // value canonical so the ticket and chart do not alternate between the
      // typed level and the returned level.
      setStopLoss(riskPreview.stopLoss);
    }
    if (!volumeManual && riskPreview !== undefined) {
      setOrderVolume(riskPreview.volume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskPreview]);
}
