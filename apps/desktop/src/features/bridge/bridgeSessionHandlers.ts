import type { AccountSnapshot, BridgeStatus, PortfolioSnapshot } from '../../shared/bridge/types';
import { bridgeIdentityKey } from '../../shared/bridge/bridgeIdentity';
import { normalizeAccount, normalizePortfolio } from './bridgePayloadNormalizers';
import type { AccountRefs, PayloadEvent } from './bridgeEventTypes';
import type { SavedWindowRestoreState } from './lastChartSelection/savedWindowRestore';
import type { BridgeEffectRun, BridgeMarketResources, createBridgeMarketRuntime } from './market/bridgeMarketRuntime';
import { beginHistoryWait, endHistoryWait } from './market/historyWait';
import type { BridgeSessionState } from './useBridgeSession';

type BridgeSessionHandlersSession = Pick<
  BridgeSessionState,
  | 'setStatus'
  | 'setAccount'
  | 'setPortfolio'
  | 'setLoadingTimeframe'
  | 'setSymbolLoading'
  | 'setLatestCandle'
  | 'loadingTimeframeRef'
  | 'targetSymbol'
  | 'pendingMetadata'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'dataKeyRef'
  | 'latestCandleRef'
  | 'historyWaitSetters'
>;

interface BridgeSessionHandlersDependencies {
  run: BridgeEffectRun;
  session: BridgeSessionHandlersSession;
  resources: BridgeMarketResources;
  accountRefs: AccountRefs;
  marketRuntime: Pick<
    ReturnType<typeof createBridgeMarketRuntime>,
    'cancelCandles' | 'cancelPrefetch' | 'resetPageState'
  >;
  restore: { restoreOnFirstConnection: () => Promise<void> };
  restoreState: SavedWindowRestoreState;
}

/** Status, account and portfolio events: they decide when a session starts over and which account owns the data. */
export function createBridgeSessionHandlers({
  run,
  session,
  resources,
  accountRefs: { accountLoginRef, brokerServerRef },
  marketRuntime,
  restore,
  restoreState,
}: BridgeSessionHandlersDependencies) {
  const {
    setStatus,
    setAccount,
    setPortfolio,
    setLoadingTimeframe,
    setSymbolLoading,
    setLatestCandle,
    loadingTimeframeRef,
    targetSymbol,
    pendingMetadata,
    currentSymbol,
    currentTimeframe,
    dataKeyRef,
    latestCandleRef,
    historyWaitSetters,
  } = session;
  let bridgeIdentity = '';

  const rememberBridgeIdentity = (status: BridgeStatus) => {
    bridgeIdentity = bridgeIdentityKey(status);
  };

  const resetForNewSession = (nextState: BridgeStatus['state']) => {
    marketRuntime.cancelCandles();
    marketRuntime.cancelPrefetch();
    resources.adapterRef.current?.resetRequests();
    marketRuntime.resetPageState();
    loadingTimeframeRef.current = undefined;
    setLoadingTimeframe(undefined);
    // A pick that never got its window belongs to the old session; left set,
    // it would reject the new session's first window as a stale answer.
    targetSymbol.current = undefined;
    pendingMetadata.current = undefined;
    setSymbolLoading(false);
    resources.chart.current?.resetTools('session');
    restoreState.connectedAccount = undefined;
    currentSymbol.current = undefined;
    currentTimeframe.current = undefined;
    dataKeyRef.current = '';
    latestCandleRef.current = undefined;
    setLatestCandle(undefined);
    // A fresh connection makes the bridge request the initial history itself.
    if (nextState === 'connected') {
      beginHistoryWait(historyWaitSetters);
    } else {
      endHistoryWait(historyWaitSetters);
    }
  };

  const onBridgeStatus = (event: PayloadEvent<BridgeStatus>) => {
    if (run.disposed) {
      return;
    }
    const next = event.payload;
    const identity = bridgeIdentityKey(next);
    const sessionReset =
      next.state !== 'connected' ||
      run.bridgeState !== 'connected' ||
      Boolean(bridgeIdentity && identity !== bridgeIdentity);
    if (sessionReset) {
      resetForNewSession(next.state);
    }
    bridgeIdentity = identity;
    run.bridgeState = next.state;
    restoreState.supportedTimeframes = next.supportedTimeframes;
    setStatus(next);
    void restore.restoreOnFirstConnection();
  };

  const onAccountSnapshot = (event: PayloadEvent<AccountSnapshot>) => {
    if (run.disposed) {
      return;
    }
    const nextAccount = normalizeAccount(event.payload);
    accountLoginRef.current = nextAccount.accountLogin;
    brokerServerRef.current = nextAccount.brokerServer;
    setAccount(nextAccount);
    restoreState.connectedAccount = nextAccount;
    void restore.restoreOnFirstConnection();
  };

  const onPortfolioSnapshot = (event: PayloadEvent<PortfolioSnapshot>) => {
    if (!run.disposed && accountLoginRef.current && event.payload.accountLogin === accountLoginRef.current) {
      setPortfolio(normalizePortfolio(event.payload));
    }
  };

  return { rememberBridgeIdentity, onBridgeStatus, onAccountSnapshot, onPortfolioSnapshot };
}
