import { useEffect, useLayoutEffect } from 'react';
import type { StagedOrderLevels } from './engine/stagedOrderOverlay';
import { quoteDigits, formatSignedMoney } from '../../shared/format';
import { orderEntryPrice, riskRewardRatio } from '../order-ticket/domain/ticketRules';
import type { BridgeSessionState } from '../bridge/useBridgeSession';
import type { OrderTicketState } from '../order-ticket/state/useOrderTicket';
import type { useExecutionCommands } from '../execution/useExecutionCommands';
import type { ChartWorkspaceState } from './useChartWorkspace';

/** The §12 execution actions App passes to the dispatch-ref mirror slot. */
export type ChartWorkspaceExecutionActions = Pick<
  ReturnType<typeof useExecutionCommands>,
  'requestModifyDraft' | 'requestClosePosition' | 'requestCancelOrder'
>;

export function useChartWorkspaceMirrorRefEffect(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
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
  ticket: OrderTicketState,
): void {
  const { chart, stagedOrderState, instrumentDigitsRef } = workspace;
  const { instrument, quote, snapshot, account } = session;
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
    riskAmount,
    riskPreview,
    riskPreviewDisplayRef,
    riskVersion,
    volumeManual,
    stopGuard,
    unitsMode,
    orderKind,
    limitPrice,
  } = ticket;
  const stagedOrderRef = stagedOrderState;
  // Signed P&L at an exit level in the ACCOUNT currency (owner: "TP +$60,
  // SL -$50 — waluta wybrana, nie zahardkodowana"): (level − entry) × side ×
  // contractSize × volume — the same estimate basis as the ticket's Tick value
  // (the broker's true tick value is not exposed by the bridge). Only for SET
  // levels: undefined keeps the plain SL/TP handle label.
  const levelMoney = (level: number | null): string | undefined => {
    const entryPrice = Number(orderEntryPrice(orderKind, entry, limitPrice));
    const volume = Number(effectiveVolume);
    const contract = instrument ? Number(instrument.contractSize) : NaN;
    const currency = account?.currency?.trim();
    if (level === null || !Number.isFinite(level) || !currency) {
      return undefined;
    }
    if (
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0 ||
      !Number.isFinite(volume) ||
      volume <= 0 ||
      !Number.isFinite(contract) ||
      contract <= 0
    ) {
      return undefined;
    }
    const direction = riskSide === 'buy' ? 1 : -1;
    const value = (level - entryPrice) * direction * contract * volume;
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return formatSignedMoney(value, currency);
  };
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
    const riskPreviewMatchesOrder = Boolean(
      unitsMode !== 'units' &&
      riskPreview &&
      riskPreview.draftVersion === riskVersion.current &&
      riskPreview.symbol === snapshot.symbol &&
      riskPreview.side === riskSide &&
      riskPreview.volume === effectiveVolume &&
      riskPreview.currency === account?.currency,
    );
    const entryPrice = Number(entry);
    const last = snapshot.candles[snapshot.candles.length - 1];
    let current: number | undefined;
    if (quote && Number(quote.last) > 0) {
      current = Number(quote.last);
    } else if (last) {
      current = Number(last.close);
    }
    state.currentPrice = current !== undefined && Number.isFinite(current) && current > 0 ? current : undefined;
    const stopLossNumber = Number(stopLoss);
    const takeProfitNumber = Number(takeProfit);
    const enteredRisk = Number(riskAmount);
    const equity = Number(account?.equity);
    const riskBudget = unitsMode === 'equity' ? (enteredRisk * equity) / 100 : enteredRisk;
    const automaticRiskBudget =
      unitsMode !== 'units' &&
      !volumeManual &&
      riskAmount.trim() !== '' &&
      Number.isFinite(riskBudget) &&
      riskBudget > 0 &&
      Boolean(account?.currency);
    const pendingRiskBudgetLabel =
      automaticRiskBudget && !stopGuard?.slTooClose && account?.currency
        ? formatSignedMoney(-riskBudget, account.currency)
        : undefined;
    const lastBrokerPreview = riskPreviewMatchesOrder ? riskPreview : riskPreviewDisplayRef.current;
    const brokerPreviewMatchesDraft = Boolean(
      automaticRiskBudget &&
      lastBrokerPreview &&
      lastBrokerPreview.symbol === snapshot.symbol &&
      lastBrokerPreview.side === riskSide &&
      lastBrokerPreview.currency === account?.currency &&
      Number.isFinite(Number(lastBrokerPreview.riskBudget)) &&
      Math.abs(Number(lastBrokerPreview.riskBudget) - riskBudget) < 1e-8,
    );
    const previewStopLossMoney =
      brokerPreviewMatchesDraft && lastBrokerPreview
        ? formatSignedMoney(-Number(lastBrokerPreview.estimatedRisk), lastBrokerPreview.currency)
        : pendingRiskBudgetLabel;
    const previewTakeProfitMoney =
      brokerPreviewMatchesDraft && lastBrokerPreview?.estimatedReward
        ? formatSignedMoney(Number(lastBrokerPreview.estimatedReward), lastBrokerPreview.currency)
        : undefined;
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
      // Money labels ride on the SAME set-only rule as the levels above.
      slMoney:
        slOn && stopLoss.trim() !== '' && Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0
          ? (previewStopLossMoney ?? (automaticRiskBudget ? undefined : levelMoney(stopLossNumber)))
          : undefined,
      tpMoney:
        tpOn && takeProfit.trim() !== '' && Number.isFinite(Number(takeProfit)) && Number(takeProfit) > 0
          ? (previewTakeProfitMoney ?? levelMoney(takeProfitNumber))
          : undefined,
      riskRewardLabel:
        slOn && tpOn && stopLoss.trim() !== '' && takeProfit.trim() !== ''
          ? riskRewardRatio(riskSide, orderEntryPrice(orderKind, entry, limitPrice), stopLoss, takeProfit)
          : undefined,
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
    // Levels changed → full repaint; a quote tick alone takes the LIGHT path:
    // setCurrentPrice → scheduleRender (rAF, no container re-measure). The old
    // resize() here re-laid-out the chart on EVERY quote tick while staged.
    if (changed) {
      chart.current?.refreshOverlays();
    } else if (priceMoved && state.currentPrice !== undefined) {
      chart.current?.setCurrentPrice(state.currentPrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stagedOnChart,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    riskSide,
    effectiveVolume,
    riskPreview,
    unitsMode,
    orderKind,
    limitPrice,
    quote,
    snapshot.timeframe,
    snapshot.candles.length,
    instrument?.digits,
    instrument?.contractSize,
    account?.currency,
  ]);
}
