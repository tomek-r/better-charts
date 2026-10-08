import { useEffect, useLayoutEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChartController } from '../engine/chartController';
import { Mt5DataAdapter } from '../engine/mt5DataAdapter';
import { quoteDigits } from '../../../shared/format';
import type { BridgeSessionState } from '../../bridge/useBridgeSession';
import type { OrderTicketState } from '../../order-ticket/state/useOrderTicket';
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
      instance.onProfileCommit = (range) => requestProfileRange('gesture-committed', range);
      instance.onToolRelease = () => setDrawingTool(null);
      instance.onProfileDelete = () => {
        expectedProfile.current = undefined;
        profileGeneration.current += 1;
        lastRequestedRangeRef.current = undefined;
        void invoke('cancel_tick_profile').catch(() => undefined);
      };
    } catch (error) {
      setChartError('Chart renderer could not be initialized.');
      console.error(error);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One renderer/coordinator per mount; callbacks read refs.
  }, []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Chart ref and setter are stable for this mount.
  }, []);
}

export function useChartWorkspaceChartEffects(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: clearStagedWidget/submitSwapPendingRef come from the hook return (stable per mount); dep array frozen 1:1 with the former inline effect
  }, [snapshot.symbol, snapshot.timeframe]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5f: workspace/session/ticket bindings are not provably stable in this scope; dep array frozen 1:1 with the former App effect
  }, [quote, instrument?.digits]);
  useEffect(() => {
    chart.current?.setCountdownPending(loadingTimeframe !== undefined);
    if (loadingTimeframe && snapshot.timeframe === loadingTimeframe) {
      setLoadingTimeframe(undefined);
      setChartError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5e: setChartError/setLoadingTimeframe come from useBridgeSession (setter identities erased by the return); dep array frozen 1:1
  }, [loadingTimeframe, snapshot.timeframe]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5e: `currentSymbol`/`targetSymbol` (hook-owned refs) + setQuote/setInstrument (hook-owned setters) — identities erased by the useBridgeSession return; dep array frozen 1:1
  }, [snapshot.symbol]);
  // Drawings are time/price anchored: a line drawn on one instrument is noise on
  // another (the stale-lines bug class), so a symbol change clears ALL drawings.
  // Timeframe changes keep drawings (standard chart behavior); the tracked dateRange
  // is evicted separately in the symbol/timeframe reset below.
  useEffect(() => {
    if (chart.current?.getProfileRange()) {
      chart.current.deleteProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5f: workspace/session/ticket bindings are not provably stable in this scope; dep array frozen 1:1 with the former App effect
  }, [snapshot.symbol]);
}

export function useChartWorkspaceResetEffects(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hook-provided setter, stable identity (P5a)
  }, [status.state]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: setters come from the hook return (stable identities); dep array frozen 1:1 with the former inline effect
  }, [snapshot.symbol]);
  // TIMEFRAME change: the profile is tick-based over a FIXED TIME range and the
  // drawing's anchors are time-based — both survive the switch. Only the layout
  // resize (new bar spacing) and the unrelated ticket reset apply here.
  useLayoutEffect(() => {
    chart.current?.refreshOverlays();
    setEntry('');
    setStopLoss('');
    setTakeProfit('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: setters come from the hook return (stable identities); dep array frozen 1:1 with the former inline effect
  }, [snapshot.timeframe]);
}

export function useChartWorkspaceHotkeyEffect(workspace: ChartWorkspaceState, ticket: OrderTicketState): void {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hook-provided setter, stable identity (P5a); also covers pre-existing missing 'unstageOrderDraft'
  }, []);
}
