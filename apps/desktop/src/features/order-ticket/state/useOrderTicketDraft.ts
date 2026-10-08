import { useCallback } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { RiskSide } from '../../../shared/bridge/types';
import { ticketPrice } from '../../../shared/format';
import { useNotifyError } from '../../../shared/ui/ErrorNotifications';
import { defaultStopLossPrice } from '../domain/defaultStopLoss';
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

  const resetOrderDraft = useCallback(() => {
    setters.setSlOn(false);
    setters.setTpOn(false);
    setters.setStopLoss('');
    setters.setTakeProfit('');
    setters.setEntry('');
  }, [setters]);

  const resetTicketToDefaults = useCallback(() => {
    resetOrderDraft();
    setters.setRiskAmount('');
    setters.setOrderKind('market');
    setters.setLimitPrice('');
    setters.setTimeInForce('gtc');
    setters.setUnitsMode('units');
    setters.setOrderVolume('1');
    setters.setVolumeManual(false);
    setters.setSlUnit('ticks');
    setters.setTpUnit('ticks');
    setters.setPriceMode('absolute');
    setters.setPriceReference('ask');
    setters.setPriceOffset('0');
    setters.setTicketStage('edit');
  }, [resetOrderDraft, setters]);

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
        setters.setOrderVolume('1');
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

  const stageFromQuote = useCallback(
    (side: RiskSide) => {
      const switched = stores.draft.getState().riskSide !== side;
      if (switched) {
        resetOrderDraft();
      }
      setters.setRiskSide(side);
      stageOrderDraft(side, switched);
    },
    [stores.draft, resetOrderDraft, stageOrderDraft, setters],
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
