import { useCallback } from 'react';
import type { RiskSide } from '../../../shared/bridge/types';
import { orderEntryPrice } from '../domain/ticketRules';
import type { OrderTicketBaseState } from './useOrderTicketState';

type SizingInput = Pick<
  OrderTicketBaseState,
  | 'riskSide'
  | 'orderVolume'
  | 'stopLoss'
  | 'riskStopIntentRef'
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
> & { enableRiskStopLoss: (side: RiskSide, entry: number, overwrite?: boolean) => string | undefined };

export function useOrderTicketSizing(ticket: SizingInput) {
  const {
    riskSide,
    orderVolume,
    stopLoss,
    riskStopIntentRef,
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
        const seed = enableRiskStopLoss(riskSide, Number(orderEntryPrice(orderKind, entry, limitPrice)));
        riskStopIntentRef.current = seed
          ? {
              volume: riskStopIntentRef.current?.volume ?? orderVolume,
              stopLoss: stopLoss.trim() ? stopLoss : seed,
              seedStopLoss: seed,
              riskAmount: value,
              fitted: false,
            }
          : undefined;
      } else {
        riskStopIntentRef.current = undefined;
      }
    },
    [
      stagedOnChart,
      unitsMode,
      enableRiskStopLoss,
      riskSide,
      orderKind,
      entry,
      limitPrice,
      setRiskAmount,
      orderVolume,
      stopLoss,
      riskStopIntentRef,
    ],
  );
  const applyUnitsMode = useCallback(
    (mode: 'money' | 'equity' | 'units') => {
      if (mode !== unitsMode) {
        riskStopIntentRef.current = undefined;
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
      riskStopIntentRef,
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
