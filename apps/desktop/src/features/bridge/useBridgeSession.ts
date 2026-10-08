import { useNotifyError } from '../../shared/ui/ErrorNotifications';
import { accountMoneyBasis } from '../../shared/money';
// Bridge listeners are the sole source of accepted history and live candles.
// Selection refs reject stale events; the coordinator owns request dedupe and timeout.
import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SubscriptionScope } from '../../shared/bridge/subscriptionScope';
import { HistoryViewportMode, type ChartController } from '../chart/engine/chartController';
import { toRenderBar, type Mt5DataAdapter, type Mt5HistoryError } from '../chart/engine/mt5DataAdapter';
import type { FixedRangeProfileState } from '../chart/engine/fixedRangeProfileOverlay';
import type { PositionOverlayState } from '../chart/engine/positionOverlay';
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
  AccountSnapshot,
  RiskPreview,
  RiskPreviewError,
  PortfolioSnapshot,
  OrderCheckResult,
  OrderCheckError,
  ExecutionSafetyStatus,
  ReconciliationStatus,
} from '../../shared/bridge/types';
import {
  normalizeCandle,
  normalizeHistoryPage,
  normalizeSnapshot,
  isValidCandle,
  normalizeQuote,
  normalizeAccount,
  normalizePortfolio,
} from './normalizers';
import { syncPositionOverlay } from '../chart/engine/overlayLines';
import { quoteDigits } from '../../shared/format';
import type { OrderTicketState } from '../order-ticket/state/useOrderTicket';
import { HISTORY_BARS } from '../../shared/bridge/limits';
import { DEFAULT_TIMEFRAME } from '../../shared/bridge/timeframes';
import { useFieldSetterSelector } from '../../shared/state/domainStore';
import type { BridgeSessionStores } from './bridgeSessionStores';

type BridgeTicketResponsePort = Pick<
  OrderTicketState,
  | 'riskVersion'
  | 'riskBrokerVersion'
  | 'riskPreviewDisplayRef'
  | 'setRiskPreview'
  | 'setRiskLoading'
  | 'setRiskError'
  | 'orderCheckGeneration'
  | 'orderCheckPending'
  | 'setOrderCheck'
  | 'setOrderCheckLoading'
  | 'setOrderCheckError'
>;

/** Bars per lazy-loading page; the protocol's per-request maximum. */
const LAZY_HISTORY_BARS = HISTORY_BARS;

