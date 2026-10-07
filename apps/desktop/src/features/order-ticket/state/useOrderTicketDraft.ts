import { defaultStopLossPrice } from '../domain/defaultStopLoss';
import { useCallback } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import { useNotifyError } from '../../../shared/ui/ErrorNotifications';
import type { RiskSide } from '../../../shared/bridge/types';
import { ticketPrice } from '../../../shared/format';
import type { OrderTicketBaseState } from './useOrderTicketState';

type OrderTicketEntryDraftInput = Pick<
  OrderTicketBaseState,
  | 'chart'
  | 'stagedOrderState'
  | 'instrumentDigitsRef'
  | 'stagedActiveRef'
  | 'instrument'
  | 'snapshot'
  | 'quote'
  | 'riskSide'
  | 'setRiskSide'
  | 'entry'
  | 'setEntry'
  | 'stopLoss'
  | 'setStopLoss'
  | 'takeProfit'
  | 'setTakeProfit'
  | 'riskAmount'
  | 'setRiskAmount'
  | 'orderKind'
  | 'setOrderKind'
  | 'timeInForce'
  | 'setTimeInForce'
  | 'limitPrice'
  | 'setLimitPrice'
  | 'unitsMode'
  | 'setUnitsMode'
  | 'orderVolume'
  | 'setOrderVolume'
  | 'volumeManual'
  | 'setVolumeManual'
  | 'setSlOn'
  | 'setTpOn'
  | 'setSlUnit'
  | 'setTpUnit'
  | 'setPriceMode'
  | 'setPriceReference'
  | 'setPriceOffset'
  | 'setTicketStage'
  | 'stagedOnChart'
  | 'setStagedOnChart'
  | 'submitSwapPendingRef'
  | 'stagedPrevPriceRef'
>;

export function useOrderTicketDraft(ticket: OrderTicketEntryDraftInput) {
  const {
    chart,
    stagedOrderState,
    instrumentDigitsRef,
    stagedActiveRef,
    instrument,
    snapshot,
    quote,
    riskSide,
    setRiskSide,
    entry,
    setEntry,
    stopLoss,
    setStopLoss,
    setTakeProfit,
    riskAmount,
    setRiskAmount,
    orderKind,
    setOrderKind,
    setTimeInForce,
    setLimitPrice,
    unitsMode,
    setUnitsMode,
    orderVolume,
    setOrderVolume,
    setVolumeManual,
    setSlOn,
    setTpOn,
    setSlUnit,
    setTpUnit,
    setPriceMode,
    setPriceReference,
    setPriceOffset,
    setTicketStage,
    stagedOnChart,
    setStagedOnChart,
    submitSwapPendingRef,
    stagedPrevPriceRef,
  } = ticket;
  const notifyError = useNotifyError();
  const stagedOrderStateRef = stagedOrderState;
  const resetOrderDraft = useCallback(() => {
    setSlOn(false);
    setTpOn(false);
    setStopLoss('');
    setTakeProfit('');
    setEntry('');
  }, [setSlOn, setTpOn, setStopLoss, setTakeProfit, setEntry]);
  const resetTicketToDefaults = () => {
    resetOrderDraft();
    setRiskAmount('');
    setOrderKind('market');
    setLimitPrice('');
    setTimeInForce('gtc');
    setUnitsMode('units');
    setOrderVolume('1');
    setVolumeManual(false);
    setSlUnit('ticks');
    setTpUnit('ticks');
    setPriceMode('absolute');
    setPriceReference('ask');
    setPriceOffset('0');
    setTicketStage('edit');
  };
  const enableRiskStopLoss = useEventCallback((side: RiskSide, entryPrice: number, overwrite = false) => {
    if (!overwrite && stopLoss.trim()) {
      setSlOn(true);
      return stopLoss;
    }
    const defaultStop = defaultStopLossPrice(
      entryPrice,
      side,
      orderKind,
      instrument,
      quote,
      chart.current?.viewport().priceRange,
    );
    if (!defaultStop) {
      notifyError('No valid stop loss fits in the visible chart range. Zoom out or set SL manually.');
      return undefined;
    }
    setSlOn(true);
    setStopLoss(defaultStop);
    return defaultStop;
  });
  const stageOrderDraft = useCallback(
    (side: RiskSide, fresh = false) => {
      submitSwapPendingRef.current = false;
      if (snapshot.candles.length === 0) {
        return;
      }
      const digits = instrumentDigitsRef.current;
      let price = fresh ? NaN : Number(entry);
      if (!Number.isFinite(price) || price <= 0) {
        const fallback = quote
          ? Number(side === 'buy' ? quote.ask : quote.bid)
          : Number(snapshot.candles[snapshot.candles.length - 1]?.close);
        if (!Number.isFinite(fallback) || fallback <= 0) {
          return;
        }
        price = fallback;
        setEntry(ticketPrice(price, digits));
      }
      if (!orderVolume.trim()) {
        setOrderVolume('1');
      }
      if (unitsMode !== 'units' && Number(riskAmount) > 0 && (!stagedOnChart || fresh)) {
        enableRiskStopLoss(side, price, fresh);
      }
      setStagedOnChart(true);
    },
    [
      snapshot.candles,
      instrumentDigitsRef,
      entry,
      quote,
      orderVolume,
      unitsMode,
      riskAmount,
      stagedOnChart,
      enableRiskStopLoss,
      setEntry,
      setOrderVolume,
      setStagedOnChart,
      submitSwapPendingRef,
    ],
  );
  const clearStagedWidget = () => {
    const staged = stagedOrderStateRef.current;
    const had = staged.order !== null || staged.currentPrice !== undefined || staged.barCloseAt !== undefined;
    staged.order = null;
    staged.currentPrice = undefined;
    staged.barCloseAt = undefined;
    stagedPrevPriceRef.current = undefined;
    if (had) {
      chart.current?.refreshOverlays();
    }
    setStagedOnChart(false);
    return had;
  };
  const unstageOrderDraft = () => {
    const wasStaged = stagedActiveRef.current;
    submitSwapPendingRef.current = false;
    clearStagedWidget();
    if (wasStaged) {
      resetOrderDraft();
    }
  };
  const stageFromQuote = useCallback(
    (side: RiskSide) => {
      const switched = riskSide !== side;
      if (switched) {
        resetOrderDraft();
      }
      setRiskSide(side);
      stageOrderDraft(side, switched);
    },
    [riskSide, resetOrderDraft, stageOrderDraft, setRiskSide],
  );
  return {
    resetOrderDraft,
    resetTicketToDefaults,
    enableRiskStopLoss,
    stageOrderDraft,
    clearStagedWidget,
    unstageOrderDraft,
    stageFromQuote,
  };
}

export type OrderTicketDraft = ReturnType<typeof useOrderTicketDraft>;
