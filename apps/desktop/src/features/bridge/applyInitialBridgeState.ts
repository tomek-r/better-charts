import type { AccountSnapshot } from '../../shared/bridge/types';
import { HistoryViewportMode } from '../chart/engine/bars/historyViewportMode';
import type { Mt5DataAdapter } from '../chart/engine/bars/mt5DataAdapter';
import {
  normalizeAccount,
  normalizePortfolio,
  normalizeQuote,
  normalizeSnapshot,
  validCandlesOf,
} from './bridgePayloadNormalizers';
import type { fetchInitialBridgeState } from './fetchInitialBridgeState';
import { accountIdentityKey, type LastChartSelection } from './lastChartSelection/lastChartSelection';
import type { SavedWindowRestoreState } from './lastChartSelection/savedWindowRestore';
import { applyAcceptedSnapshot } from './market/applyAcceptedSnapshot';
import type { BridgeEffectRun, BridgeMarketResources } from './market/bridgeMarketRuntime';
import type { BridgeSessionState } from './useBridgeSession';

type InitialStateSession = Pick<
  BridgeSessionState,
  | 'setStatus'
  | 'setSnapshot'
  | 'setQuote'
  | 'setAccount'
  | 'setPortfolio'
  | 'setLatestCandle'
  | 'setChartError'
  | 'dataKeyRef'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'latestCandleRef'
>;

type InitialBridgeState = Awaited<ReturnType<typeof fetchInitialBridgeState>>;

interface InitialStateDependencies {
  run: BridgeEffectRun;
  session: InitialStateSession;
  resources: BridgeMarketResources;
  restoreState: SavedWindowRestoreState;
  rememberBridgeIdentity: (status: InitialBridgeState['status']) => void;
}

/**
 * Puts what the bridge already held at startup on screen, in the order the
 * listeners later rely on. Returns the window now shown and the account, which
 * decide whether the saved window is reopened.
 */
export function applyInitialBridgeState(
  { run, session, resources, restoreState, rememberBridgeIdentity }: InitialStateDependencies,
  adapter: Mt5DataAdapter | null,
  initial: InitialBridgeState,
): { shownWindow: LastChartSelection | undefined; account: AccountSnapshot | undefined } {
  const { status: bridge, market, quote: initialQuote, account: initialAccount, portfolio: initialPortfolio } = initial;
  session.setStatus(bridge);
  run.bridgeState = bridge.state;
  rememberBridgeIdentity(bridge);
  if (bridge.state !== 'connected') {
    adapter?.resetRequests();
  }
  const initialMarket = normalizeSnapshot(market);
  const accepted = { ...initialMarket, candles: validCandlesOf(initialMarket.candles) };
  if (run.bridgeState === 'connected' && accepted.symbol && accepted.timeframe) {
    applyAcceptedSnapshot({ chart: resources.chart, adapter, session }, accepted, {
      receivedCandleCount: initialMarket.candles.length,
      viewportMode: HistoryViewportMode.Reset,
    });
  }
  session.setSnapshot(accepted);
  if (initialQuote) {
    const nextQuote = normalizeQuote(initialQuote);
    if (!initialMarket.symbol || nextQuote.symbol === initialMarket.symbol) {
      session.setQuote(nextQuote);
    }
  }
  const account = initialAccount ? normalizeAccount(initialAccount) : undefined;
  if (account) {
    session.setAccount(account);
  }
  restoreState.supportedTimeframes = bridge.supportedTimeframes;
  if (run.bridgeState === 'connected' && account) {
    restoreState.connectedAccount = account;
    // This start path applies the saved window itself, before any listener event.
    restoreState.spent = Boolean(accountIdentityKey(account.accountLogin, account.brokerServer));
  }
  if (initialPortfolio) {
    session.setPortfolio(normalizePortfolio(initialPortfolio));
  }
  const shownWindow =
    accepted.symbol && accepted.timeframe ? { symbol: accepted.symbol, timeframe: accepted.timeframe } : undefined;
  return { shownWindow, account };
}
