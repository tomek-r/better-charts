// Bridge listeners are the sole source of accepted history and live candles.
// Selection refs reject stale events; the coordinator owns request dedupe and timeout.
import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Candle, BrokerSymbol } from '../../shared/bridge/types';
import type { FixedRangeProfileRange } from '../chart/engine/fixedRangeProfileTool';
import { initialHistoryBarsFor } from '../chart/engine/initialHistoryWindow';
import { DEFAULT_TIMEFRAME } from '../../shared/bridge/timeframes';
import { useFieldSetterSelector } from '../../shared/state/domainStore';
import type { BridgeSessionStores } from './bridgeSessionStores';
import type { BridgeMarketResources } from './bridgeMarketRuntime';

const LIVE_PROFILE_REFRESH_MS = 2000;
const LIVE_PROFILE_PENDING_MAX_MS = 30_000;

type BridgeSessionParams = BridgeMarketResources & {
  stores: BridgeSessionStores;
  lastRequestedRangeRef: { current: { fromMs: number; endMs: number } | undefined };
};
export function useBridgeSession({
  stores,
  chart,
  adapterRef,
  fixedRangeProfileState,
  expectedFixedRangeProfile,
  fixedRangeProfileGeneration,
  lastRequestedRangeRef,
}: BridgeSessionParams) {
  const fixedRangeProfileGenerationRef = fixedRangeProfileGeneration;
  const expectedFixedRangeProfileRef = expectedFixedRangeProfile;
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
  const lastProfileSentAtRef = useRef(0);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshRangeRef = useRef<FixedRangeProfileRange | undefined>(undefined);
  const requestProfileRange = useCallback(
    (range = chart.current?.getProfileRange() ?? undefined, options: { keepProfile?: boolean } = {}) => {
      const symbol = currentSymbol.current;
      if (!symbol || !range) {
        return;
      }
      const { fromMs } = range;
      // Tick and quote times are broker server time. Ticks older than the newest quote are final, but the backend
      // caches a completed raw tick page by its requested end, so a request reaching past the newest tick would be
      // cached as complete and later live refreshes would be served that stale page. Historical ranges are unaffected.
      const quote = stores.quote.getState().quote;
      const newestBarMs = (chart.current?.getData().at(-1)?.time ?? 0) * 1000;
      const quoteMs = quote && quote.symbol === symbol && Number.isFinite(quote.timeMs) ? quote.timeMs : 0;
      const liveEdgeMs = [quoteMs, newestBarMs].find((ms) => ms > 0) ?? range.endMs;
      const requestEnd = Math.min(range.endMs, liveEdgeMs);
      if (requestEnd <= fromMs) {
        // Invalidate any in-flight result for the previous range so it cannot be painted for this one.
        expectedFixedRangeProfileRef.current = undefined;
        fixedRangeProfileGenerationRef.current += 1;
        if (!options.keepProfile) {
          fixedRangeProfileRef.current.profile = undefined;
        }
        fixedRangeProfileRef.current.range = { fromMs, toMs: range.endMs };
        chart.current?.refreshOverlays();
        return;
      }
      const generation = ++fixedRangeProfileGenerationRef.current;
      const sentAt = Date.now();
      lastProfileSentAtRef.current = sentAt;
      lastRequestedRangeRef.current = { fromMs, endMs: requestEnd };
      expectedFixedRangeProfileRef.current = { symbol, fromMs, endMs: requestEnd, generation, sentAt, settled: false };
      fixedRangeProfileRef.current.range = { fromMs, toMs: requestEnd };
      if (!options.keepProfile) {
        fixedRangeProfileState.current.profile = undefined;
      }
      chart.current?.refreshOverlays();
      void invoke('request_tick_profile', { symbol, fromMs, endMs: requestEnd, rows: 128 }).catch(() => undefined);
    },
    [
      chart,
      expectedFixedRangeProfileRef,
      fixedRangeProfileRef,
      fixedRangeProfileState,
      lastRequestedRangeRef,
      fixedRangeProfileGenerationRef,
      stores,
    ],
  );
  // Trailing throttle: a range being refreshed changes on every tick, so refreshes coalesce into one request per
  // interval. Always deferred so symbol-change effects run first. The range the chart reported last is remembered;
  // at fire time the chain ends unless the chart still holds that very range (its final refresh arrives after a bar passed the range end), so a deleted or re-placed range is dropped.
  const refreshLiveProfile = useCallback(
    (reported: FixedRangeProfileRange) => {
      refreshRangeRef.current = reported;
      if (liveRefreshTimerRef.current !== undefined) {
        return;
      }
      const arm = (delayMs: number) => {
        liveRefreshTimerRef.current = setTimeout(() => {
          liveRefreshTimerRef.current = undefined;
          const range = chart.current?.getProfileRange();
          const latest = refreshRangeRef.current;
          if (!range || !latest || range.fromMs !== latest.fromMs || range.endMs !== latest.endMs) {
            return;
          }
          const expected = expectedFixedRangeProfileRef.current;
          if (expected && !expected.settled && Date.now() - expected.sentAt < LIVE_PROFILE_PENDING_MAX_MS) {
            arm(LIVE_PROFILE_REFRESH_MS);
            return;
          }
          requestProfileRange(range, { keepProfile: true });
        }, delayMs);
      };
      arm(Math.max(0, lastProfileSentAtRef.current + LIVE_PROFILE_REFRESH_MS - Date.now()));
    },
    [chart, expectedFixedRangeProfileRef, requestProfileRange],
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
        await adapter.requestHistory(symbol, wire, initialHistoryBarsFor(chart.current));
      } catch {
        if (generation === requestGeneration.current) {
          loadingTimeframeRef.current = undefined;
          setLoadingTimeframe(undefined);
          setChartError('History request could not be sent.');
        }
      }
    },
    [adapterRef, chart, setChartError, setLoadingTimeframe, stores],
  );
  const requestSymbolSelection = useCallback(
    async (symbol: string, metadata?: BrokerSymbol) => {
      if (stores.connection.getState().status.state !== 'connected') {
        return;
      }
      pendingMetadata.current = metadata;
      targetSymbol.current = symbol;
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
          initialHistoryBarsFor(chart.current),
        );
      } catch {
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
      }
    },
    [adapterRef, chart, setChartError, setInstrument, setQuote, setSymbolLoading, stores],
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
    refreshLiveProfile,
  };
}

export type BridgeSessionState = ReturnType<typeof useBridgeSession>;
