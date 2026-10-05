import { useCallback } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { BrokerSymbol, OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { quoteDigits, ticketPrice } from '../../../shared/format';
import type { OrderTicketBaseState } from './useOrderTicketState';

function defaultStopLossPrice(
  entry: number,
  side: RiskSide,
  orderKind: OrderKind,
  instrument: BrokerSymbol | undefined,
  quote: QuoteSnapshot | undefined,
): string | undefined {
  if (!Number.isFinite(entry) || entry <= 0) {
    return undefined;
  }
  const point = Number(instrument?.pointSize);
  const tick = Number(instrument?.tickSize);
  const known = Number.isFinite(point) && point > 0 && Number.isFinite(tick) && tick > 0;
  const minimum = known ? Math.max((instrument?.stopsLevel ?? 0) * point, 20 * tick) : entry * 0.001;
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const hasQuote = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0;
  let reference = entry;
  if (orderKind === 'market' && hasQuote) {
    reference = side === 'buy' ? bid : ask;
  }
  const direction = side === 'buy' ? -1 : 1;
  const digits = instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : 2);
  const step = known ? Math.max(tick, minimum * 0.25) : minimum * 0.25;
  let distance = known ? minimum + 2 * tick : minimum;
  for (let attempt = 0; attempt < 5; attempt++) {
    const stopLoss = ticketPrice(reference + direction * distance, digits);
    const actual = direction * (Number(stopLoss) - reference);
    if (stopLoss !== '' && Number(stopLoss) > 0 && actual > minimum) {
      return stopLoss;
    }
    distance += step;
  }
  return undefined;
}

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
    setSlOn(true);
    if (overwrite || !stopLoss.trim()) {
      const defaultStop = defaultStopLossPrice(entryPrice, side, orderKind, instrument, quote);
      if (defaultStop) {
        setStopLoss(defaultStop);
      }
    }
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
