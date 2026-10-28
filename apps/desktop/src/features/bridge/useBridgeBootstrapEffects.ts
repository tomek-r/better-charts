// Owns one bootstrap/listener lifetime at its AppLifecycle slot; startup,
// event registration and cleanup stay coordinated here.
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SubscriptionScope } from '../../shared/bridge/subscriptionScope';
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
} from '../../shared/bridge/types';
import type { BridgeSessionState } from './useBridgeSession';
import type { AccountRefs } from './bridgeEventTypes';
import type { BridgeTicketResponsePort } from './bridgeTicketResponseHandlers';
import { applyInitialBridgeState } from './applyInitialBridgeState';
import { createBridgeSessionHandlers } from './bridgeSessionHandlers';
import { createBridgeTicketResponseHandlers } from './bridgeTicketResponseHandlers';
import { fetchInitialBridgeState } from './fetchInitialBridgeState';
import { createSavedWindowRestore, createSavedWindowRestoreState } from './lastChartSelection/savedWindowRestore';
import {
  createBridgeMarketRuntime,
  type BridgeEffectRun,
  type BridgeMarketResources,
} from './market/bridgeMarketRuntime';

/**
 * The chart reports a revealed gap; the market runtime owns the request and the
 * in-flight guard it needs. Cleared only if it is still the callback this effect
 * installed, so a remount cannot detach the new one.
 */
function installOlderHistoryRequest(
  chart: BridgeMarketResources['chart']['current'],
  requestOlderHistory: (beforeMs: number) => void,
  subscriptions: SubscriptionScope,
): void {
  if (!chart) {
    return;
  }
  chart.onOlderHistoryNeeded = requestOlderHistory;
  subscriptions.add(() => {
    if (chart.onOlderHistoryNeeded === requestOlderHistory) {
      chart.onOlderHistoryNeeded = undefined;
    }
  });
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
    | 'historyWaitSetters'
  >,
  {
    chart,
    adapterRef,
    accountLoginRef,
    brokerServerRef,
    ticket,
  }: BridgeMarketResources &
    AccountRefs & {
      ticket: BridgeTicketResponsePort;
    },
): void {
  const {
    stores,
    loadingTimeframeRef,
    targetSymbol,
    pendingMetadata,
    currentSymbol,
    currentTimeframe,
    latestCandleRef,
    dataKeyRef,
    marketData,
    historyWaitSetters,
  } = session;
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
      currentSymbol,
      currentTimeframe,
      latestCandleRef,
      dataKeyRef,
      marketData,
      historyWaitSetters,
    };
    const resources = { chart, adapterRef };
    const run: BridgeEffectRun = { disposed: false, bridgeState: 'disconnected' };
    const subscriptions = new SubscriptionScope();
    let runtimeAvailable = false;
    const restoreState = createSavedWindowRestoreState();
    const marketRuntime = createBridgeMarketRuntime(run, bootstrapSession, resources);
    const ticketHandlers = createBridgeTicketResponseHandlers(run, currentSymbol, ticket, {
      accountLoginRef,
      brokerServerRef,
    });
    const restore = createSavedWindowRestore(run, bootstrapSession, resources, restoreState);
    const sessionHandlers = createBridgeSessionHandlers({
      run,
      session: bootstrapSession,
      resources,
      accountRefs: { accountLoginRef, brokerServerRef },
      marketRuntime,
      restore,
      restoreState,
    });
    const start = async () => {
      // Capture the adapter before any await: once this run is disposed the ref
      // may already point at the NEXT mount's adapter, which we must not touch.
      const adapter = adapterRef.current;
      try {
        const initial = await fetchInitialBridgeState();
        if (run.disposed) {
          return;
        }
        runtimeAvailable = true;
        const { shownWindow, account } = applyInitialBridgeState(
          {
            run,
            session: bootstrapSession,
            resources,
            restoreState,
            rememberBridgeIdentity: sessionHandlers.rememberBridgeIdentity,
          },
          adapter,
          initial,
        );
        await subscriptions.register([
          listen<BridgeStatus>('bridge-status', sessionHandlers.onBridgeStatus),
          listen<MarketSnapshot>('market-snapshot', marketRuntime.onMarketSnapshot),
          listen<HistoryPage>('history-page', marketRuntime.onHistoryPage),
          listen<HistoryUnavailable>('history-unavailable', marketRuntime.onHistoryUnavailable),
          listen<SelectionFallback>('selection-fallback', marketRuntime.onSelectionFallback),
          ...marketRuntime.forwardMarketDataEvents(),
          listen<BrokerSymbol>('symbol-info', marketRuntime.onSymbolInfo),
          listen<QuoteSnapshot>('quote-update', marketRuntime.onQuoteUpdate),
          listen<AccountSnapshot>('account-snapshot', sessionHandlers.onAccountSnapshot),
          listen<PortfolioSnapshot>('portfolio-snapshot', sessionHandlers.onPortfolioSnapshot),
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
          installOlderHistoryRequest(chart.current, marketRuntime.requestOlderHistory, subscriptions);
          await restore.openStartWindow(adapter, {
            shownWindow,
            account,
            supportedTimeframes: initial.status.supportedTimeframes,
          });
        }
      } catch {
        if (!run.disposed) {
          bootstrapSession.setTauriAvailable(runtimeAvailable);
          bootstrapSession.setStatus({
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
    currentSymbol,
    currentTimeframe,
    latestCandleRef,
    dataKeyRef,
    marketData,
    historyWaitSetters,
    ticket,
    accountLoginRef,
    brokerServerRef,
    chart,
    adapterRef,
  ]);
}
