import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { RiskSide } from '../../../shared/bridge/types';
import { clampRiskPercentInput } from '../domain/riskBasis';
import { orderEntryPrice } from '../domain/ticketRules';
import type { OrderTicketStores } from './orderTicketStores';

export function useOrderTicketSizing(
  stores: OrderTicketStores,
  enableRiskStopLoss: (side: RiskSide, entry: number, overwrite?: boolean) => string | undefined,
) {
  const { riskSide, stagedOnChart, unitsMode, orderKind, entry, limitPrice } = useStore(
    stores.draft,
    useShallow((draft) => ({
      riskSide: draft.riskSide,
      stagedOnChart: draft.stagedOnChart,
      unitsMode: draft.unitsMode,
      orderKind: draft.orderKind,
      entry: draft.entry,
      limitPrice: draft.limitPrice,
    })),
  );
  const setters = stores.setters.draft;
  const { unitsAutoMode: unitsAutoModeRef } = stores.coordination;

  const setRiskAmountFromInput = useCallback(
    (input: string) => {
      const value = unitsMode === 'equity' ? clampRiskPercentInput(input) : input;
      setters.setRiskAmount(value);
      if (stagedOnChart && unitsMode !== 'units' && Number(value) > 0) {
        enableRiskStopLoss(riskSide, Number(orderEntryPrice(orderKind, entry, limitPrice)));
      }
    },
    [unitsMode, setters, stagedOnChart, enableRiskStopLoss, riskSide, orderKind, entry, limitPrice],
  );

  const applyUnitsMode = useCallback(
    (mode: 'money' | 'equity' | 'units') => {
      if (mode !== unitsMode) {
        setters.setOrderVolume('1');
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
    [unitsMode, setters, unitsAutoModeRef],
  );

  return { setRiskAmountFromInput, applyUnitsMode };
}
