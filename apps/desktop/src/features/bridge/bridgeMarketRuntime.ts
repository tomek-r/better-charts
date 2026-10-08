import { HistoryViewportMode, type ChartController } from '../chart/engine/chartController';
import { toRenderBar, type Mt5DataAdapter, type Mt5HistoryError } from '../chart/engine/mt5DataAdapter';
import type { FixedRangeProfileState } from '../chart/engine/fixedRangeProfileOverlay';
import type {
  BridgeStatus,
  BarUpdate,
  Candle,
  HistoryPage,
  MarketSnapshot,
  ProfileResult,
  ProfileCancelled,
  ProfileError,
  BrokerSymbol,
  QuoteSnapshot,
} from '../../shared/bridge/types';
import { normalizeCandle, normalizeHistoryPage, normalizeSnapshot, isValidCandle, normalizeQuote } from './normalizers';
import { HISTORY_BARS } from '../../shared/bridge/limits';
import { DEFAULT_TIMEFRAME } from '../../shared/bridge/timeframes';
import type { BridgeSessionState } from './useBridgeSession';

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
  | 'targetSymbol'
  | 'pendingMetadata'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'latestCandleRef'
  | 'dataKeyRef'
>;

type BridgeMarketResources = {
  chart: { current: ChartController | null };
  adapterRef: { current: Mt5DataAdapter | null };
  fixedRangeProfileState: { current: FixedRangeProfileState };
  expectedProfile: { current: { symbol: string; fromMs: number; endMs: number; generation: number } | undefined };
  profileGeneration: { current: number };
};

type PayloadEvent<T> = { payload: T };

/** Market history, paging, profiles and live updates share one effect-run lifetime. */
export function createBridgeMarketRuntime(
  run: BridgeEffectRun,
  session: BridgeMarketSession,
  resources: BridgeMarketResources,
  notifyError: (message: string) => void,
) {
  const chartRef = resources.chart;
  const marketAdapterRef = resources.adapterRef;
  const { fixedRangeProfileState, expectedProfile, profileGeneration } = resources;
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
    targetSymbol,
    pendingMetadata,
    currentSymbol: currentSymbolRef,
    currentTimeframe: currentTimeframeRef,
    latestCandleRef,
    dataKeyRef,
  } = session;
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
  const resetPageState = () => {
    pageState.key = '';
    pageState.symbol = '';
    pageState.timeframe = '';
    pageState.inFlight = false;
    pageState.anchorMs = undefined;
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
      setChartError(failure.kind === 'timeout' ? 'History request timed out.' : 'History request could not be sent.');
      if (targetSymbol.current === failure.symbol) {
        targetSymbol.current = undefined;
        pendingMetadata.current = undefined;
        setSymbolLoading(false);
      }
    }
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
      // Auto scale is off by default, so there is no "the user has not
      // touched anything yet" case to fall back to: a timeframe change
      // always carries the view over, and replaceHistory fits the scale to
      // the new candles itself.
      const preserveTimeframeViewport =
        currentSymbolRef.current === accepted.symbol &&
        currentTimeframeRef.current !== accepted.timeframe &&
        hasHistory;
      const viewportMode = preserveTimeframeViewport ? HistoryViewportMode.BarsFromEnd : HistoryViewportMode.Reset;
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

  const onTickProfile = (event: PayloadEvent<ProfileResult>) => {
    const expected = expectedProfile.current;
    if (
      !run.disposed &&
      expected &&
      event.payload.symbol === expected.symbol &&
      event.payload.fromMs === expected.fromMs &&
      event.payload.endMs === expected.endMs &&
      event.payload.symbol === currentSymbolRef.current &&
      event.payload.complete !== undefined &&
      expected.generation === profileGeneration.current
    ) {
      fixedRangeProfileState.current.profile = event.payload;
      chartRef.current?.refreshOverlays();
    }
  };

  const onTickProfileCancelled = (event: PayloadEvent<ProfileCancelled>) => {
    const expected = expectedProfile.current;
    if (
      !run.disposed &&
      expected &&
      event.payload.symbol === expected.symbol &&
      event.payload.fromMs === expected.fromMs &&
      event.payload.endMs === expected.endMs &&
      expected.generation === profileGeneration.current
    ) {
      expectedProfile.current = undefined;
      profileGeneration.current += 1;
    }
  };

  const onTickProfileError = (event: PayloadEvent<ProfileError>) => {
    const expected = expectedProfile.current;
    if (
      !run.disposed &&
      expected &&
      event.payload.symbol === expected.symbol &&
      event.payload.fromMs === expected.fromMs &&
      event.payload.endMs === expected.endMs &&
      expected.generation === profileGeneration.current
    ) {
      notifyError(event.payload.message);
      expectedProfile.current = undefined;
      profileGeneration.current += 1;
    }
  };

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
    const payload = event.payload as BarUpdate | Candle;
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
    resetPageState,
    requestOlderHistory,
    onAdapterHistoryError,
    onMarketSnapshot,
    onHistoryPage,
    onTickProfile,
    onTickProfileCancelled,
    onTickProfileError,
    onSymbolInfo,
    onQuoteUpdate,
    onBarUpdate,
  };
}
