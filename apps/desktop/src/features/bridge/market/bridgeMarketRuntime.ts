import type { ChartController } from '../../chart/engine/surface/chartController';
import type { Mt5DataAdapter, Mt5HistoryError } from '../../chart/engine/bars/mt5DataAdapter';
import { aggregatedBlockStartMs } from '../../chart/engine/bars/aggregatedBars';
import { listen } from '@tauri-apps/api/event';
import type {
  BridgeStatus,
  BarUpdate,
  Candle,
  HistoryPage,
  HistoryUnavailable,
  MarketSnapshot,
  ProfileResult,
  ProfileCancelled,
  ProfileError,
  BrokerSymbol,
  QuoteSnapshot,
  SelectionFallback,
} from '../../../shared/bridge/types';
import {
  normalizeBarUpdate,
  normalizeHistoryPage,
  normalizeSnapshot,
  isValidCandle,
  normalizeQuote,
  validCandlesOf,
} from '../bridgePayloadNormalizers';
import type { PayloadEvent } from '../bridgeEventTypes';
import { HISTORY_BARS } from '../../../shared/bridge/config';
import type { AggregatedInterval } from '../../../shared/bridge/chartIntervalModel';
import {
  aggregatedIntervalOf,
  isTickBuiltInterval,
  seriesBarsOf,
  seriesTimeframeOf,
} from '../../../shared/bridge/chartIntervals';
import type { BridgeSessionState } from '../useBridgeSession';
import { applyAcceptedSnapshot, recordMt5Timeframe, snapshotViewportMode } from './applyAcceptedSnapshot';
import { AggregatedSeries } from './aggregatedSeries';
import { ChartTickBars, newestKnownInstantMs } from './chartTickBars';
import { endHistoryWait } from './historyWait';
import { createIdlePrefetch } from './idlePrefetch';
import { createIndicatorTickSource } from './indicatorTicksTransport';

export interface BridgeEffectRun {
  disposed: boolean;
  bridgeState: BridgeStatus['state'];
}

type BridgeMarketSession = Pick<
  BridgeSessionState,
  | 'loadingTimeframeRef'
  | 'setLoadingTimeframe'
  | 'setChartError'
  | 'setSnapshot'
  | 'setLatestCandle'
  | 'setQuote'
  | 'setInstrument'
  | 'setLastSymbolSelection'
  | 'setSymbolLoading'
  | 'setHistoryWaitStartedAtMs'
  | 'setHistoryUnavailable'
  | 'targetSymbol'
  | 'pendingMetadata'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'mt5TimeframeRef'
  | 'requestedTickIntervalRef'
  | 'latestCandleRef'
  | 'dataKeyRef'
  | 'marketData'
  | 'stores'
>;

export type BridgeMarketResources = {
  chart: { current: ChartController | null };
  adapterRef: { current: Mt5DataAdapter | null };
};

interface PageState {
  key: string;
  symbol: string;
  timeframe: string;
  inFlight: boolean;
  anchorMs: number | undefined;
}

const emptyPageState = (): PageState => ({ key: '', symbol: '', timeframe: '', inFlight: false, anchorMs: undefined });

/**
 * Market history, paging, profiles and live updates share one effect-run lifetime.
 * `tickBarsRef` is the slot the run publishes its tick bar source into, so the session's own
 * tick-interval commands show and stop the read this run owns.
 */
