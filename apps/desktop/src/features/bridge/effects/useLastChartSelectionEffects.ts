import { useEffect } from 'react';
import type { AccountSnapshot, BridgeStatus } from '../../../shared/bridge/types';
import { accountIdentityKey, isStartRestoreSettled, saveLastChartSelection } from '../lastChartSelection';

/** The chart window on screen. */
export interface ChartSelectionWindow {
  symbol?: string | undefined;
  timeframe?: string | undefined;
}

/**
 * Keeps the connected account's saved chart selection current, so the next
 * start can reopen it. Only the window itself is stored; the account identity
 * lives in the storage key.
 */
export function useLastChartSelectionEffects(
  shown: ChartSelectionWindow,
  status: BridgeStatus,
  account: Pick<AccountSnapshot, 'accountLogin' | 'brokerServer'> | undefined,
): void {
  const { symbol, timeframe } = shown;
  const { state } = status;
  const login = account?.accountLogin;
  const server = account?.brokerServer;
  useEffect(() => {
    if (state !== 'connected' || !isStartRestoreSettled()) {
      return;
    }
    const accountKey = accountIdentityKey(login, server);
    if (!accountKey || !symbol || !timeframe) {
      return;
    }
    saveLastChartSelection(accountKey, { symbol, timeframe });
  }, [login, server, state, symbol, timeframe]);
}
