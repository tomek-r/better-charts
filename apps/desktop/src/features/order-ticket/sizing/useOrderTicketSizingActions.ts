import { useCallback } from 'react';
import type { BrokerSymbol, RiskSide } from '../../../shared/bridge/types';
import { defaultOrderVolume } from './defaultVolume';
import { clampRiskPercentInput } from './riskBasis';
import { orderEntryPrice } from '../derivation/ticketRules';
import type { OrderTicketStores } from '../draft/orderTicketStores';

export function useOrderTicketSizingActions(
  stores: OrderTicketStores,
  instrument: BrokerSymbol | undefined,
  enableRiskStopLoss: (side: RiskSide, entry: number, overwrite?: boolean) => string | undefined,
) {
  const setters = stores.setters.draft;
  const { unitsAutoMode: unitsAutoModeRef } = stores.coordination;

  const setRiskAmountFromInput = useCallback(
    (input: string) => {
      const { riskSide, stagedOnChart, unitsMode, orderKind, entry, limitPrice } = stores.draft.getState();
      const value = unitsMode === 'equity' ? clampRiskPercentInput(input) : input;
      setters.setRiskAmount(value);
      if (stagedOnChart && unitsMode !== 'units' && Number(value) > 0) {
        enableRiskStopLoss(riskSide, Number(orderEntryPrice(orderKind, entry, limitPrice)));
      }
    },
    [stores.draft, setters, enableRiskStopLoss],
  );

  const applyUnitsMode = useCallback(
    (mode: 'money' | 'equity' | 'units') => {
      const { unitsMode } = stores.draft.getState();
      if (mode !== unitsMode) {
        setters.setOrderVolume(defaultOrderVolume(instrument));
        setters.setVolumeManual(false);
        setters.setRiskAmount('');
        setters.setSlOn(false);
        setters.setTpOn(false);
        setters.setStopLoss('');
        setters.setTakeProfit('');
      }
      if (mode !== 'units') {
        unitsAutoModeRef.current = mode;
      }
      setters.setUnitsMode(mode);
    },
    [stores.draft, setters, unitsAutoModeRef, instrument],
  );

  return { setRiskAmountFromInput, applyUnitsMode };
}
