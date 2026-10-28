import { useCallback } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { RiskSide } from '../../../shared/bridge/types';
import { quoteDigits, ticketPrice } from '../../../shared/format';
import { useNotifyError } from '../../../shared/ui/notification/ErrorNotifications';
import { defaultStopLossPrice } from '../domain/defaultStopLoss';
import { defaultOrderVolume } from '../domain/defaultVolume';
import { flipExits, sideReference } from '../domain/sideFlip';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketDraftStore, OrderTicketStores } from './orderTicketStores';

type DraftInputs = Pick<
  OrderTicketInputs,
  | 'chart'
  | 'stagedOrderState'
  | 'instrumentDigitsRef'
  | 'stagedActiveRef'
  | 'instrument'
  | 'snapshot'
  | 'latestCandle'
  | 'quote'
>;

export function useOrderTicketDraft(inputs: DraftInputs, stores: OrderTicketStores) {
  const { chart, stagedOrderState, instrumentDigitsRef, stagedActiveRef, instrument, snapshot, latestCandle, quote } =
    inputs;
  const stagedOrderStateRef = stagedOrderState;
  const setters = stores.setters.draft;
  const notifyError = useNotifyError();
  const { submitSwapPendingRef, stagedPrevPriceRef } = stores.coordination;

  // Side flip: symbol-info may not have arrived yet, so the quote text carries the precision;
  // the entry and exits must share it or the market-follow effect sees a nonzero delta.
  const ticketDigits = useCallback(
    () => instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : instrumentDigitsRef.current),
    [instrument, quote, instrumentDigitsRef],
  );

  const resetOrderDraft = useCallback(() => {
    setters.setSlOn(false);
    setters.setTpOn(false);
    setters.setStopLoss('');
    setters.setTakeProfit('');
    setters.setEntry('');
  }, [setters]);

  const resetTicketToDefaults = useCallback(() => {
    resetOrderDraft();
    setters.setRiskSide('');
    setters.setRiskAmount('');
    setters.setOrderKind('market');
    setters.setLimitPrice('');
    setters.setTimeInForce('gtc');
    setters.setUnitsMode('units');
    setters.setOrderVolume(defaultOrderVolume(instrument));
    setters.setVolumeManual(false);
    setters.setSlUnit('ticks');
    setters.setTpUnit('ticks');
    setters.setPriceMode('absolute');
    setters.setPriceReference('ask');
    setters.setPriceOffset('0');
    setters.setTicketStage('edit');
  }, [resetOrderDraft, setters, instrument]);

  const enableRiskStopLossForDraft = useCallback(
    (draft: OrderTicketDraftStore, side: RiskSide, entryPrice: number, overwrite = false) => {
      if (!overwrite && draft.stopLoss.trim()) {
        setters.setSlOn(true);
        return draft.stopLoss;
      }
      const defaultStop = defaultStopLossPrice(
        entryPrice,
        side,
        draft.orderKind,
        instrument,
        quote,
        chart.current?.viewport().priceRange,
      );
      if (!defaultStop) {
        notifyError('No valid stop loss fits in the visible chart range. Zoom out or set SL manually.');
        return undefined;
      }
      setters.setSlOn(true);
      setters.setStopLoss(defaultStop);
      return defaultStop;
    },
    [setters, instrument, quote, chart, notifyError],
  );
  const enableRiskStopLoss = useEventCallback((side: RiskSide, entryPrice: number, overwrite: boolean = false) =>
    enableRiskStopLossForDraft(stores.draft.getState(), side, entryPrice, overwrite),
  );

  const stageOrderDraft = useCallback(
    (side: RiskSide, fresh = false) => {
      submitSwapPendingRef.current = false;
      if (snapshot.candles.length === 0 && !latestCandle) {
        return;
      }

      const draft = stores.draft.getState();
      const digits = instrumentDigitsRef.current;
      let price = fresh ? NaN : Number(draft.entry);
      if (!Number.isFinite(price) || price <= 0) {
        const fallback = quote
          ? Number(side === 'buy' ? quote.ask : quote.bid)
          : Number(latestCandle?.close ?? snapshot.candles[snapshot.candles.length - 1]?.close);
        if (!Number.isFinite(fallback) || fallback <= 0) {
          return;
        }
        price = fallback;
        setters.setEntry(ticketPrice(price, digits));
      }
      if (!draft.orderVolume.trim()) {
        setters.setOrderVolume(defaultOrderVolume(instrument));
      }
      if (draft.unitsMode !== 'units' && Number(draft.riskAmount) > 0 && (!draft.stagedOnChart || fresh)) {
        enableRiskStopLossForDraft(draft, side, price, fresh);
      }
      setters.setStagedOnChart(true);
    },
    [
      snapshot.candles,
      latestCandle,
      instrumentDigitsRef,
      quote,
      instrument,
      stores.draft,
      enableRiskStopLossForDraft,
      setters,
      submitSwapPendingRef,
    ],
  );

  const clearStagedWidget = useCallback(() => {
    const staged = stagedOrderStateRef.current;
    const had = staged.order !== null || staged.currentPrice !== undefined || staged.barCloseAt !== undefined;
    staged.order = null;
    staged.currentPrice = undefined;
    staged.barCloseAt = undefined;
    stagedPrevPriceRef.current = undefined;
    if (had) {
      chart.current?.refreshOverlays();
    }
    setters.setStagedOnChart(false);
    return had;
  }, [chart, stagedOrderStateRef, stagedPrevPriceRef, setters]);

  const unstageOrderDraft = useCallback(() => {
    const wasStaged = stagedActiveRef.current;
    submitSwapPendingRef.current = false;
    clearStagedWidget();
    if (wasStaged) {
      resetOrderDraft();
    }
  }, [stagedActiveRef, submitSwapPendingRef, clearStagedWidget, resetOrderDraft]);

  // The entry a side switch starts from: the new side's quote, else the last candle close.
  const quoteEntryFor = useCallback(
    (side: RiskSide): number => {
      if (quote) {
        return Number(side === 'buy' ? quote.ask : quote.bid);
      }
      return Number(latestCandle?.close ?? snapshot.candles[snapshot.candles.length - 1]?.close);
    },
    [quote, latestCandle, snapshot.candles],
  );

  const stageFromQuote = useCallback(
    (side: RiskSide) => {
      const draft = stores.draft.getState();
      const switched = draft.riskSide !== side;
      setters.setPriceReference(sideReference(side));
      if (!switched) {
        stageOrderDraft(side, false);
        return;
      }
      const newEntry = quoteEntryFor(side);
      const flipped = draft.riskSide === '' ? undefined : flipExits(draft, newEntry, ticketDigits());
      setters.setRiskSide(side);
      if (!flipped) {
        resetOrderDraft();
        stageOrderDraft(side, true);
        return;
      }
      // The levels keep their distance on the other side; the entry is the new side's quote.
      setters.setEntry(ticketPrice(newEntry, ticketDigits()));
      setters.setStopLoss(flipped.stopLoss);
      setters.setTakeProfit(flipped.takeProfit);
      setters.setSlOn(flipped.stopLoss !== '');
      setters.setTpOn(flipped.takeProfit !== '');
      stageOrderDraft(side, false);
    },
    [stores.draft, resetOrderDraft, stageOrderDraft, setters, quoteEntryFor, ticketDigits],
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
