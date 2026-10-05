import { useCallback } from 'react';
import type { RiskSide } from '../../../shared/bridge/types';
import { orderEntryPrice } from '../domain/ticketRules';
import type { OrderTicketBaseState } from './useOrderTicketState';

type SizingInput = Pick<
  OrderTicketBaseState,
  | 'riskSide'
  | 'setRiskAmount'
  | 'stagedOnChart'
  | 'unitsMode'
  | 'setUnitsMode'
  | 'orderKind'
  | 'entry'
  | 'limitPrice'
  | 'setOrderVolume'
  | 'setVolumeManual'
  | 'setSlOn'
  | 'setTpOn'
  | 'setStopLoss'
  | 'setTakeProfit'
  | 'unitsAutoMode'
> & { enableRiskStopLoss: (side: RiskSide, entry: number, overwrite?: boolean) => void };

export function useOrderTicketSizing(ticket: SizingInput) {
  const {
    riskSide,
    setRiskAmount,
    stagedOnChart,
    unitsMode,
    setUnitsMode,
    orderKind,
    entry,
    limitPrice,
    setOrderVolume,
    setVolumeManual,
    setSlOn,
    setTpOn,
    setStopLoss,
    setTakeProfit,
    unitsAutoMode,
    enableRiskStopLoss,
  } = ticket;
  const unitsAutoModeRef = unitsAutoMode;
  const setRiskAmountFromInput = useCallback(
    (value: string) => {
      setRiskAmount(value);
      if (stagedOnChart && unitsMode !== 'units' && Number(value) > 0) {
        enableRiskStopLoss(riskSide, Number(orderEntryPrice(orderKind, entry, limitPrice)));
      }
    },
    [stagedOnChart, unitsMode, enableRiskStopLoss, riskSide, orderKind, entry, limitPrice, setRiskAmount],
  );
  const applyUnitsMode = useCallback(
    (mode: 'money' | 'equity' | 'units') => {
      if (mode !== unitsMode) {
        setOrderVolume('1');
        setVolumeManual(false);
        setRiskAmount('');
        setSlOn(false);
        setTpOn(false);
        setStopLoss('');
        setTakeProfit('');
      }
      if (mode !== 'units') {
        unitsAutoModeRef.current = mode;
      }
      setUnitsMode(mode);
    },
    [
      unitsMode,
      setOrderVolume,
      setVolumeManual,
      setRiskAmount,
      setSlOn,
      setTpOn,
      setStopLoss,
      setTakeProfit,
      unitsAutoModeRef,
      setUnitsMode,
    ],
  );
  return { setRiskAmountFromInput, applyUnitsMode };
}
