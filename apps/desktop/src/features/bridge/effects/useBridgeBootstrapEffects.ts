// Owns one bootstrap/listener lifetime at its AppLifecycle slot; startup,
// event registration and cleanup stay coordinated here.
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SubscriptionScope } from '../../../shared/bridge/subscriptionScope';
import { toRenderBar } from '../../chart/engine/bars/mt5DataAdapter';
import type {
  BridgeStatus,
  AccountSnapshot,
  BarUpdate,
  BrokerSymbol,
  Candle,
  HistoryPage,
  HistoryUnavailable,
  MarketSnapshot,
  OrderCheckError,
  OrderCheckResult,
  PortfolioSnapshot,
  QuoteSnapshot,
  RiskPreview,
  RiskPreviewError,
  SelectionFallback,
} from '../../../shared/bridge/types';
import { normalizeAccount, normalizePortfolio, normalizeQuote, normalizeSnapshot } from '../bridgePayloadNormalizers';
import { initialHistoryBarsFor } from '../../chart/engine/bars/initialHistoryWindow';
import type { BridgeSessionState } from '../useBridgeSession';
import { beginHistoryWait, endHistoryWait } from '../historyWait';
import type { BridgeTicketResponsePort } from '../bridgeTicketResponseHandlers';
import { createBridgeMarketRuntime, type BridgeEffectRun, type BridgeMarketResources } from '../bridgeMarketRuntime';
import { createBridgeTicketResponseHandlers } from '../bridgeTicketResponseHandlers';
import {
  accountIdentityKey,
  isSameChartSelection,
  loadLastChartSelection,
  restorableSelection,
  settleStartRestore,
  type LastChartSelection,
} from '../lastChartSelection';
import { brokerListsSymbol } from '../brokerSymbolList';

type MarketAdapter = NonNullable<BridgeMarketResources['adapterRef']['current']>;

/**
 * The chart window saved for this account, when the broker still lists its
 * symbol and serves its timeframe. The window the session already opened needs
 * no check: it is on screen, so there is nothing to reopen.
 */
async function savedSelectionFor(
  account: Pick<AccountSnapshot, 'accountLogin' | 'brokerServer'> | undefined,
  supportedTimeframes: readonly string[] | undefined,
  shownWindow: LastChartSelection | undefined,
): Promise<LastChartSelection | undefined> {
  const accountKey = accountIdentityKey(account?.accountLogin, account?.brokerServer);
  const saved = restorableSelection(loadLastChartSelection(accountKey), supportedTimeframes);
  if (!saved || isSameChartSelection(saved, shownWindow) || !(await brokerListsSymbol(saved.symbol))) {
    return undefined;
  }
  return saved;
}

