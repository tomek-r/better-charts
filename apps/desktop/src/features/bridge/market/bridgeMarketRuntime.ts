import { HistoryViewportMode, type ChartController } from '../../chart/engine/surface/chartController';
import { toRenderBar, type Mt5DataAdapter, type Mt5HistoryError } from '../../chart/engine/bars/mt5DataAdapter';
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
  normalizeCandle,
  normalizeHistoryPage,
  normalizeSnapshot,
  isValidCandle,
  normalizeQuote,
} from '../bridgePayloadNormalizers';
import { HISTORY_BARS } from '../../../shared/bridge/config';
import { DEFAULT_TIMEFRAME } from '../../../shared/bridge/timeframes';
import type { BridgeSessionState } from '../useBridgeSession';
import { endHistoryWait } from './historyWait';

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

/** Longest the prefetch waits for an idle period before running anyway. */
const PREFETCH_IDLE_TIMEOUT_MS = 2000;
/** Stand-in for `requestIdleCallback` where it is missing. */
const PREFETCH_FALLBACK_DELAY_MS = 200;

type PayloadEvent<T> = { payload: T };

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
  const pageState: {
    key: string;
    symbol: string;
    timeframe: string;
    inFlight: boolean;
    anchorMs: number | undefined;
  } = { key: '', symbol: '', timeframe: '', inFlight: false, anchorMs: undefined };

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
      pageState.key = key;
      pageState.symbol = symbol;
      pageState.timeframe = timeframe;
      pageState.inFlight = false;
      pageState.anchorMs = undefined;
    }
    if (pageState.inFlight) {
      return;
    }
    pageState.inFlight = true;
    pageState.anchorMs = beforeMs;
    void adapter.requestHistoryPage(symbol, timeframe, HISTORY_BARS, beforeMs).catch(() => undefined);
  };
  // One idle prefetch per accepted snapshot: it runs after the first view has
  // painted, so the page that fills the history never competes with first
  // render. A newer snapshot, a pending selection change or teardown cancels it.
  let prefetchCancel: (() => void) | undefined;
  const cancelPrefetch = () => {
    prefetchCancel?.();
    prefetchCancel = undefined;
  };
  const schedulePrefetch = (dataKey: string) => {
    cancelPrefetch();
    let cancelled = false;
    let frame: number | undefined;
    let idle: number | undefined;
    let timer: number | undefined;
    const runPrefetch = () => {
      prefetchCancel = undefined;
      if (
        cancelled ||
        run.disposed ||
        dataKeyRef.current !== dataKey ||
        loadingTimeframeRef.current !== undefined ||
        targetSymbol.current !== undefined
      ) {
        return;
      }
      chartRef.current?.prefetchOlderHistory();
    };
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (typeof requestIdleCallback === 'function') {
        idle = requestIdleCallback(runPrefetch, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
      } else {
        timer = window.setTimeout(runPrefetch, PREFETCH_FALLBACK_DELAY_MS);
      }
    });
    prefetchCancel = () => {
      cancelled = true;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      if (idle !== undefined && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idle);
      }
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  };
  const resetPageState = () => {
    pageState.key = '';
    pageState.symbol = '';
    pageState.timeframe = '';
    pageState.inFlight = false;
    pageState.anchorMs = undefined;
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
    const expectedSymbol = targetSymbol.current ?? currentSymbolRef.current;
    const expectedTimeframe = loadingTimeframeRef.current ?? currentTimeframeRef.current;
    if (
      (!expectedSymbol || expectedSymbol === failure.symbol) &&
      (!expectedTimeframe || expectedTimeframe === failure.timeframe)
    ) {
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
    const expectedSymbol = targetSymbol.current ?? currentSymbolRef.current;
    const expectedTimeframe = loadingTimeframeRef.current ?? currentTimeframeRef.current;
    if ((expectedSymbol && expectedSymbol !== symbol) || (expectedTimeframe && expectedTimeframe !== timeframe)) {
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

  const onMarketSnapshot = (event: PayloadEvent<MarketSnapshot>) => {
    if (run.disposed || run.bridgeState !== 'connected') {
      return;
    }
    const next = normalizeSnapshot(event.payload);
    const targetSnapshot = targetSymbol.current === next.symbol;
    const expectedSymbol = targetSymbol.current ?? currentSymbolRef.current;
    const expectedTimeframe = loadingTimeframeRef.current ?? currentTimeframeRef.current;
    if (
      (expectedSymbol && next.symbol !== expectedSymbol) ||
      (expectedTimeframe && next.timeframe !== expectedTimeframe)
    ) {
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
    const validCandles = next.candles.filter((candle) => toRenderBar(candle) !== null);
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
      marketAdapterRef.current?.acceptSnapshot(accepted);
      const dataKey = `${accepted.symbol}:${accepted.timeframe}`;
      const replaced = dataKeyRef.current !== dataKey || (chartRef.current?.getData().length ?? 0) === 0;
      const chart = chartRef.current;
      const hasHistory = (chart?.getData().length ?? 0) > 0;
      // The same symbol always carries the view over, measured from the newest
      // bar: a timeframe change, and equally a window that replaces the series in
      // place (a fresh answer to a history request), whose newest bar may be
      // several bars later than the chart's. Pinning the old logical position
      // there left the newest bars off the right edge. Only a new symbol or a
      // fresh session (selection refs cleared) starts from the default view.
      // Auto scale is off by default, so replaceHistory fits the scale to the
      // new candles itself.
      const preserveViewport = currentSymbolRef.current === accepted.symbol && hasHistory;
      const viewportMode = preserveViewport ? HistoryViewportMode.BarsFromEnd : HistoryViewportMode.Reset;
      // Selection refs describe what is on screen, so set them before the swap:
      // a carried viewport can request an older page inside replaceHistory.
      dataKeyRef.current = dataKey;
      currentSymbolRef.current = accepted.symbol;
      currentTimeframeRef.current = accepted.timeframe;
      latestCandleRef.current = accepted.candles[accepted.candles.length - 1];
      setLatestCandle(latestCandleRef.current);
      chartRef.current?.setSymbol(accepted.symbol ?? '');
      const preserved =
        chartRef.current?.replaceHistory(accepted.candles, accepted.timeframe ?? DEFAULT_TIMEFRAME, viewportMode) ??
        false;
      if (replaced && !preserved) {
        chartRef.current?.resetView();
      }
      schedulePrefetch(dataKey);
      setChartError(
        next.candles.length > 0 && accepted.candles.length === 0
          ? 'MT5 returned candles, but none of them contain valid OHLC values.'
          : undefined,
      );
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
    const candles = page.candles.filter((candle) => isValidCandle(candle));
    chartRef.current?.appendOlderHistory(candles, page.complete);
  };

  /**
   * Chart tools read market data through the narrow `MarketDataPort`, never through
   * Tauri. This runtime keeps the single `listen` per event and forwards what its
   * run accepts into the port's feed; a disposed run forwards nothing.
   */
  const forwardMarketDataEvents = () => [
    listen<ProfileResult>('tick-profile', (event) => {
      if (!run.disposed) {
        publisher.publishTickProfile(event.payload);
      }
    }),
    listen<ProfileCancelled>('tick-profile-cancelled', (event) => {
      if (!run.disposed) {
        publisher.publishTickProfileCancelled(event.payload);
      }
    }),
    listen<ProfileError>('tick-profile-error', (event) => {
      if (!run.disposed) {
        publisher.publishTickProfileError(event.payload);
      }
    }),
  ];

  const onSymbolInfo = (event: PayloadEvent<BrokerSymbol>) => {
    const expected = targetSymbol.current ?? currentSymbolRef.current;
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
    const payload = event.payload;
    const candle = normalizeCandle('candle' in payload ? payload.candle : payload);
    const symbol = 'symbol' in payload ? payload.symbol : currentSymbolRef.current;
    const timeframe = 'timeframe' in payload ? payload.timeframe : currentTimeframeRef.current;
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
    cancelPrefetch,
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
