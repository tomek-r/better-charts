import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useBridgeAccountSelector, useBridgeMarketSelector } from '../../bridge/bridgeSelectors';
import { deriveOrderRiskBasis } from './riskBasis';
import { orderVolumeIssue } from '../derivation/ticketRules';
import { useOrderTicketActions, useOrderTicketStores } from '../draft/orderTicketContext';
import type { OrderTicketSizingProps } from '../orderTicketEditorProps';

export function useOrderTicketSizingProps(): OrderTicketSizingProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const { currency, equity, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({
      currency: account?.currency,
      equity: account?.equity,
      currencyDigits: account?.currencyDigits,
    })),
  );
  const instrument = useBridgeMarketSelector((market) => market.instrument);
  const { unitsMode, orderVolume, equityAllocationPercent, riskAmount, stagedOnChart, slOn, stopLoss } = useStore(
    stores.draft,
    useShallow((state) => ({
      unitsMode: state.unitsMode,
      orderVolume: state.orderVolume,
      equityAllocationPercent: state.equityAllocationPercent,
      riskAmount: state.riskAmount,
      stagedOnChart: state.stagedOnChart,
      slOn: state.slOn,
      stopLoss: state.stopLoss,
    })),
  );
  const unitsAutoMode = stores.coordination.unitsAutoMode;
  const basis = deriveOrderRiskBasis({
    unitsMode,
    riskAmount,
    equity,
    equityAllocationPercent,
    currency,
    currencyDigits,
    stagedOnChart,
  });
  return {
    currency,
    instrument,
    unitsMode,
    orderVolume,
    setOrderVolume: stores.setters.draft.setOrderVolume,
    setVolumeManual: stores.setters.draft.setVolumeManual,
    equityAllocationPercent,
    setEquityAllocationPercent: stores.setters.draft.setEquityAllocationPercent,
    riskAmount,
    setRiskAmount: actions.setRiskAmountFromInput,
    applyUnitsMode: actions.applyUnitsMode,
    unitsAutoMode,
    volumeIssue: orderVolumeIssue(orderVolume, instrument),
    equityValue: basis.equityValue,
    riskModeHint: basis.riskModeHint,
    stagedOnChart,
    slOn,
    stopLoss,
  };
}