type BridgeSessionParams = {
  stores: BridgeSessionStores;
  chart: { current: ChartController | null };
  adapterRef: { current: Mt5DataAdapter | null };
  fixedRangeProfileState: { current: FixedRangeProfileState };
  expectedProfile: { current: { symbol: string; fromMs: number; endMs: number; generation: number } | undefined };
  profileGeneration: { current: number };
  lastRequestedRangeRef: { current: { fromMs: number; endMs: number } | undefined };
};
export function useBridgeSession({
  stores,
  chart,
  adapterRef,
  fixedRangeProfileState,
  expectedProfile,
  profileGeneration,
  lastRequestedRangeRef,
}: BridgeSessionParams) {
  const profileGenerationRef = profileGeneration;
  const expectedProfileRef = expectedProfile;
  const fixedRangeProfileRef = fixedRangeProfileState;
  const pendingMetadata = useRef<BrokerSymbol | undefined>(undefined);
  const dataKeyRef = useRef('');
  const latestCandleRef = useRef<Candle | undefined>(undefined);
  const currentSymbol = useRef<string | undefined>(undefined);
  const currentTimeframe = useRef<string | undefined>(undefined);
  const requestGeneration = useRef(0);
  const loadingTimeframeRef = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  const targetSymbol = useRef<string | undefined>(undefined);
  const { setStatus, setTauriAvailable } = useFieldSetterSelector(stores.connection, (setters) => setters);
  const {
    setSnapshot,
    setLatestCandle,
    setInstrument,
    setLastSymbolSelection,
    setLoadingTimeframe,
    setSymbolLoading,
    setChartError,
  } = useFieldSetterSelector(stores.market, (setters) => setters);
  const { setQuote } = useFieldSetterSelector(stores.quote, (setters) => setters);
  const { setAccount } = useFieldSetterSelector(stores.account, (setters) => setters);
  const { setPortfolio } = useFieldSetterSelector(stores.portfolio, (setters) => setters);
  const requestProfileRange = useCallback(
    (reason: string, range = chart.current?.getProfileRange() ?? undefined) => {
      const symbol = currentSymbol.current;
      if (!symbol || !range) {
        return;
      }
      const { fromMs, endMs } = range;
      lastRequestedRangeRef.current = { fromMs, endMs };
      const generation = ++profileGenerationRef.current;
      expectedProfileRef.current = { symbol, fromMs, endMs, generation };
      fixedRangeProfileRef.current.range = { fromMs, toMs: endMs };
      fixedRangeProfileState.current.profile = undefined;
      chart.current?.refreshOverlays();
      console.debug('Tick profile requested:', reason);
      void invoke('request_tick_profile', { symbol, fromMs, endMs, rows: 128 }).catch(() => {
        console.info('Tick profile request failed.');
      });
    },
    [
      chart,
      expectedProfileRef,
      fixedRangeProfileRef,
      fixedRangeProfileState,
      lastRequestedRangeRef,
      profileGenerationRef,
    ],
  );
  const requestHistory = useCallback(
    async (wire: string) => {
      const symbol = targetSymbol.current ?? stores.market.getState().snapshot.symbol;
      if (!symbol || stores.connection.getState().status.state !== 'connected') {
        return;
      }
      const generation = ++requestGeneration.current;
      loadingTimeframeRef.current = wire;
      setLoadingTimeframe(wire);
      try {
        const adapter = adapterRef.current;
        if (!adapter) {
          throw new Error('chart adapter unavailable');
        }
        await adapter.requestHistory(symbol, wire, HISTORY_BARS);
      } catch (error) {
        if (generation === requestGeneration.current) {
          loadingTimeframeRef.current = undefined;
          setLoadingTimeframe(undefined);
          setChartError('History request could not be sent.');
        }
        console.info('History request unavailable.', error);
      }
    },
    [adapterRef, setChartError, setLoadingTimeframe, stores],
  );
  const requestSymbolSelection = useCallback(
    async (symbol: string, metadata?: BrokerSymbol) => {
      if (stores.connection.getState().status.state !== 'connected') {
        return;
      }
      pendingMetadata.current = metadata;
      targetSymbol.current = symbol;
      if (metadata) {
        console.info('[instrument]', metadata);
      }
      setInstrument(metadata);
      setQuote(undefined);
      setSymbolLoading(true);
      setChartError(undefined);
      const generation = ++requestGeneration.current;
      try {
        const adapter = adapterRef.current;
        if (!adapter) {
          throw new Error('chart adapter unavailable');
        }
        await adapter.requestHistory(
          symbol,
          loadingTimeframeRef.current ?? stores.market.getState().snapshot.timeframe ?? DEFAULT_TIMEFRAME,
          HISTORY_BARS,
        );
      } catch (error) {
        if (generation !== requestGeneration.current) {
          return;
        }
        pendingMetadata.current = undefined;
        targetSymbol.current = undefined;
        if (metadata) {
          setInstrument(undefined);
        }
        setSymbolLoading(false);
        setChartError('History request could not be sent.');
        console.info('Symbol history unavailable.', error);
      }
    },
    [adapterRef, setChartError, setInstrument, setQuote, setSymbolLoading, stores],
  );
  const chooseSymbol = useCallback(
    (item: BrokerSymbol) => requestSymbolSelection(item.symbol, item),
    [requestSymbolSelection],
  );
  // Position rows have only a symbol name; metadata arrives from the bridge
  // during its history request, so this path clears instrument state meanwhile.
  const chooseSymbolByName = useCallback(
    async (rawSymbol: string) => {
      const symbol = rawSymbol.trim();
      const snapshot = stores.market.getState().snapshot;
      if (stores.connection.getState().status.state !== 'connected' || !symbol) {
        return;
      }
      if (symbol === snapshot.symbol || symbol === targetSymbol.current) {
        return;
      }
      await requestSymbolSelection(symbol);
    },
    [requestSymbolSelection, stores],
  );
  return {
    stores,
    status: stores.connection.getState().status,
    setStatus,
    snapshot: stores.market.getState().snapshot,
    setSnapshot,
    latestCandle: stores.market.getState().latestCandle,
    setLatestCandle,
    quote: stores.quote.getState().quote,
    setQuote,
    instrument: stores.market.getState().instrument,
    setInstrument,
    lastSymbolSelection: stores.market.getState().lastSymbolSelection,
    setLastSymbolSelection,
    account: stores.account.getState().account,
    setAccount,
    portfolio: stores.portfolio.getState().portfolio,
    setPortfolio,
    symbolLoading: stores.market.getState().symbolLoading,
    setSymbolLoading,
    chartError: stores.market.getState().chartError,
    setChartError,
    tauriAvailable: stores.connection.getState().tauriAvailable,
    setTauriAvailable,
    loadingTimeframe: stores.market.getState().loadingTimeframe,
    setLoadingTimeframe,
    loadingTimeframeRef,
    pendingMetadata,
    targetSymbol,
    currentSymbol,
    latestCandleRef,
    dataKeyRef,
    mounted,
    requestGeneration,
    currentTimeframe,
    requestHistory,
    chooseSymbol,
    chooseSymbolByName,
    requestProfileRange,
  };
}

