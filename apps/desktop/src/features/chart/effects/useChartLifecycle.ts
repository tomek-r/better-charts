import { useEffect, useLayoutEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChartController } from '../engine/chartController';
import { Mt5DataAdapter } from '../engine/mt5DataAdapter';
import { quoteDigits } from '../../../shared/format';
import type { BridgeSessionState } from '../../bridge/useBridgeSession';
import type { OrderTicketStores } from '../../order-ticket/state/orderTicketStores';
import type { ChartWorkspaceState } from '../state/useChartWorkspace';

/**
 * The rail's tool flyout, when open, owns Escape: it closes itself and restores
 * focus, and its own document-level handler stops the event from reaching the
 * chart shortcuts. This is the guard for the shortcuts that run BEFORE that
 * handler (a window capture-phase listener), which cannot rely on it.
 */
const toolFlyoutOpen = () => document.querySelector('.tool-flyout') !== null;

export function useChartWorkspaceInitEffects(workspace: ChartWorkspaceState, session: BridgeSessionState): void {
  const {
    chartHost,
    chart,
    adapterRef,
    fixedRangeProfileState,
    positionOverlayState,
    stagedOrderState,
    priceLinesState,
    setDrawingTool,
    expectedProfile,
    profileGeneration,
    lastRequestedRangeRef,
  } = workspace;
  const { setChartError, requestProfileRange } = session;
  const chartRef = chart;
  useLayoutEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    const adapter = new Mt5DataAdapter();
    adapterRef.current = adapter;
    let instance: ChartController | undefined;
    try {
      instance = new ChartController(host, {
        fixedRangeProfile: fixedRangeProfileState.current,
        positions: positionOverlayState.current,
        staged: stagedOrderState.current,
        priceLines: priceLinesState.current,
      });
      chartRef.current = instance;
      instance.onProfileCommit = requestProfileRange;
      instance.onToolRelease = () => setDrawingTool(null);
      instance.onProfileDelete = () => {
        expectedProfile.current = undefined;
        profileGeneration.current += 1;
        lastRequestedRangeRef.current = undefined;
        void invoke('cancel_tick_profile').catch(() => undefined);
      };
    } catch {
      setChartError('Chart renderer could not be initialized.');
    }
    return () => {
      instance?.destroy();
      adapter.dispose();
      if (chartRef.current === instance) {
        chartRef.current = null;
      }
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [
    adapterRef,
    chartHost,
    chartRef,
    expectedProfile,
    fixedRangeProfileState,
    lastRequestedRangeRef,
    positionOverlayState,
    profileGeneration,
    requestProfileRange,
    setChartError,
    setDrawingTool,
    stagedOrderState,
    priceLinesState,
  ]);
  useEffect(() => {
    const cancelTool = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      chartRef.current?.setDrawingTool(null);
      setDrawingTool(null);
    };
    window.addEventListener('keydown', cancelTool);
    return () => window.removeEventListener('keydown', cancelTool);
  }, [chartRef, setDrawingTool]);
}

export function useChartWorkspaceChartEffects(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: { clearStagedWidget: () => boolean },
): void {
  const { chart, setPendingModification, priceLinesState } = workspace;
  const {
    instrument,
    quote,
    loadingTimeframe,
    snapshot,
    setLoadingTimeframe,
    setChartError,
    currentSymbol,
    setQuote,
    setInstrument,
    targetSymbol,
    status,
  } = session;
  const { clearStagedWidget } = ticket;
  const priceLinesRef = priceLinesState;
  const currentSymbolRef = currentSymbol;
  useEffect(() => {
    chart.current?.setConnectionStatus(
      status.state,
      status.message,
      `${status.terminal ?? ''}|${status.account ?? ''}|${status.server ?? ''}`,
    );
  }, [chart, status.state, status.message, status.terminal, status.account, status.server]);
  useEffect(() => {
    setPendingModification(undefined);
    clearStagedWidget();
  }, [clearStagedWidget, setPendingModification, snapshot.symbol, snapshot.timeframe]);
  // Live bid/ask price lines use the series' public Lightweight Charts API;
  // custom axis tags still use the overlay for spread-collision handling.
  useEffect(() => {
    const state = priceLinesRef.current;
    state.digits = instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : 2);
    chart.current?.setPricePrecision(state.digits);
    state.ask = quote && Number(quote.ask) > 0 ? Number(quote.ask) : undefined;
    state.bid = quote && Number(quote.bid) > 0 ? Number(quote.bid) : undefined;
    chart.current?.setBidAskPrices(state.ask, state.bid);
    chart.current?.setQuoteClock(quote);
  }, [chart, instrument?.digits, priceLinesRef, quote]);
  useEffect(() => {
    chart.current?.setCountdownPending(loadingTimeframe !== undefined);
    if (loadingTimeframe && snapshot.timeframe === loadingTimeframe) {
      setLoadingTimeframe(undefined);
      setChartError(undefined);
    }
  }, [chart, loadingTimeframe, setChartError, setLoadingTimeframe, snapshot.timeframe]);
  useEffect(() => {
    currentSymbolRef.current = snapshot.symbol;
    setQuote((previous) => (previous && previous.symbol === snapshot.symbol ? previous : undefined));
    setInstrument((previous) => {
      if (previous?.symbol === snapshot.symbol) {
        return previous;
      }
      if (targetSymbol.current === snapshot.symbol) {
        return previous;
      }
      return undefined;
    });
  }, [currentSymbolRef, setInstrument, setQuote, snapshot.symbol, targetSymbol]);
  // Drawings are time/price anchored: a line drawn on one instrument is noise on
  // another (the stale-lines bug class), so a symbol change clears ALL drawings.
  // Timeframe changes keep drawings (standard chart behavior); the tracked dateRange
  // is evicted separately in the symbol/timeframe reset below.
  useEffect(() => {
    if (chart.current?.getProfileRange()) {
      chart.current.deleteProfile();
    }
  }, [chart, snapshot.symbol]);
}

