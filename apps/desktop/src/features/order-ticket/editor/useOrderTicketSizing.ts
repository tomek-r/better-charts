import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { accountMoneyBasis } from '../../../shared/money';
import { useBridgeAccountSelector, useBridgeMarketSelector } from '../../bridge/BridgeSessionProvider';
import { deriveOrderRiskBasis, type OrderRiskBasis } from '../domain/riskBasis';
import { orderVolumeIssue } from '../domain/ticketRules';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketSizingProps, OrderTicketTickValueProps } from './orderTicketEditorTypes';

export function useOrderTicketSizing(): OrderTicketSizingProps {
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

export function useOrderRiskBasis(): OrderRiskBasis {
  const stores = useOrderTicketStores();
  const { accountEquity, currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({
      accountEquity: account?.equity,
      currency: account?.currency,
      currencyDigits: account?.currencyDigits,
    })),
  );
  const { unitsMode, riskAmount, equityAllocationPercent, stagedOnChart } = useStore(
    stores.draft,
    useShallow((state) => ({
      unitsMode: state.unitsMode,
      riskAmount: state.riskAmount,
      equityAllocationPercent: state.equityAllocationPercent,
      stagedOnChart: state.stagedOnChart,
    })),
  );
  return deriveOrderRiskBasis({
    unitsMode,
    riskAmount,
    equity: accountEquity,
    equityAllocationPercent,
    currency,
    currencyDigits,
    stagedOnChart,
  });
}

export function useOrderTicketTickValue(): OrderTicketTickValueProps {
  const { instrument } = useBridgeMarketSelector((market) => ({ instrument: market.instrument }));
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const tickValueRaw = accountMoneyBasis(instrument, currency, currencyDigits)?.tickValueProfit ?? NaN;
  const tickValueText =
    Number.isFinite(tickValueRaw) && tickValueRaw > 0 ? String(Number(tickValueRaw.toPrecision(8))) : '—';
  return { hasInstrument: instrument !== undefined, tickValueText, currency };
}
