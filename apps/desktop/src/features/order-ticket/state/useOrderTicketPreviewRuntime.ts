import { useStore } from 'zustand';
import { deriveOrderRiskBasis } from '../domain/riskBasis';
import { stopDistanceGuard } from '../domain/ticketRules';
import type {
  OrderTicketRiskBasis,
  OrderTicketRiskPreviewEffectsInput,
} from '../effects/useOrderTicketRiskPreviewEffects';
import type { OrderTicketInputs } from './orderTicketInputs';
import { useOrderTicketStores } from './orderTicketContext';

export type OrderTicketPreviewRuntime = {
  input: OrderTicketRiskPreviewEffectsInput;
  riskBasis: OrderTicketRiskBasis;
};

export function useOrderTicketPreviewRuntime(
  inputs: Pick<OrderTicketInputs, 'snapshot' | 'status' | 'account' | 'instrument' | 'quote'>,
): OrderTicketPreviewRuntime {
  const stores = useOrderTicketStores();
  const draft = useStore(stores.draft);
  const draftSetters = stores.setters.draft;
  const brokerSetters = stores.setters.broker;
  const stopGuard = stopDistanceGuard(
    inputs.instrument,
    draft.riskSide,
    draft.entry,
    draft.slOn ? draft.stopLoss : '',
    draft.tpOn ? draft.takeProfit : '',
    inputs.quote,
    draft.orderKind,
    draft.limitPrice,
  );
  const riskBasis = deriveOrderRiskBasis({
    unitsMode: draft.unitsMode,
    riskAmount: draft.riskAmount,
    equity: inputs.account?.equity,
    equityAllocationPercent: draft.equityAllocationPercent,
    currency: inputs.account?.currency,
    currencyDigits: inputs.account?.currencyDigits,
    stagedOnChart: draft.stagedOnChart,
  });

  return {
    input: {
      snapshot: inputs.snapshot,
      status: inputs.status,
      account: inputs.account,
      riskSide: draft.riskSide,
      entry: draft.entry,
      orderKind: draft.orderKind,
      limitPrice: draft.limitPrice,
      stopLoss: draft.stopLoss,
      takeProfit: draft.takeProfit,
      equityAllocationPercent: draft.equityAllocationPercent,
      riskAmount: draft.riskAmount,
      slOn: draft.slOn,
      tpOn: draft.tpOn,
      ticketStage: draft.ticketStage,
      unitsMode: draft.unitsMode,
      volumeManual: draft.volumeManual,
      stopGuard,
      riskBrokerVersion: stores.coordination.riskBrokerVersion,
      riskPreviewDisplayRef: stores.coordination.riskPreviewDisplayRef,
      riskVersion: stores.coordination.riskVersion,
      pendingRiskRequestRef: stores.coordination.pendingRiskRequestRef,
      setRiskProjection: brokerSetters.setRiskProjection,
      setOrderVolume: draftSetters.setOrderVolume,
      setDraftVersion: draftSetters.setDraftVersion,
      setRiskPreview: brokerSetters.setRiskPreview,
      setRiskError: brokerSetters.setRiskError,
      setRiskLoading: brokerSetters.setRiskLoading,
    },
    riskBasis,
  };
}