export function useChartWorkspaceResetEffects(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: Pick<OrderTicketStores['setters']['draft'], 'setEntry' | 'setStopLoss' | 'setTakeProfit'>,
): void {
  const { chart, fixedRangeProfileState, expectedProfile, profileGeneration } = workspace;
  const {
    status,
    snapshot,
    loadingTimeframeRef,
    targetSymbol,
    pendingMetadata,
    setLoadingTimeframe,
    setQuote,
    setInstrument,
    setAccount,
    setPortfolio,
    setSymbolLoading,
  } = session;
  const { setEntry, setStopLoss, setTakeProfit } = ticket;
  const fixedRangeProfileRef = fixedRangeProfileState;
  const expectedProfileRef = expectedProfile;
  const profileGenerationRef = profileGeneration;
  const targetSymbolRef = targetSymbol;
  const pendingMetadataRef = pendingMetadata;
  useEffect(() => {
    if (status.state !== 'connected') {
      setLoadingTimeframe(undefined);
      loadingTimeframeRef.current = undefined;
      fixedRangeProfileRef.current.range = null;
      fixedRangeProfileState.current.profile = undefined;
      expectedProfileRef.current = undefined;
      profileGenerationRef.current += 1;
      chart.current?.clearProfileSelection();
      chart.current?.refreshOverlays();
      setSymbolLoading(false);
      targetSymbolRef.current = undefined;
      pendingMetadataRef.current = undefined;
      setQuote(undefined);
      setInstrument(undefined);
      setAccount(undefined);
      setPortfolio(undefined);
    }
  }, [
    chart,
    expectedProfileRef,
    fixedRangeProfileRef,
    fixedRangeProfileState,
    loadingTimeframeRef,
    pendingMetadataRef,
    profileGenerationRef,
    setAccount,
    setInstrument,
    setLoadingTimeframe,
    setPortfolio,
    setQuote,
    setSymbolLoading,
    status.state,
    targetSymbolRef,
  ]);
  // SYMBOL change: the FRVP selection is instrument-specific — drop the range,
  // the drawing and the computed profile, bump the generation (the stale-event
  // guards stay armed) and reset the ticket draft.
  useLayoutEffect(() => {
    fixedRangeProfileRef.current.range = null;
    fixedRangeProfileState.current.profile = undefined;
    expectedProfileRef.current = undefined;
    profileGenerationRef.current += 1;
    if (chart.current?.getProfileRange()) {
      chart.current.deleteProfile();
    } else {
      chart.current?.clearProfileSelection();
    }
    chart.current?.refreshOverlays();
    setEntry('');
    setStopLoss('');
    setTakeProfit('');
  }, [
    chart,
    expectedProfileRef,
    fixedRangeProfileRef,
    fixedRangeProfileState,
    profileGenerationRef,
    setEntry,
    setStopLoss,
    setTakeProfit,
    snapshot.symbol,
  ]);
  // TIMEFRAME change: the profile is tick-based over a FIXED TIME range and the
  // drawing's anchors are time-based — both survive the switch. Only the layout
  // resize (new bar spacing) and the unrelated ticket reset apply here.
  useLayoutEffect(() => {
    chart.current?.refreshOverlays();
    setEntry('');
    setStopLoss('');
    setTakeProfit('');
  }, [chart, setEntry, setStopLoss, setTakeProfit, snapshot.timeframe]);
}

export function useChartWorkspaceHotkeyEffect(
  workspace: ChartWorkspaceState,
  ticket: { unstageOrderDraft: () => void },
): void {
  const { stagedActiveRef } = workspace;
  const { unstageOrderDraft } = ticket;
  // Escape also reaches the chart's document handler to cancel drawing tools.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[data-app-settings-dialog]')) {
        return;
      }
      // The rail's tool flyout owns Escape while it is open (it closes itself and
      // restores focus); the chart-level Escape shortcuts defer to it.
      if (event.key === 'Escape' && toolFlyoutOpen()) {
        return;
      }
      if (event.key === 'Escape') {
        if (stagedActiveRef.current) {
          unstageOrderDraft();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [stagedActiveRef, unstageOrderDraft]);
}
