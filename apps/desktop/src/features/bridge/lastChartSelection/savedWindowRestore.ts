import type { AccountSnapshot } from '../../../shared/bridge/types';
import { initialHistoryBarsFor } from '../../chart/engine/bars/initialHistoryWindow';
import type { BridgeSessionState } from '../useBridgeSession';
import { brokerListsSymbol } from '../market/brokerSymbolList';
import type { BridgeEffectRun, BridgeMarketResources } from '../market/bridgeMarketRuntime';
import { beginHistoryWait } from '../market/historyWait';
import {
  accountIdentityKey,
  isSameChartSelection,
  loadLastChartSelection,
  restorableSelection,
  settleStartRestore,
  type LastChartSelection,
} from './lastChartSelection';

type MarketAdapter = NonNullable<BridgeMarketResources['adapterRef']['current']>;
type AccountIdentity = Pick<AccountSnapshot, 'accountLogin' | 'brokerServer'>;

type SavedWindowSession = Pick<
  BridgeSessionState,
  | 'targetSymbol'
  | 'loadingTimeframeRef'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'setLoadingTimeframe'
  | 'setSymbolLoading'
  | 'setInstrument'
  | 'setQuote'
  | 'historyWaitSetters'
>;

/**
 * What one bootstrap run knows about the connection while it decides whether to
 * reopen the saved window. The start path and the bridge listeners both write it,
 * because the account may arrive before or after the connected status.
 */
export interface SavedWindowRestoreState {
  /** The saved window is applied once per app run, so later reconnects never override the user's own picks. */
  spent: boolean;
  connectedAccount: AccountIdentity | undefined;
  supportedTimeframes: readonly string[] | undefined;
}

export const createSavedWindowRestoreState = (): SavedWindowRestoreState => ({
  spent: false,
  connectedAccount: undefined,
  supportedTimeframes: undefined,
});

/**
 * The chart window saved for this account, when the broker still lists its
 * symbol and serves its timeframe. The window the session already opened needs
 * no check: it is on screen, so there is nothing to reopen.
 */
async function savedSelectionFor(
  account: AccountIdentity | undefined,
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

export function createSavedWindowRestore(
  run: BridgeEffectRun,
  session: SavedWindowSession,
  resources: BridgeMarketResources,
  state: SavedWindowRestoreState,
) {
  const {
    targetSymbol,
    loadingTimeframeRef,
    currentSymbol,
    currentTimeframe,
    historyWaitSetters,
    setLoadingTimeframe,
    setSymbolLoading,
    setInstrument,
    setQuote,
  } = session;

  const requestWindow = (adapter: MarketAdapter, selection: LastChartSelection) => {
    beginHistoryWait(historyWaitSetters);
    void adapter
      .requestHistory(selection.symbol, selection.timeframe, initialHistoryBarsFor(resources.chart.current))
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

  // Applied once per app run: on the first connected session with a known account.
  const restoreOnFirstConnection = async () => {
    const adapter = resources.adapterRef.current;
    const account = state.connectedAccount;
    if (state.spent || run.disposed || run.bridgeState !== 'connected' || !adapter || !account) {
      return;
    }
    if (!accountIdentityKey(account.accountLogin, account.brokerServer)) {
      return;
    }
    state.spent = true;
    const shownWindow =
      currentSymbol.current && currentTimeframe.current
        ? { symbol: currentSymbol.current, timeframe: currentTimeframe.current }
        : undefined;
    const saved = await savedSelectionFor(account, state.supportedTimeframes, shownWindow);
    if (saved && !run.disposed && run.bridgeState === 'connected') {
      openSavedWindow(adapter, saved);
    }
    settleStartRestore();
  };

  // The cached market snapshot has no instrument metadata. The existing
  // history command also requests symbol-info; dispatch once after the bridge
  // listeners are ready so a reopened workspace restores SL/TP amounts.
  const openStartWindow = async (
    adapter: MarketAdapter,
    start: {
      shownWindow: LastChartSelection | undefined;
      account: AccountIdentity | undefined;
      supportedTimeframes: readonly string[] | undefined;
    },
  ) => {
    const { shownWindow } = start;
    const savedSelection =
      run.bridgeState === 'connected'
        ? await savedSelectionFor(start.account, start.supportedTimeframes, shownWindow)
        : undefined;
    if (run.disposed) {
      return;
    }
    if (run.bridgeState === 'connected' && savedSelection) {
      openSavedWindow(adapter, savedSelection);
    } else if (run.bridgeState === 'connected' && shownWindow) {
      requestWindow(adapter, shownWindow);
    }
    if (state.spent) {
      settleStartRestore();
    }
  };

  return { restoreOnFirstConnection, openStartWindow };
}
