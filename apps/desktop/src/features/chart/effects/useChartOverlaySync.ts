import { useEffect, useLayoutEffect } from 'react';
import type { StagedOrderLevels } from '../engine/stagedOrderOverlay';
import { quoteDigits } from '../../../shared/format';
import type { BridgeSessionState } from '../../bridge/useBridgeSession';
import type { OrderTicketCoordination, OrderTicketDraftStore } from '../../order-ticket/state/orderTicketStores';
import type { TicketDerivation } from '../../order-ticket/domain/ticketRules';
import type { deriveStagedOrderDisplay } from '../../order-ticket/domain/stagedOrderDisplay';
import type { useExecutionCommands } from '../../execution/useExecutionCommands';
import type { ChartWorkspaceState } from '../state/useChartWorkspace';

/** The execution actions App passes to the dispatch-ref mirror slot. */
export type ChartWorkspaceExecutionActions = Pick<
  ReturnType<typeof useExecutionCommands>,
  'requestModifyDraft' | 'requestClosePosition' | 'requestCancelOrder'
>;

export type ChartTicketOverlayState = Pick<OrderTicketCoordination, 'submitSwapPendingRef' | 'stagedPrevPriceRef'> &
  Pick<
    OrderTicketDraftStore,
    'stagedOnChart' | 'entry' | 'stopLoss' | 'takeProfit' | 'slOn' | 'tpOn' | 'riskSide' | 'orderKind'
  > &
  Pick<TicketDerivation, 'effectiveVolume'> & {
    display: Pick<ReturnType<typeof deriveStagedOrderDisplay>, 'slMoney' | 'tpMoney' | 'riskRewardLabel'>;
  };

export function useChartWorkspaceMirrorRefEffect(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: Pick<OrderTicketDraftStore, 'stagedOnChart'>,
  execution: ChartWorkspaceExecutionActions,
  dispatchEnabledNow: boolean,
): void {
  const { dragModifyRef, closeActionsRef, instrumentDigitsRef, stagedActiveRef } = workspace;
  const { instrument } = session;
  const { stagedOnChart } = ticket;
  const { requestModifyDraft, requestClosePosition, requestCancelOrder } = execution;
  // Fresh view for the once-mounted chart drag handlers: the live dispatch gate
  // (position SL/TP and pending Limit/Stop Limit drags auto-dispatch when enabled) plus the
  // ✕-chip close/cancel actions. Assigned in an effect (runs after every commit)
  // so render stays pure.
  useEffect(() => {
    dragModifyRef.current = { enabled: dispatchEnabledNow, dispatch: (draft) => requestModifyDraft(draft, true) };
    closeActionsRef.current = {
      close: (positionId) => requestClosePosition('portfolio', positionId),
      cancel: (orderId) => requestCancelOrder('portfolio', orderId),
    };
    instrumentDigitsRef.current = instrument?.digits;
    stagedActiveRef.current = stagedOnChart;
  });
}

export function useChartWorkspaceMirrorLayoutEffect(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: ChartTicketOverlayState,
): void {
  const { chart, stagedOrderState, instrumentDigitsRef } = workspace;
  const { instrument, quote, snapshot, latestCandle } = session;
  const {
    submitSwapPendingRef,
    stagedPrevPriceRef,
    stagedOnChart,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    riskSide,
    effectiveVolume,
    display: { slMoney, tpMoney, riskRewardLabel },
    orderKind,
  } = ticket;
  const stagedOrderRef = stagedOrderState;
  // Mirror the ticket into the staged widget every relevant edit (two-way sync:
  // widget drags write the ticket fields, ticket edits move the widget lines)
  // and repaint the chart so the ui-layer overlay re-renders with fresh geometry.
  useLayoutEffect(() => {
    // Frozen after a SENT order: the painted draft stays until the fill lands
    // in the portfolio sync (see submitSwapPendingRef) — no ticket mirror may
    // clear or move it in the meantime.
    if (submitSwapPendingRef.current) {
      return;
    }
    const state = stagedOrderRef.current;
    state.digits =
      instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : (instrumentDigitsRef.current ?? 2));
    if (!stagedOnChart) {
      if (state.order !== null || state.currentPrice !== undefined || state.barCloseAt !== undefined) {
        state.order = null;
        state.currentPrice = undefined;
        state.barCloseAt = undefined;
        stagedPrevPriceRef.current = undefined;
        chart.current?.refreshOverlays();
      }
      return;
    }
    const entryPrice = Number(entry);
    const last = latestCandle ?? snapshot.candles[snapshot.candles.length - 1];
    let current: number | undefined;
    if (quote && Number(quote.last) > 0) {
      current = Number(quote.last);
    } else if (last) {
      current = Number(last.close);
    }
    state.currentPrice = current !== undefined && Number.isFinite(current) && current > 0 ? current : undefined;
    const next: StagedOrderLevels = {
      side: riskSide,
      entry: Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : NaN,
      stopLoss:
        slOn && stopLoss.trim() !== '' && Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0
          ? Number(stopLoss)
          : null,
      takeProfit:
        tpOn && takeProfit.trim() !== '' && Number.isFinite(Number(takeProfit)) && Number(takeProfit) > 0
          ? Number(takeProfit)
          : null,
      volume: effectiveVolume,
      orderKindLabel:
        orderKind === 'stop_limit' ? 'Stop Limit' : orderKind.charAt(0).toUpperCase() + orderKind.slice(1),
      slMoney,
      tpMoney,
      riskRewardLabel,
    };
    const previous = state.order;
    const changed =
      !previous ||
      previous.side !== next.side ||
      previous.entry !== next.entry ||
      previous.stopLoss !== next.stopLoss ||
      previous.takeProfit !== next.takeProfit ||
      previous.volume !== next.volume ||
      previous.orderKindLabel !== next.orderKindLabel ||
      previous.slMoney !== next.slMoney ||
      previous.tpMoney !== next.tpMoney ||
      previous.riskRewardLabel !== next.riskRewardLabel;
    state.order = next;
    const priceMoved = stagedPrevPriceRef.current !== state.currentPrice;
    stagedPrevPriceRef.current = state.currentPrice;
    // Level changes and current-price moves both repaint overlays without a
    // container re-measure; the old resize() here re-laid out the chart on EVERY quote tick.
    if (changed || (priceMoved && state.currentPrice !== undefined)) {
      chart.current?.refreshOverlays();
    }
  }, [
    stagedOnChart,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    riskSide,
    effectiveVolume,
    orderKind,
    quote,
    snapshot.timeframe,
    latestCandle,
    snapshot.candles,
    instrument?.digits,
    slMoney,
    tpMoney,
    riskRewardLabel,
    chart,
    instrumentDigitsRef,
    stagedOrderRef,
    stagedPrevPriceRef,
    submitSwapPendingRef,
  ]);
}
