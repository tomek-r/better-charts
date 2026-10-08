import { useStore } from 'zustand';
import type { OrderTicketOrderCheckEffectsInput } from '../effects/useOrderTicketOrderCheckEffects';
import type { OrderTicketInputs } from './orderTicketInputs';
import { useOrderTicketStores } from './orderTicketContext';

export function useOrderTicketCheckRuntime(
  inputs: Pick<OrderTicketInputs, 'snapshot' | 'status' | 'account'>,
): OrderTicketOrderCheckEffectsInput {
  const stores = useOrderTicketStores();
  const draft = useStore(stores.draft);
  const broker = useStore(stores.broker);
  const draftSetters = stores.setters.draft;
  const brokerSetters = stores.setters.broker;

  return {
    snapshot: inputs.snapshot,
    status: inputs.status,
    account: inputs.account,
    ticketStage: draft.ticketStage,
    riskSide: draft.riskSide,
    entry: draft.entry,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    equityAllocationPercent: draft.equityAllocationPercent,
    riskAmount: draft.riskAmount,
    orderKind: draft.orderKind,
    slOn: draft.slOn,
    tpOn: draft.tpOn,
    limitPrice: draft.limitPrice,
    timeInForce: draft.timeInForce,
    unitsMode: draft.unitsMode,
    volumeManual: draft.volumeManual,
    stagedDragging: draft.stagedDragging,
    orderCheckLoading: broker.orderCheckLoading,
    riskPreview: broker.riskPreview,
    orderCheckGeneration: stores.coordination.orderCheckGeneration,
    orderCheckPending: stores.coordination.orderCheckPending,
    riskVersion: stores.coordination.riskVersion,
    setOrderCheck: brokerSetters.setOrderCheck,
    setOrderCheckError: brokerSetters.setOrderCheckError,
    setOrderCheckLoading: brokerSetters.setOrderCheckLoading,
    setSubmitStatus: brokerSetters.setSubmitStatus,
    setTicketStage: draftSetters.setTicketStage,
    setOrderVolume: draftSetters.setOrderVolume,
    setStopLoss: draftSetters.setStopLoss,
  };
}