export type BridgeSessionState = ReturnType<typeof useBridgeSession>;

// Keeps portfolio overlays synchronized with the current bridge snapshot.
export function useBridgeStreamEffects(
  session: BridgeSessionState,
  {
    chart,
    positionOverlayState,
    tradingSyncTick,
    submitSwapPendingRef,
    clearStagedWidget,
  }: {
    chart: { current: ChartController | null };
    positionOverlayState: { current: PositionOverlayState };
    tradingSyncTick: number;
    submitSwapPendingRef: { current: boolean };
    clearStagedWidget: OrderTicketState['clearStagedWidget'];
  },
): void {
  const { snapshot, instrument, account, portfolio, quote } = session;
  // Sync our position and pending-order overlays for the active symbol.
  useEffect(() => {
    const instance = chart.current;
    if (!instance) {
      return;
    }
    try {
      const matchingInstrument = instrument?.symbol === snapshot.symbol ? instrument : undefined;
      const pnlCurrency = account?.currency.trim() || undefined;
      const quotePrecision = quote && quote.symbol === snapshot.symbol ? quoteDigits(quote.bid, quote.ask) : undefined;
      const estimatedMoney = accountMoneyBasis(matchingInstrument, pnlCurrency, account?.currencyDigits);
      const changed = syncPositionOverlay(
        positionOverlayState.current,
        portfolio,
        snapshot.symbol,
        matchingInstrument?.digits ?? quotePrecision ?? positionOverlayState.current.digits,
        estimatedMoney,
        pnlCurrency,
        account?.currencyDigits,
      );
      // Repaint so the ui-layer overlay re-renders (the sync previously piggy-backed on setPositions' requestRender).
      if (submitSwapPendingRef.current) {
        // The fill landed: swap the frozen staged rows for the live rows in ONE
        // repaint (clearStagedWidget repaints when the widget was painted).
        submitSwapPendingRef.current = false;
        const had = clearStagedWidget();
        if (!had && changed) {
          instance.refreshOverlays();
        }
      } else if (changed) {
        instance.refreshOverlays();
      }
    } catch (error) {
      console.info('Trading overlay could not be synced.', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and callbacks are stable app-owned values.
  }, [
    portfolio,
    snapshot.symbol,
    tradingSyncTick,
    instrument?.symbol,
    instrument?.digits,
    instrument?.contractSize,
    instrument?.tickSize,
    instrument?.tickValueProfit,
    instrument?.tickValueLoss,
    instrument?.tickValueCurrency,
    account?.currency,
    account?.currencyDigits,
    quote?.symbol,
    quote?.bid,
    quote?.ask,
  ]);
}

// Effect slot (C1): the ONE bridge bootstrap (start() + the full listen(...)
// array) — registered at its former slot between the entry-reseed effects and
// the ⌘K handler. Listener bodies, command names and dep array frozen 1:1.
export function useBridgeBootstrapEffects(
  session: BridgeSessionState,
  {
    chart,
    adapterRef,
    fixedRangeProfileState,
    expectedProfile,
    profileGeneration,
    accountLoginRef,
    brokerServerRef,
    ticket,
  }: {
    chart: { current: ChartController | null };
    adapterRef: { current: Mt5DataAdapter | null };
    fixedRangeProfileState: { current: FixedRangeProfileState };
    expectedProfile: { current: { symbol: string; fromMs: number; endMs: number; generation: number } | undefined };
    profileGeneration: { current: number };
    accountLoginRef: { current: string | undefined };
    brokerServerRef: { current: string | undefined };
    ticket: BridgeTicketResponsePort;
  },
): void {
  const notifyError = useNotifyError();
  const chartRef = chart;
  const marketAdapterRef = adapterRef;
  const {
    loadingTimeframeRef,
    setLoadingTimeframe,
    setChartError,
    setStatus,
    setSnapshot,
    setLatestCandle,
    setQuote,
    setAccount,
    setPortfolio,
    setInstrument,
    setSymbolLoading,
    setTauriAvailable,
    targetSymbol,
    pendingMetadata,
    currentSymbol: currentSymbolRef,
    currentTimeframe: currentTimeframeRef,
    latestCandleRef,
    dataKeyRef,
  } = session;
  const {
    riskVersion,
    setRiskPreview,
    riskPreviewDisplayRef,
    riskBrokerVersion,
    setRiskLoading,
    setRiskError,
    orderCheckGeneration,
    orderCheckPending,
    setOrderCheck,
    setOrderCheckLoading,
    setOrderCheckError,
  } = ticket;
  useEffect(() => {
    let disposed = false;
    const subscriptions = new SubscriptionScope();
    let runtimeAvailable = false;
    let bridgeIdentity = '';
    let bridgeState: BridgeStatus['state'] = 'disconnected';
    const pendingCandles = new Map<number, Candle>();
    let candleFrame: number | undefined;
    /**
     * Older-history paging state, scoped to the selection it belongs to. Keying
     * it by symbol+timeframe is what cancels a page on a ticker or timeframe
     * change: a response for the previous selection can no longer match, and a
     * fresh selection starts with no page in flight and no exhaustion.
     */
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
      if (disposed || bridgeState !== 'connected' || !chartRef.current || candles.length === 0) {
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
      } catch (error) {
        setChartError('Live bar could not be rendered.');
        console.error(error);
      }
    };
    /**
     * Lazy loading: asked by the chart with the oldest bar it holds, once the
     * pane shows empty space before it. One page per selection is in flight at a
     * time, and the selection key drops in-flight bookkeeping the moment the
     * ticker or timeframe changes.
     */
    const requestOlderHistory = (beforeMs: number) => {
      const symbol = currentSymbolRef.current;
      const timeframe = currentTimeframeRef.current;
      const adapter = marketAdapterRef.current;
      if (disposed || bridgeState !== 'connected' || !symbol || !timeframe || !adapter) {
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
      void adapter.requestHistoryPage(symbol, timeframe, LAZY_HISTORY_BARS, beforeMs).catch((error) => {
        console.info('Older history page unavailable.', error);
      });
    };
    // Widget-originated fetches have no requestHistory() catch of their own —
    // mirror the old failure UX (the error message) for the affected timeframe.
    const onAdapterHistoryError = (failure: Mt5HistoryError) => {
      if (disposed) {
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
      console.info('History request failed.', failure.message);
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
    const start = async () => {
      // Capture the adapter before any await: once this run is disposed the ref
      // may already point at the NEXT mount's adapter, which we must not touch.
      const adapter = marketAdapterRef.current;
      try {
        const [
          bridge,
          market,
          initialQuote,
          initialAccount,
          initialPortfolio,
          initialExecutionSafety,
          initialReconciliation,
        ] = await Promise.all([
          invoke<BridgeStatus>('get_bridge_status'),
          invoke<MarketSnapshot>('get_market_snapshot'),
          invoke<QuoteSnapshot | null>('get_quote_snapshot'),
          invoke<AccountSnapshot | null>('get_account_snapshot'),
          invoke<PortfolioSnapshot | null>('get_portfolio_snapshot'),
          invoke<ExecutionSafetyStatus>('get_execution_safety_status').catch((error) => {
            console.info('Execution safety status unavailable.', error);
            return undefined;
          }),
          invoke<ReconciliationStatus>('get_reconciliation_status').catch((error) => {
            console.info('Reconciliation status unavailable.', error);
            return undefined;
          }),
        ]);
        if (disposed) {
          return;
        }
        runtimeAvailable = true;
        setStatus(bridge);
        bridgeState = bridge.state;
        bridgeIdentity = `${bridge.terminal ?? ''}|${bridge.account ?? ''}|${bridge.server ?? ''}`;
        if (bridge.state !== 'connected') {
          adapter?.resetRequests();
        }
        if (initialExecutionSafety) {
          console.info('[execution-safety]', initialExecutionSafety);
        }
        if (initialReconciliation) {
          console.info('[reconciliation]', {
            state: initialReconciliation.state,
            requestId: initialReconciliation.requestId,
            snapshotId: initialReconciliation.snapshotId,
            capturedAtMs: initialReconciliation.capturedAtMs,
            positions: initialReconciliation.positionCount,
            activeOrders: initialReconciliation.activeOrderCount,
            historyOrders: initialReconciliation.historyOrderCount,
            historyDeals: initialReconciliation.historyDealCount,
            message: initialReconciliation.message,
          });
        }
        const initialMarket = normalizeSnapshot(market);
        const initialCandles = initialMarket.candles.filter((candle) => toRenderBar(candle) !== null);
        const acceptedInitial = { ...initialMarket, candles: initialCandles };
        if (bridgeState === 'connected' && acceptedInitial.symbol && acceptedInitial.timeframe) {
          adapter?.acceptSnapshot(acceptedInitial);
          const dataKey = `${acceptedInitial.symbol}:${acceptedInitial.timeframe}`;
          const replaced = dataKeyRef.current !== dataKey || (chartRef.current?.getData().length ?? 0) === 0;
          currentSymbolRef.current = acceptedInitial.symbol;
          currentTimeframeRef.current = acceptedInitial.timeframe;
          latestCandleRef.current = acceptedInitial.candles[acceptedInitial.candles.length - 1];
          setLatestCandle(latestCandleRef.current);
          dataKeyRef.current = dataKey;
          chartRef.current?.setSymbol(acceptedInitial.symbol);
          const preserved =
            chartRef.current?.replaceHistory(acceptedInitial.candles, acceptedInitial.timeframe) ?? false;
          if (replaced && !preserved) {
            chartRef.current?.resetView();
          }
          setChartError(
            initialMarket.candles.length > 0 && initialCandles.length === 0
              ? 'MT5 returned candles, but none of them contain valid OHLC values.'
              : undefined,
          );
        }
        setSnapshot(acceptedInitial);
        if (initialQuote) {
          const nextQuote = normalizeQuote(initialQuote);
          if (!initialMarket.symbol || nextQuote.symbol === initialMarket.symbol) {
            setQuote(nextQuote);
          }
        }
        if (initialAccount) {
          const nextAccount = normalizeAccount(initialAccount);
          console.info('[account]', nextAccount);
          setAccount(nextAccount);
        }
        if (initialPortfolio) {
          setPortfolio(normalizePortfolio(initialPortfolio));
        }
        await subscriptions.register([
          listen<BridgeStatus>('bridge-status', (event) => {
            if (!disposed) {
              const next = event.payload;
              const identity = `${next.terminal ?? ''}|${next.account ?? ''}|${next.server ?? ''}`;
              if (
                next.state !== 'connected' ||
                bridgeState !== 'connected' ||
                (bridgeIdentity && identity !== bridgeIdentity)
              ) {
                cancelCandles();
                marketAdapterRef.current?.resetRequests();
                pageState.key = '';
                pageState.symbol = '';
                pageState.timeframe = '';
                pageState.inFlight = false;
                pageState.anchorMs = undefined;
                loadingTimeframeRef.current = undefined;
                setLoadingTimeframe(undefined);
                expectedProfile.current = undefined;
                profileGeneration.current += 1;
                chartRef.current?.clearProfileSelection();
                currentSymbolRef.current = undefined;
                currentTimeframeRef.current = undefined;
                dataKeyRef.current = '';
                latestCandleRef.current = undefined;
                setLatestCandle(undefined);
              }
              bridgeIdentity = identity;
              bridgeState = next.state;
              setStatus(next);
            }
          }),
          listen<MarketSnapshot>('market-snapshot', (event) => {
            if (disposed || bridgeState !== 'connected') {
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
                session.setLastSymbolSelection(metadata);
              }
              pendingMetadata.current = undefined;
              targetSymbol.current = undefined;
              setSymbolLoading(false);
            }
            const previousLatest = latestCandleRef.current;
            const validCandles = next.candles.filter((candle) => toRenderBar(candle) !== null);
            const nextLatest = validCandles[validCandles.length - 1];
            const sameSelection =
              currentSymbolRef.current === next.symbol && currentTimeframeRef.current === next.timeframe;
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
              // always carries the view over, and `replaceHistory` fits the scale
              // to the new candles itself.
              const preserveTimeframeViewport =
                currentSymbolRef.current === accepted.symbol &&
                currentTimeframeRef.current !== accepted.timeframe &&
                hasHistory;
              const viewportMode = preserveTimeframeViewport
                ? HistoryViewportMode.BarsFromEnd
                : HistoryViewportMode.Reset;
              // The selection refs describe what is on screen, so they are set
              // before the swap: a carried-over viewport can ask for an older page
              // from inside `replaceHistory`, and that request has to name the
              // timeframe being shown now.
              dataKeyRef.current = dataKey;
              currentSymbolRef.current = accepted.symbol;
              currentTimeframeRef.current = accepted.timeframe;
              latestCandleRef.current = accepted.candles[accepted.candles.length - 1];
              setLatestCandle(latestCandleRef.current);
              chartRef.current?.setSymbol(accepted.symbol ?? '');
              // Timeframe changes keep the intentional offset from the right
              // edge; reconnects and other history replacements reset to latest.
              const preserved =
                chartRef.current?.replaceHistory(
                  accepted.candles,
                  accepted.timeframe ?? DEFAULT_TIMEFRAME,
                  viewportMode,
                ) ?? false;
              if (replaced && !preserved) {
                chartRef.current?.resetView();
              }
              setChartError(
                next.candles.length > 0 && accepted.candles.length === 0
                  ? 'MT5 returned candles, but none of them contain valid OHLC values.'
                  : undefined,
              );
            } catch (error) {
              setChartError('Chart data could not be rendered.');
              console.error(error);
            }
            setSnapshot(accepted);
            if (loadingTimeframeRef.current === accepted.timeframe) {
              loadingTimeframeRef.current = undefined;
              setLoadingTimeframe(undefined);
            }
          }),
          listen<HistoryPage>('history-page', (event) => {
            if (disposed || bridgeState !== 'connected') {
              return;
            }
            const page = normalizeHistoryPage(event.payload);
            const symbol = currentSymbolRef.current;
            const timeframe = currentTimeframeRef.current;
            const key = `${symbol}|${timeframe}`;
            // The page must belong to the selection on screen *and* to the exact
            // anchor that asked for it. A page for the previous ticker,
            // timeframe or anchor is dropped, never prepended.
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
          }),
          listen<ReconciliationStatus>('reconciliation-status', (event) => {
            if (!disposed) {
              console.info('[reconciliation]', {
                state: event.payload.state,
                requestId: event.payload.requestId,
                snapshotId: event.payload.snapshotId,
                positions: event.payload.positionCount,
                activeOrders: event.payload.activeOrderCount,
                historyDeals: event.payload.historyDealCount,
                message: event.payload.message,
              });
            }
          }),
          listen<ProfileResult>('tick-profile', (event) => {
            const expected = expectedProfile.current;
            if (
              !disposed &&
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
          }),
          listen<ProfileCancelled>('tick-profile-cancelled', (event) => {
            const expected = expectedProfile.current;
            if (
              !disposed &&
              expected &&
              event.payload.symbol === expected.symbol &&
              event.payload.fromMs === expected.fromMs &&
              event.payload.endMs === expected.endMs &&
              expected.generation === profileGeneration.current
            ) {
              expectedProfile.current = undefined;
              profileGeneration.current += 1;
            }
          }),
          listen<ProfileError>('tick-profile-error', (event) => {
            const expected = expectedProfile.current;
            if (
              !disposed &&
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
          }),
          listen<BrokerSymbol>('symbol-info', (event) => {
            const expected = targetSymbol.current ?? currentSymbolRef.current;
            if (!disposed && expected && event.payload.symbol === expected) {
              console.info('[instrument]', event.payload);
              setInstrument(event.payload);
            }
          }),
          listen<QuoteSnapshot>('quote-update', (event) => {
            if (!disposed) {
              const nextQuote = normalizeQuote(event.payload);
              if (currentSymbolRef.current && nextQuote.symbol === currentSymbolRef.current) {
                setQuote(nextQuote);
              }
            }
          }),
          listen<AccountSnapshot>('account-snapshot', (event) => {
            if (!disposed) {
              const nextAccount = normalizeAccount(event.payload);
              accountLoginRef.current = nextAccount.accountLogin;
              brokerServerRef.current = nextAccount.brokerServer;
              console.info('[account]', nextAccount);
              setAccount(nextAccount);
            }
          }),
          listen<PortfolioSnapshot>('portfolio-snapshot', (event) => {
            if (!disposed && accountLoginRef.current && event.payload.accountLogin === accountLoginRef.current) {
              setPortfolio(normalizePortfolio(event.payload));
            }
          }),
          listen<RiskPreview>('risk-preview', (event) => {
            if (
              !disposed &&
              event.payload.draftVersion === riskVersion.current &&
              event.payload.symbol === currentSymbolRef.current
            ) {
              riskBrokerVersion.current = event.payload.draftVersion;
              console.info('[risk-preview]', event.payload);
              setRiskPreview(event.payload);
              riskPreviewDisplayRef.current = event.payload;
              setRiskLoading(false);
              setRiskError(undefined);
            }
          }),
          listen<RiskPreviewError>('risk-preview-error', (event) => {
            if (!disposed && event.payload.draftVersion === riskVersion.current) {
              setRiskLoading(false);
              setRiskError(event.payload.message);
            }
          }),
          listen<OrderCheckResult>('order-check-result', (event) => {
            const pending = orderCheckPending.current;
            const result = event.payload;
            if (
              !disposed &&
              pending &&
              pending.generation === orderCheckGeneration.current &&
              pending.draftVersion === riskVersion.current &&
              result.draftVersion === pending.draftVersion &&
              result.symbol === pending.symbol &&
              result.accountLogin === pending.accountLogin &&
              result.brokerServer === pending.brokerServer &&
              result.symbol === currentSymbolRef.current &&
              result.accountLogin === accountLoginRef.current &&
              result.brokerServer === brokerServerRef.current
            ) {
              setOrderCheck(result);
              setOrderCheckLoading(false);
              setOrderCheckError(undefined);
              orderCheckPending.current = undefined;
            }
          }),
          listen<OrderCheckError>('order-check-error', (event) => {
            const pending = orderCheckPending.current;
            const error = event.payload;
            if (
              !disposed &&
              pending &&
              pending.generation === orderCheckGeneration.current &&
              pending.draftVersion === riskVersion.current &&
              error.draftVersion === pending.draftVersion
            ) {
              setOrderCheck(undefined);
              setOrderCheckLoading(false);
              setOrderCheckError(error.message);
              orderCheckPending.current = undefined;
            }
          }),
          // Coalesce same-bar ticks before paint; retain every distinct new bar.
          listen<BarUpdate | Candle>('bar-update', (event) => {
            if (disposed || bridgeState !== 'connected' || !chartRef.current) {
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
          }),
        ]);
        // The scope releases late registrations after this run is disposed.
        if (disposed) {
          return;
        }
        if (adapter) {
          subscriptions.add(adapter.onError(onAdapterHistoryError));
          // The chart reports a revealed gap; the hook owns the request and the
          // in-flight guard it needs. Cleared only if it is still the callback
          // this effect installed, so a remount cannot detach the new one.
          const chart = chartRef.current;
          if (chart) {
            chart.onOlderHistoryNeeded = requestOlderHistory;
            subscriptions.add(() => {
              if (chart.onOlderHistoryNeeded === requestOlderHistory) {
                chart.onOlderHistoryNeeded = undefined;
              }
            });
          }
          // The cached market snapshot has no instrument metadata. The existing
          // history command also requests symbol-info; dispatch once after its
          // listeners are ready so a reopened workspace restores SL/TP amounts.
          if (bridgeState === 'connected' && acceptedInitial.symbol && acceptedInitial.timeframe) {
            void adapter
              .requestHistory(acceptedInitial.symbol, acceptedInitial.timeframe, HISTORY_BARS)
              .catch((error) => {
                console.info('Initial history request unavailable.', error);
              });
          }
        }
      } catch (error) {
        if (!disposed) {
          setTauriAvailable(runtimeAvailable);
          setStatus({
            state: 'disconnected',
            message: runtimeAvailable
              ? 'Bridge event listeners could not be initialized.'
              : 'Tauri runtime unavailable. Run this screen through the desktop shell to connect.',
          });
        }
        console.info('Bridge initialization unavailable.', error);
      }
    };
    void start();
    return () => {
      disposed = true;
      cancelCandles();
      subscriptions.dispose();
    };
    // The app-level listeners are the sole source for history and realtime chart updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hook-provided setters/ref, stable identity (P5a)
  }, []);
}
