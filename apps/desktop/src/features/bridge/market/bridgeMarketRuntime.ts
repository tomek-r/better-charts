import { HistoryViewportMode, type ChartController } from '../../chart/engine/surface/chartController';
import type { Mt5DataAdapter, Mt5HistoryError } from '../../chart/engine/bars/mt5DataAdapter';
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
import type { BridgeSessionState } from '../useBridgeSession';
import { applyAcceptedSnapshot } from './applyAcceptedSnapshot';
import { endHistoryWait } from './historyWait';
import { createIdlePrefetch } from './idlePrefetch';

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
  | 'latestCandleRef'
  | 'dataKeyRef'
  | 'marketData'
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

/** Market history, paging, profiles and live updates share one effect-run lifetime. */
export function createBridgeMarketRuntime(
  run: BridgeEffectRun,
  session: BridgeMarketSession,
  resources: BridgeMarketResources,
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
    latestCandleRef,
    dataKeyRef,
    marketData: { publisher },
  } = session;
  const historyWaitSetters = { setHistoryWaitStartedAtMs, setHistoryUnavailable };
  const pendingCandles = new Map<number, Candle>();
  let candleFrame: number | undefined;
  const pageState = emptyPageState();

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
    const adapter = marketAdapterRef.current;
    if (run.disposed || run.bridgeState !== 'connected' || !symbol || !timeframe || !adapter) {
      return;
    }
    const key = `${symbol}|${timeframe}`;
    if (pageState.key !== key) {
      Object.assign(pageState, emptyPageState(), { key, symbol, timeframe });
    }
    if (pageState.inFlight) {
      return;
    }
    pageState.inFlight = true;
    pageState.anchorMs = beforeMs;
    void adapter.requestHistoryPage(symbol, timeframe, HISTORY_BARS, beforeMs).catch(() => undefined);
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
  const isExpectedSelection = (symbol: string | undefined, timeframe: string | undefined) => {
    const expected = expectedSelection();
    return (
      (!expected.symbol || expected.symbol === symbol) && (!expected.timeframe || expected.timeframe === timeframe)
    );
  };

  const releaseSymbolSelection = (symbol: string) => {
    if (targetSymbol.current === symbol) {
      targetSymbol.current = undefined;
      pendingMetadata.current = undefined;
      setSymbolLoading(false);
    }
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
      releaseSymbolSelection(failure.symbol);
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
    loadingTimeframeRef.current = undefined;
    setLoadingTimeframe(undefined);
    releaseSymbolSelection(symbol);
    setHistoryWaitStartedAtMs(undefined);
    setHistoryUnavailable({ symbol, timeframe });
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
  const viewportModeFor = (symbol: string | undefined) => {
    const hasHistory = (chartRef.current?.getData().length ?? 0) > 0;
    return currentSymbolRef.current === symbol && hasHistory
      ? HistoryViewportMode.BarsFromEnd
      : HistoryViewportMode.Reset;
  };

  const onMarketSnapshot = (event: PayloadEvent<MarketSnapshot>) => {
    if (run.disposed || run.bridgeState !== 'connected') {
      return;
    }
    const next = normalizeSnapshot(event.payload);
    const targetSnapshot = targetSymbol.current === next.symbol;
    if (!isExpectedSelection(next.symbol, next.timeframe)) {
      return;
    }
    endHistoryWait(historyWaitSetters);
    if (targetSnapshot) {
      const metadata = pendingMetadata.current;
      if (metadata && metadata.symbol === next.symbol) {
        setLastSymbolSelection(metadata);
      }
      pendingMetadata.current = undefined;
      targetSymbol.current = undefined;
      setSymbolLoading(false);
    }
    const previousLatest = latestCandleRef.current;
    const validCandles = validCandlesOf(next.candles);
    const nextLatest = validCandles[validCandles.length - 1];
    const sameSelection = currentSymbolRef.current === next.symbol && currentTimeframeRef.current === next.timeframe;
    if (sameSelection && previousLatest && nextLatest && nextLatest.timeMs < previousLatest.timeMs) {
      return;
    }
    const candles =
      sameSelection && previousLatest && nextLatest?.timeMs === previousLatest.timeMs
        ? [...validCandles.slice(0, -1), previousLatest]
        : validCandles;
    const accepted = { ...next, candles };
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
    const key = `${symbol}|${timeframe}`;
    // The page must belong to the selection on screen and exact requested anchor.
    if (
      !symbol ||
      !timeframe ||
      page.symbol !== symbol ||
      page.timeframe !== timeframe ||
      pageState.key !== key ||
      pageState.anchorMs !== page.beforeMs
    ) {
      return;
    }
    pageState.inFlight = false;
    pageState.anchorMs = undefined;
    marketAdapterRef.current?.acceptHistoryPage(symbol, timeframe);
    chartRef.current?.appendOlderHistory(validCandlesOf(page.candles), page.complete);
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
      }
    }
  };

  const onBarUpdate = (event: PayloadEvent<BarUpdate | Candle>) => {
    if (run.disposed || run.bridgeState !== 'connected' || !chartRef.current) {
      return;
    }
    const { candle, symbol, timeframe } = normalizeBarUpdate(event.payload, {
      symbol: currentSymbolRef.current,
      timeframe: currentTimeframeRef.current,
    });
    if (symbol !== currentSymbolRef.current || timeframe !== currentTimeframeRef.current) {
      return;
    }
    if (!isValidCandle(candle)) {
      return;
    }
    if (latestCandleRef.current && candle.timeMs < latestCandleRef.current.timeMs) {
      return;
    }
    latestCandleRef.current = candle;
    pendingCandles.set(candle.timeMs, candle);
    if (candleFrame === undefined) {
      candleFrame = requestAnimationFrame(flushCandles);
    }
  };

  return {
    cancelCandles,
    cancelPrefetch: idlePrefetch.cancel,
    resetPageState,
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