export function useBridgeBootstrapEffects(
  session: Pick<
    BridgeSessionState,
    | 'stores'
    | 'loadingTimeframeRef'
    | 'targetSymbol'
    | 'pendingMetadata'
    | 'currentSymbol'
    | 'currentTimeframe'
    | 'latestCandleRef'
    | 'dataKeyRef'
    | 'marketData'
  >,
  {
    chart,
    adapterRef,
    accountLoginRef,
    brokerServerRef,
    ticket,
  }: BridgeMarketResources & {
    accountLoginRef: { current: string | undefined };
    brokerServerRef: { current: string | undefined };
    ticket: BridgeTicketResponsePort;
  },
): void {
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
    marketData,
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
      marketData,
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
      setSymbolLoading,
      setChartError,
      setSnapshot,
      setLatestCandle,
      setQuote,
      setInstrument,
    } = bootstrapSession;
    const historyWaitSetters = {
      setHistoryWaitStartedAtMs: bootstrapSession.setHistoryWaitStartedAtMs,
      setHistoryUnavailable: bootstrapSession.setHistoryUnavailable,
    };
    const run: BridgeEffectRun = { disposed: false, bridgeState: 'disconnected' };
    const subscriptions = new SubscriptionScope();
    let runtimeAvailable = false;
    let bridgeIdentity = '';
    const marketRuntime = createBridgeMarketRuntime(run, bootstrapSession, {
      chart: chartRef,
      adapterRef: marketAdapterRef,
    });
    const ticketHandlers = createBridgeTicketResponseHandlers(
      run,
      bootstrapSession,
      ticketPort,
      accountLoginRef,
      brokerServerRef,
    );
    const requestWindow = (adapter: MarketAdapter, selection: LastChartSelection) => {
      beginHistoryWait(historyWaitSetters);
      void adapter
        .requestHistory(selection.symbol, selection.timeframe, initialHistoryBarsFor(chartRef.current))
        .catch(() => undefined);
    };
    // Reopens the saved window exactly like a user pick, so a refusal leaves the
    // session's own window on screen instead of an empty chart.
    const openSavedWindow = (adapter: MarketAdapter, saved: LastChartSelection) => {
      targetSymbol.current = saved.symbol;
      loadingTimeframeRef.current = saved.timeframe;
      setLoadingTimeframe(saved.timeframe);
      setSymbolLoading(true);
      setInstrument(undefined);
      setQuote(undefined);
      requestWindow(adapter, saved);
    };
    // The saved window is applied once per app run: on the first connected session
    // with a known account. Spent flag keeps later reconnects from overriding the
    // user's own picks. The account may arrive before or after the connected status.
    let restoreSpent = false;
    let connectedAccount: Pick<AccountSnapshot, 'accountLogin' | 'brokerServer'> | undefined;
    let supportedTimeframes: readonly string[] | undefined;
    const restoreOnFirstConnection = async () => {
      const adapter = marketAdapterRef.current;
      const account = connectedAccount;
      if (restoreSpent || run.disposed || run.bridgeState !== 'connected' || !adapter || !account) {
        return;
      }
      if (!accountIdentityKey(account.accountLogin, account.brokerServer)) {
        return;
      }
      restoreSpent = true;
      const shownWindow =
        currentSymbolRef.current && currentTimeframeRef.current
          ? { symbol: currentSymbolRef.current, timeframe: currentTimeframeRef.current }
          : undefined;
      const saved = await savedSelectionFor(account, supportedTimeframes, shownWindow);
      if (saved && !run.disposed && run.bridgeState === 'connected') {
        openSavedWindow(adapter, saved);
      }
      settleStartRestore();
    };
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
        const nextAccount = initialAccount ? normalizeAccount(initialAccount) : undefined;
        if (nextAccount) {
          setAccount(nextAccount);
        }
        supportedTimeframes = bridge.supportedTimeframes;
        if (run.bridgeState === 'connected' && nextAccount) {
          connectedAccount = nextAccount;
          // This start path applies the saved window itself, before any listener event.
          restoreSpent = Boolean(accountIdentityKey(nextAccount.accountLogin, nextAccount.brokerServer));
        }
        if (initialPortfolio) {
          setPortfolio(normalizePortfolio(initialPortfolio));
        }
        await subscriptions.register([
          listen<BridgeStatus>('bridge-status', (event) => {
            if (!run.disposed) {
              const next = event.payload;
              const identity = `${next.terminal ?? ''}|${next.account ?? ''}|${next.server ?? ''}`;
              const sessionReset =
                next.state !== 'connected' ||
                run.bridgeState !== 'connected' ||
                Boolean(bridgeIdentity && identity !== bridgeIdentity);
              if (sessionReset) {
                marketRuntime.cancelCandles();
                marketRuntime.cancelPrefetch();
                marketAdapterRef.current?.resetRequests();
                marketRuntime.resetPageState();
                loadingTimeframeRef.current = undefined;
                setLoadingTimeframe(undefined);
                // A pick that never got its window belongs to the old session; left set,
                // it would reject the new session's first window as a stale answer.
                targetSymbol.current = undefined;
                pendingMetadata.current = undefined;
                setSymbolLoading(false);
                chartRef.current?.resetTools('session');
                connectedAccount = undefined;
                currentSymbolRef.current = undefined;
                currentTimeframeRef.current = undefined;
                dataKeyRef.current = '';
                latestCandleRef.current = undefined;
                setLatestCandle(undefined);
                // A fresh connection makes the bridge request the initial history itself.
                if (next.state === 'connected') {
                  beginHistoryWait(historyWaitSetters);
                } else {
                  endHistoryWait(historyWaitSetters);
                }
              }
              bridgeIdentity = identity;
              run.bridgeState = next.state;
              supportedTimeframes = next.supportedTimeframes;
              setStatus(next);
              void restoreOnFirstConnection();
            }
          }),
          listen<MarketSnapshot>('market-snapshot', marketRuntime.onMarketSnapshot),
          listen<HistoryPage>('history-page', marketRuntime.onHistoryPage),
          listen<HistoryUnavailable>('history-unavailable', marketRuntime.onHistoryUnavailable),
          listen<SelectionFallback>('selection-fallback', marketRuntime.onSelectionFallback),
          ...marketRuntime.forwardMarketDataEvents(),
          listen<BrokerSymbol>('symbol-info', marketRuntime.onSymbolInfo),
          listen<QuoteSnapshot>('quote-update', marketRuntime.onQuoteUpdate),
          listen<AccountSnapshot>('account-snapshot', (event) => {
            if (!run.disposed) {
              const nextAccount = normalizeAccount(event.payload);
              accountLoginRef.current = nextAccount.accountLogin;
              brokerServerRef.current = nextAccount.brokerServer;
              setAccount(nextAccount);
              connectedAccount = nextAccount;
              void restoreOnFirstConnection();
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
          const shownWindow =
            acceptedInitial.symbol && acceptedInitial.timeframe
              ? { symbol: acceptedInitial.symbol, timeframe: acceptedInitial.timeframe }
              : undefined;
          const savedSelection =
            run.bridgeState === 'connected'
              ? await savedSelectionFor(nextAccount, bridge.supportedTimeframes, shownWindow)
              : undefined;
          if (run.disposed) {
            return;
          }
          if (run.bridgeState === 'connected' && savedSelection) {
            openSavedWindow(adapter, savedSelection);
          } else if (run.bridgeState === 'connected' && shownWindow) {
            requestWindow(adapter, shownWindow);
          }
          if (restoreSpent) {
            settleStartRestore();
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
      marketRuntime.cancelPrefetch();
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
    marketData,
  ]);
}
