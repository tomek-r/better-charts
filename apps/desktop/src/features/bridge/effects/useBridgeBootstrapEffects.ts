// Owns one bootstrap/listener lifetime at its AppLifecycle slot; startup,
// event registration and cleanup stay coordinated here.
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useNotifyError } from '../../../shared/ui/ErrorNotifications';
import { SubscriptionScope } from '../../../shared/bridge/subscriptionScope';
import { toRenderBar, type Mt5DataAdapter } from '../../chart/engine/mt5DataAdapter';
import type { ChartController } from '../../chart/engine/chartController';
import type { FixedRangeProfileState } from '../../chart/engine/fixedRangeProfileOverlay';
import type {
  BridgeStatus,
  AccountSnapshot,
  BarUpdate,
  BrokerSymbol,
  Candle,
  HistoryPage,
  MarketSnapshot,
  OrderCheckError,
  OrderCheckResult,
  PortfolioSnapshot,
  ProfileCancelled,
  ProfileError,
  ProfileResult,
  QuoteSnapshot,
  RiskPreview,
  RiskPreviewError,
} from '../../../shared/bridge/types';
import { normalizeAccount, normalizePortfolio, normalizeQuote, normalizeSnapshot } from '../normalizers';
import { HISTORY_BARS } from '../../../shared/bridge/limits';
import type { BridgeSessionState } from '../useBridgeSession';
import type { BridgeTicketResponsePort } from '../bridgeTicketResponseHandlers';
import { createBridgeMarketRuntime, type BridgeEffectRun } from '../bridgeMarketRuntime';
import { createBridgeTicketResponseHandlers } from '../bridgeTicketResponseHandlers';

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
  const stores = session.stores;
  const {
    loadingTimeframeRef,
    targetSymbol,
    pendingMetadata,
    currentSymbol: currentSymbolRef,
    currentTimeframe: currentTimeframeRef,
    latestCandleRef,
    dataKeyRef,
  } = session;
  const {
    riskVersion,
    riskBrokerVersion,
    riskPreviewDisplayRef,
    setRiskPreview,
    setRiskLoading,
    setRiskError,
    orderCheckGeneration,
    orderCheckPending,
    setOrderCheck,
    setOrderCheckLoading,
    setOrderCheckError,
  } = ticket;
  useEffect(() => {
    const bootstrapSession = {
      ...stores.connection.setters,
      ...stores.market.setters,
      ...stores.quote.setters,
      ...stores.account.setters,
      ...stores.portfolio.setters,
      loadingTimeframeRef,
      targetSymbol,
      pendingMetadata,
      currentSymbol: currentSymbolRef,
      currentTimeframe: currentTimeframeRef,
      latestCandleRef,
      dataKeyRef,
    };
    const ticketPort: BridgeTicketResponsePort = {
      riskVersion,
      riskBrokerVersion,
      riskPreviewDisplayRef,
      setRiskPreview,
      setRiskLoading,
      setRiskError,
      orderCheckGeneration,
      orderCheckPending,
      setOrderCheck,
      setOrderCheckLoading,
      setOrderCheckError,
    };
    const {
      setStatus,
      setTauriAvailable,
      setAccount,
      setPortfolio,
      setLoadingTimeframe,
      setChartError,
      setSnapshot,
      setLatestCandle,
      setQuote,
    } = bootstrapSession;
    const run: BridgeEffectRun = { disposed: false, bridgeState: 'disconnected' };
    const subscriptions = new SubscriptionScope();
    let runtimeAvailable = false;
    let bridgeIdentity = '';
    const marketRuntime = createBridgeMarketRuntime(
      run,
      bootstrapSession,
      { chart: chartRef, adapterRef: marketAdapterRef, fixedRangeProfileState, expectedProfile, profileGeneration },
      notifyError,
    );
    const ticketHandlers = createBridgeTicketResponseHandlers(
      run,
      bootstrapSession,
      ticketPort,
      accountLoginRef,
      brokerServerRef,
    );
    const start = async () => {
      // Capture the adapter before any await: once this run is disposed the ref
      // may already point at the NEXT mount's adapter, which we must not touch.
      const adapter = marketAdapterRef.current;
      try {
        const [bridge, market, initialQuote, initialAccount, initialPortfolio] = await Promise.all([
          invoke<BridgeStatus>('get_bridge_status'),
          invoke<MarketSnapshot>('get_market_snapshot'),
          invoke<QuoteSnapshot | null>('get_quote_snapshot'),
          invoke<AccountSnapshot | null>('get_account_snapshot'),
          invoke<PortfolioSnapshot | null>('get_portfolio_snapshot'),
        ]);
        if (run.disposed) {
          return;
        }
        runtimeAvailable = true;
        setStatus(bridge);
        run.bridgeState = bridge.state;
        bridgeIdentity = `${bridge.terminal ?? ''}|${bridge.account ?? ''}|${bridge.server ?? ''}`;
        if (bridge.state !== 'connected') {
          adapter?.resetRequests();
        }
        const initialMarket = normalizeSnapshot(market);
        const initialCandles = initialMarket.candles.filter((candle) => toRenderBar(candle) !== null);
        const acceptedInitial = { ...initialMarket, candles: initialCandles };
        if (run.bridgeState === 'connected' && acceptedInitial.symbol && acceptedInitial.timeframe) {
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
          setAccount(nextAccount);
        }
        if (initialPortfolio) {
          setPortfolio(normalizePortfolio(initialPortfolio));
        }
        await subscriptions.register([
          listen<BridgeStatus>('bridge-status', (event) => {
            if (!run.disposed) {
              const next = event.payload;
              const identity = `${next.terminal ?? ''}|${next.account ?? ''}|${next.server ?? ''}`;
              if (
                next.state !== 'connected' ||
                run.bridgeState !== 'connected' ||
                (bridgeIdentity && identity !== bridgeIdentity)
              ) {
                marketRuntime.cancelCandles();
                marketAdapterRef.current?.resetRequests();
                marketRuntime.resetPageState();
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
              run.bridgeState = next.state;
              setStatus(next);
            }
          }),
          listen<MarketSnapshot>('market-snapshot', marketRuntime.onMarketSnapshot),
          listen<HistoryPage>('history-page', marketRuntime.onHistoryPage),
          listen<ProfileResult>('tick-profile', marketRuntime.onTickProfile),
          listen<ProfileCancelled>('tick-profile-cancelled', marketRuntime.onTickProfileCancelled),
          listen<ProfileError>('tick-profile-error', marketRuntime.onTickProfileError),
          listen<BrokerSymbol>('symbol-info', marketRuntime.onSymbolInfo),
          listen<QuoteSnapshot>('quote-update', marketRuntime.onQuoteUpdate),
          listen<AccountSnapshot>('account-snapshot', (event) => {
            if (!run.disposed) {
              const nextAccount = normalizeAccount(event.payload);
              accountLoginRef.current = nextAccount.accountLogin;
              brokerServerRef.current = nextAccount.brokerServer;
              setAccount(nextAccount);
            }
          }),
          listen<PortfolioSnapshot>('portfolio-snapshot', (event) => {
            if (!run.disposed && accountLoginRef.current && event.payload.accountLogin === accountLoginRef.current) {
              setPortfolio(normalizePortfolio(event.payload));
            }
          }),
          listen<RiskPreview>('risk-preview', ticketHandlers.onRiskPreview),
          listen<RiskPreviewError>('risk-preview-error', ticketHandlers.onRiskPreviewError),
          listen<OrderCheckResult>('order-check-result', ticketHandlers.onOrderCheckResult),
          listen<OrderCheckError>('order-check-error', ticketHandlers.onOrderCheckError),
          // Coalesce same-bar ticks before paint; retain every distinct new bar.
          listen<BarUpdate | Candle>('bar-update', marketRuntime.onBarUpdate),
        ]);
        // The scope releases late registrations after this run is disposed.
        if (run.disposed) {
          return;
        }
        if (adapter) {
          subscriptions.add(adapter.onError(marketRuntime.onAdapterHistoryError));
          // The chart reports a revealed gap; the hook owns the request and the
          // in-flight guard it needs. Cleared only if it is still the callback
          // this effect installed, so a remount cannot detach the new one.
          const chart = chartRef.current;
          if (chart) {
            chart.onOlderHistoryNeeded = marketRuntime.requestOlderHistory;
            subscriptions.add(() => {
              if (chart.onOlderHistoryNeeded === marketRuntime.requestOlderHistory) {
                chart.onOlderHistoryNeeded = undefined;
              }
            });
          }
          // The cached market snapshot has no instrument metadata. The existing
          // history command also requests symbol-info; dispatch once after its
          // listeners are ready so a reopened workspace restores SL/TP amounts.
          if (run.bridgeState === 'connected' && acceptedInitial.symbol && acceptedInitial.timeframe) {
            void adapter
              .requestHistory(acceptedInitial.symbol, acceptedInitial.timeframe, HISTORY_BARS)
              .catch(() => undefined);
          }
        }
      } catch {
        if (!run.disposed) {
          setTauriAvailable(runtimeAvailable);
          setStatus({
            state: 'disconnected',
            message: runtimeAvailable
              ? 'Bridge event listeners could not be initialized.'
              : 'Tauri runtime unavailable. Run this screen through the desktop shell to connect.',
          });
        }
      }
    };
    void start();
    return () => {
      run.disposed = true;
      marketRuntime.cancelCandles();
      subscriptions.dispose();
    };
    // The app-level listeners are the sole source for history and realtime chart updates.
  }, [
    stores,
    loadingTimeframeRef,
    targetSymbol,
    pendingMetadata,
    currentSymbolRef,
    currentTimeframeRef,
    latestCandleRef,
    dataKeyRef,
    riskVersion,
    riskBrokerVersion,
    riskPreviewDisplayRef,
    setRiskPreview,
    setRiskLoading,
    setRiskError,
    orderCheckGeneration,
    orderCheckPending,
    setOrderCheck,
    setOrderCheckLoading,
    setOrderCheckError,
    accountLoginRef,
    brokerServerRef,
    chartRef,
    marketAdapterRef,
    fixedRangeProfileState,
    expectedProfile,
    profileGeneration,
    notifyError,
  ]);
}
