import { useCallback } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { RiskSide } from '../../../shared/bridge/types';
import { ticketPrice } from '../../../shared/format';
import { useNotifyError } from '../../../shared/ui/notification/ErrorNotifications';
import { defaultStopLossPrice } from '../exits/defaultStopLoss';
import { defaultOrderVolume } from '../sizing/defaultVolume';
import { quoteTextFor } from '../sideFlip/sideFlip';
import type { OrderTicketInputs } from '../draft/orderTicketInputs';
import type { OrderTicketDraftStore, OrderTicketStores } from '../draft/orderTicketStores';

type StagingInputs = Pick<
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

/** Putting the draft on the chart and taking it off again, plus the default stop loss that risk sizing needs. */
export function useOrderTicketStaging(inputs: StagingInputs, stores: OrderTicketStores, resetOrderDraft: () => void) {
  const {
    chart,
    stagedOrderState: stagedOrderStateRef,
    instrumentDigitsRef,
    stagedActiveRef,
    instrument,
    snapshot,
    latestCandle,
    quote,
  } = inputs;
  const setters = stores.setters.draft;
  const notifyError = useNotifyError();
  const { submitSwapPendingRef, stagedPrevPriceRef } = stores.coordination;

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

  // The entry a draft starts from: the side's quote, else the last candle close.
  const quoteEntryFor = useCallback(
    (side: RiskSide): number => {
      if (quote) {
        return Number(quoteTextFor(side, quote));
      }
      return Number(latestCandle?.close ?? snapshot.candles[snapshot.candles.length - 1]?.close);
    },
    [quote, latestCandle, snapshot.candles],
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
        const fallback = quoteEntryFor(side);
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
      quoteEntryFor,
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

  return { enableRiskStopLoss, quoteEntryFor, stageOrderDraft, clearStagedWidget, unstageOrderDraft };
}