export function createBridgeMarketRuntime(
  run: BridgeEffectRun,
  session: BridgeMarketSession,
  resources: BridgeMarketResources,
  tickBarsRef: { current: ChartTickBars | null },
) {
  const chartRef = resources.chart;
  const marketAdapterRef = resources.adapterRef;
  const {
    loadingTimeframeRef,
    setLoadingTimeframe,
    setChartError,
    setSnapshot,
    setLatestCandle,
    setQuote,
    setInstrument,
    setLastSymbolSelection,
    setSymbolLoading,
    setHistoryWaitStartedAtMs,
    setHistoryUnavailable,
    targetSymbol,
    pendingMetadata,
    currentSymbol: currentSymbolRef,
    currentTimeframe: currentTimeframeRef,
    mt5TimeframeRef,
    requestedTickIntervalRef,
    latestCandleRef,
    dataKeyRef,
    marketData: { publisher },
    stores,
  } = session;
  const historyWaitSetters = { setHistoryWaitStartedAtMs, setHistoryUnavailable };
  const pendingCandles = new Map<number, Candle>();
  let candleFrame: number | undefined;
  const pageState = emptyPageState();
  /** The newest instant the bridge reported for the feed: the chart symbol's quote, or the session's clock. */
  const brokerNowMs = () =>
    newestKnownInstantMs([
      stores.quote.getState().quote?.timeMs,
      stores.connection.getState().status.marketSession?.serverTimeMs,
    ]);
  // The chart's own bars while a tick interval is shown; the session's selection commands start its reads.
  const tickBars = new ChartTickBars({
    chart: chartRef,
    session,
    ticks: createIndicatorTickSource(() => currentSymbolRef.current),
    brokerNowMs,
  });
  tickBarsRef.current = tickBars;

  /** The aggregated series on screen and the interval it draws; another interval starts a new one. */
  let aggregatedSeries: AggregatedSeries | undefined;
  let aggregatedSeriesCode: string | undefined;

  /**
   * The series a shown `code` draws through, or undefined for an interval that groups nothing. An
   * interval that groups nothing forgets the aggregated one before it, so no block of that one
   * outlives the window it was built for.
   */
  const aggregatedSeriesOf = (code: string | undefined): AggregatedSeries | undefined => {
    const interval = aggregatedIntervalOf(code);
    if (interval === undefined) {
      aggregatedSeries?.reset();
      aggregatedSeries = undefined;
      aggregatedSeriesCode = undefined;
      return undefined;
    }
    if (aggregatedSeries === undefined || aggregatedSeriesCode !== interval.code) {
      aggregatedSeries = new AggregatedSeries(interval);
      aggregatedSeriesCode = interval.code;
    }
    return aggregatedSeries;
  };

  const cancelCandles = () => {
    if (candleFrame !== undefined) {
      cancelAnimationFrame(candleFrame);
    }
    candleFrame = undefined;
    pendingCandles.clear();
  };
  const flushCandles = () => {
    candleFrame = undefined;
    const candles = [...pendingCandles.values()];
    pendingCandles.clear();
    if (run.disposed || run.bridgeState !== 'connected' || !chartRef.current || candles.length === 0) {
      return;
    }
    // A tick-built interval draws quotes: a candle queued for the interval before it is not this chart's.
    if (isTickBuiltInterval(currentTimeframeRef.current)) {
      return;
    }
    try {
      for (const candle of candles) {
        chartRef.current.updateCandle(candle);
      }
      // React consumers need the raw live tail, while the chart engine owns
      // the mutable render history. Keep snapshot history stable between
      // accepted history replacements instead of copying it on every paint.
      setLatestCandle(candles[candles.length - 1]);
    } catch {
      setChartError('Live bar could not be rendered.');
    }
  };

  /** Lazy page state is scoped to the active symbol/timeframe and anchor. */
  const requestOlderHistory = (beforeMs: number) => {
    const symbol = currentSymbolRef.current;
    const timeframe = currentTimeframeRef.current;
    if (run.disposed || run.bridgeState !== 'connected' || !symbol || !timeframe) {
      return;
    }
    // A tick-built interval has no broker pages: its older bars are read from the symbol's older ticks.
    if (isTickBuiltInterval(timeframe)) {
      tickBars.requestOlderTicks();
      return;
    }
    const adapter = marketAdapterRef.current;
    if (!adapter) {
      return;
    }
    const key = `${symbol}|${timeframe}`;
    // An aggregated interval pages its base series, and the page's own failure is reported on it.
    const series = seriesTimeframeOf(timeframe);
    const bars = seriesBarsOf(timeframe, HISTORY_BARS);
    if (pageState.key !== key) {
      Object.assign(pageState, emptyPageState(), { key, symbol, timeframe: series });
    }
    if (pageState.inFlight) {
      return;
    }
    pageState.inFlight = true;
    pageState.anchorMs = beforeMs;
    void adapter.requestHistoryPage(symbol, series, bars, beforeMs).catch(() => undefined);
  };
  const idlePrefetch = createIdlePrefetch({
    isStillWanted: (dataKey) =>
      !run.disposed &&
      dataKeyRef.current === dataKey &&
      loadingTimeframeRef.current === undefined &&
      targetSymbol.current === undefined,
    prefetch: () => chartRef.current?.prefetchOlderHistory(),
  });
  const resetPageState = () => {
    Object.assign(pageState, emptyPageState());
  };

  /** The selection a live answer must belong to: the pick in flight, else what is on screen; unset matches anything. */
  const expectedSelection = () => ({
    symbol: targetSymbol.current ?? currentSymbolRef.current,
    timeframe: loadingTimeframeRef.current ?? currentTimeframeRef.current,
  });
  /** The bridge answers on native series, so an aggregated selection is expected through its base. */
  const isExpectedSelection = (symbol: string | undefined, timeframe: string | undefined) => {
    const expected = expectedSelection();
    return (
      (!expected.symbol || expected.symbol === symbol) &&
      (!expected.timeframe || seriesTimeframeOf(expected.timeframe) === timeframe)
    );
  };

  /** Forgets the pick in flight for `symbol`, once its window — or its failure — has settled that pick. */
  const clearPickedSymbol = (symbol: string | undefined) => {
    if (targetSymbol.current !== symbol) {
      return;
    }
    pendingMetadata.current = undefined;
    targetSymbol.current = undefined;
    setSymbolLoading(false);
  };

  const onAdapterHistoryError = (failure: Mt5HistoryError) => {
    if (run.disposed) {
      return;
    }
    if (failure.kind === 'page') {
      // Lazy loading is a background convenience: the chart keeps the bars it
      // already has, and the next pan retries. Release the in-flight guard so
      // that retry can happen, but do not surface a chart error.
      if (failure.symbol === pageState.symbol && failure.timeframe === pageState.timeframe) {
        pageState.inFlight = false;
        pageState.anchorMs = undefined;
      }
      return;
    }
    if (isExpectedSelection(failure.symbol, failure.timeframe)) {
      loadingTimeframeRef.current = undefined;
      setLoadingTimeframe(undefined);
      endHistoryWait(historyWaitSetters);
      setChartError(failure.kind === 'timeout' ? 'History request timed out.' : 'History request could not be sent.');
      clearPickedSymbol(failure.symbol);
    }
  };

  /**
   * The EA could not synchronize the awaited series before its deadline and
   * sent no candles. Only the selection being awaited is released; the notice
   * stays until a snapshot, another selection or a session reset clears it.
   */
  const onHistoryUnavailable = (event: PayloadEvent<HistoryUnavailable>) => {
    if (run.disposed || run.bridgeState !== 'connected') {
      return;
    }
    const { symbol, timeframe } = event.payload;
    if (!isExpectedSelection(symbol, timeframe)) {
      return;
    }
    marketAdapterRef.current?.acceptHistoryUnavailable(symbol, timeframe);
    // The notice names the interval the user picked, not the base series an aggregated one asks for.
    const shownTimeframe = loadingTimeframeRef.current ?? timeframe;
    loadingTimeframeRef.current = undefined;
    setLoadingTimeframe(undefined);
    clearPickedSymbol(symbol);
    setHistoryWaitStartedAtMs(undefined);
    setHistoryUnavailable({ symbol, timeframe: shownTimeframe });
  };

  /**
   * A reconnect could not reopen the selection the user was viewing, and the
   * bridge has requested the EA's chart symbol instead. That window is accepted
   * like any first window of a session; this only tells the user why it differs.
   */
  const onSelectionFallback = (event: PayloadEvent<SelectionFallback>) => {
    if (run.disposed || run.bridgeState !== 'connected') {
      return;
    }
    const { symbol, shownSymbol } = event.payload;
    setChartError(`${symbol} is not available on this account — showing ${shownSymbol}`);
  };

  // The same symbol always carries the view over, measured from the newest
  // bar: a timeframe change, and equally a window that replaces the series in
  // place (a fresh answer to a history request), whose newest bar may be
  // several bars later than the chart's. Pinning the old logical position
  // there left the newest bars off the right edge. Only a new symbol or a
  // fresh session (selection refs cleared) starts from the default view.
  // Auto scale is off by default, so replaceHistory fits the scale to the
  // new candles itself.
  const viewportModeFor = (symbol: string | undefined) =>
    snapshotViewportMode(currentSymbolRef.current, (chartRef.current?.getData().length ?? 0) > 0, symbol);

  /** A window that answers the symbol the user picked settles that pick, remembering the metadata it brought. */
  const settlePickedSymbol = (symbol: string | undefined) => {
    const metadata = pendingMetadata.current;
    if (metadata && metadata.symbol === symbol) {
      setLastSymbolSelection(metadata);
    }
    clearPickedSymbol(symbol);
  };

  /**
   * While a tick interval is shown the chart draws ticks, not candles: the only
   * window it takes is the one that moved the bridge to a newly picked symbol,
   * whose candles the symbol's own tick read replaces. That window's series is
   * the last MT5 timeframe, which the next switch asks its own window on.
   */
  const readTicksInsteadOfWindow = (
    symbol: string | undefined,
    tickInterval: string,
    switchingWindowTimeframe: string | undefined,
  ) => {
    if (symbol === undefined || targetSymbol.current !== symbol) {
      return;
    }
    recordMt5Timeframe(mt5TimeframeRef, switchingWindowTimeframe);
    endHistoryWait(historyWaitSetters);
    cancelCandles();
    loadingTimeframeRef.current = undefined;
    setLoadingTimeframe(undefined);
    settlePickedSymbol(symbol);
    tickBars.show(symbol, tickInterval);
  };

  /**
   * The newest candle instant the chart draws for `candles`: an aggregated candle opens at the start
   * of its block, which is at or before the newest base candle that block groups.
   */
  const newestDrawnTimeMsOf = (
    candles: readonly Candle[],
    interval: AggregatedInterval | undefined,
  ): number | undefined => {
    const newest = candles.at(-1);
    if (newest === undefined || interval === undefined) {
      return newest?.timeMs;
    }
    return aggregatedBlockStartMs(interval, newest.timeMs);
  };

  const onMarketSnapshot = (event: PayloadEvent<MarketSnapshot>) => {
    if (run.disposed || run.bridgeState !== 'connected') {
      return;
    }
    const next = normalizeSnapshot(event.payload);
    const requestedTickInterval = requestedTickIntervalRef.current;
    if (requestedTickInterval !== null) {
      readTicksInsteadOfWindow(next.symbol, requestedTickInterval, next.timeframe);
      return;
    }
    if (!isExpectedSelection(next.symbol, next.timeframe)) {
      return;
    }
    endHistoryWait(historyWaitSetters);
    settlePickedSymbol(next.symbol);
    // An aggregated selection is shown as its own code, over the candles its base series brought.
    // An unset selection matches anything, so it keeps the snapshot's own timeframe, as before.
    const shownTimeframe = expectedSelection().timeframe || next.timeframe;
    const interval = aggregatedIntervalOf(shownTimeframe);
    const series = aggregatedSeriesOf(shownTimeframe);
    const baseCandles = validCandlesOf(next.candles);
    const previousLatest = latestCandleRef.current;
    const sameSelection = currentSymbolRef.current === next.symbol && currentTimeframeRef.current === shownTimeframe;
    const newestDrawnTimeMs = newestDrawnTimeMsOf(baseCandles, interval);
    // A window older than the newest candle already drawn is stale, and would step the pane back.
    if (
      sameSelection &&
      previousLatest &&
      newestDrawnTimeMs !== undefined &&
      newestDrawnTimeMs < previousLatest.timeMs
    ) {
      return;
    }
    const drawn = series === undefined ? baseCandles : series.window(baseCandles);
    const nextLatest = drawn.at(-1);
    const candles =
      sameSelection && previousLatest && nextLatest?.timeMs === previousLatest.timeMs
        ? [...drawn.slice(0, -1), previousLatest]
        : drawn;
    const accepted = { ...next, timeframe: shownTimeframe, candles };
    cancelCandles();
    try {
      applyAcceptedSnapshot({ chart: chartRef, adapter: marketAdapterRef.current, session }, accepted, {
        receivedCandleCount: next.candles.length,
        viewportMode: viewportModeFor(accepted.symbol),
        afterReplace: idlePrefetch.schedule,
      });
    } catch {
      setChartError('Chart data could not be rendered.');
    }
    setSnapshot(accepted);
    if (loadingTimeframeRef.current === accepted.timeframe) {
      loadingTimeframeRef.current = undefined;
      setLoadingTimeframe(undefined);
    }
  };

  const onHistoryPage = (event: PayloadEvent<HistoryPage>) => {
    if (run.disposed || run.bridgeState !== 'connected') {
      return;
    }
    const page = normalizeHistoryPage(event.payload);
    const symbol = currentSymbolRef.current;
    const timeframe = currentTimeframeRef.current;
    if (!symbol || !timeframe) {
      return;
    }
    const key = `${symbol}|${timeframe}`;
    const seriesTimeframe = seriesTimeframeOf(timeframe);
    // The page must belong to the selection on screen, its series and the exact requested anchor.
    if (
      page.symbol !== symbol ||
      page.timeframe !== seriesTimeframe ||
      pageState.key !== key ||
      pageState.anchorMs !== page.beforeMs
    ) {
      return;
    }
    pageState.inFlight = false;
    pageState.anchorMs = undefined;
    marketAdapterRef.current?.acceptHistoryPage(symbol, seriesTimeframe);
    const pageCandles = validCandlesOf(page.candles);
    const series = aggregatedSeriesOf(timeframe);
    const prepended = series === undefined ? pageCandles : series.olderPage(pageCandles);
    chartRef.current?.appendOlderHistory(prepended, page.complete);
  };

  /** One `listen` per event; what this run accepts goes to the port's feed, and a disposed run forwards nothing. */
  const forward = <T>(eventName: string, publish: (payload: T) => void) =>
    listen<T>(eventName, (event) => {
      if (!run.disposed) {
        publish(event.payload);
      }
    });

  /**
   * Chart tools read market data through the narrow `MarketDataPort`, never through
   * Tauri; this feeds that port.
   */
  const forwardMarketDataEvents = () => [
    forward<ProfileResult>('tick-profile', (payload) => publisher.publishTickProfile(payload)),
    forward<ProfileCancelled>('tick-profile-cancelled', (payload) => publisher.publishTickProfileCancelled(payload)),
    forward<ProfileError>('tick-profile-error', (payload) => publisher.publishTickProfileError(payload)),
  ];

  const onSymbolInfo = (event: PayloadEvent<BrokerSymbol>) => {
    const expected = expectedSelection().symbol;
    if (!run.disposed && expected && event.payload.symbol === expected) {
      setInstrument(event.payload);
    }
  };

  const onQuoteUpdate = (event: PayloadEvent<QuoteSnapshot>) => {
    if (!run.disposed) {
      const nextQuote = normalizeQuote(event.payload);
      if (currentSymbolRef.current && nextQuote.symbol === currentSymbolRef.current) {
        setQuote(nextQuote);
        tickBars.addTick(nextQuote);
      }
    }
  };

  const onBarUpdate = (event: PayloadEvent<BarUpdate | Candle>) => {
    if (run.disposed || run.bridgeState !== 'connected' || !chartRef.current) {
      return;
    }
    const shownTimeframe = currentTimeframeRef.current;
    // A tick-built interval's bars are built from quotes: a candle of any MT5 series is not this chart's.
    if (!shownTimeframe || isTickBuiltInterval(shownTimeframe)) {
      return;
    }
    const seriesTimeframe = seriesTimeframeOf(shownTimeframe);
    const aggregated = aggregatedSeriesOf(shownTimeframe);
    const { candle, symbol, timeframe } = normalizeBarUpdate(event.payload, {
      symbol: currentSymbolRef.current,
      timeframe: seriesTimeframe,
    });
    if (symbol !== currentSymbolRef.current || timeframe !== seriesTimeframe) {
      return;
    }
    if (!isValidCandle(candle)) {
      return;
    }
    const drawn = aggregated === undefined ? candle : aggregated.live(candle);
    if (drawn === undefined) {
      return;
    }
    if (latestCandleRef.current && drawn.timeMs < latestCandleRef.current.timeMs) {
      return;
    }
    latestCandleRef.current = drawn;
    pendingCandles.set(drawn.timeMs, drawn);
    if (candleFrame === undefined) {
      candleFrame = requestAnimationFrame(flushCandles);
    }
  };

  /** Drops the tick interval's read and bars, so a session that starts over shows the bridge's own window. */
  const stopTickBars = () => {
    tickBars.stop();
    requestedTickIntervalRef.current = null;
    if (tickBarsRef.current === tickBars) {
      tickBarsRef.current = null;
    }
  };

  return {
    cancelCandles,
    cancelPrefetch: idlePrefetch.cancel,
    resetPageState,
    stopTickBars,
    requestOlderHistory,
    onAdapterHistoryError,
    onHistoryUnavailable,
    onSelectionFallback,
    onMarketSnapshot,
    onHistoryPage,
    forwardMarketDataEvents,
    onSymbolInfo,
    onQuoteUpdate,
    onBarUpdate,
  };
}
