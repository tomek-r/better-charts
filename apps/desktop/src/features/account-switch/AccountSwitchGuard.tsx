import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventCallback } from '../../shared/hooks/useEventCallback';
import { useBridgeAccount } from '../bridge/BridgeSessionProvider';
import { useResetOrderTicket } from '../order-ticket/state/useResetOrderTicket';
import { AccountSwitchDialog } from './AccountSwitchDialog';
import { accountSwitchMessage, isAccountSwitch, type AccountIdentity } from './accountSwitch';
import { useTradingEnabled } from './useTradingEnabled';

/**
 * Detects an MT5 login/server change and drops everything bound to the old
 * account: staged and draft orders, sizing previews, OrderCheck/review state
 * and pending modifications. Chart symbol, timeframe, layout and drawing tools
 * stay. The previous identity is remembered across disconnects (the account
 * store clears on disconnect), so a reconnect to the same account is silent.
 */
export function AccountSwitchGuard() {
  const account = useBridgeAccount();
  const tradingEnabled = useTradingEnabled();
  const resetTradingTicket = useResetOrderTicket();
  const lastIdentity = useRef<AccountIdentity | undefined>(undefined);
  const [notice, setNotice] = useState<string>();
  const dismiss = useCallback(() => setNotice(undefined), []);

  const announceSwitch = useEventCallback(() => {
    if (!account) {
      return;
    }
    resetTradingTicket();
    setNotice(accountSwitchMessage(account));
  });

  const login = account?.accountLogin;
  const server = account?.brokerServer;
  useEffect(() => {
    if (!login || !server) {
      return;
    }
    const next = { accountLogin: login, brokerServer: server };
    const switched = isAccountSwitch(lastIdentity.current, next);
    lastIdentity.current = next;
    if (switched) {
      announceSwitch();
    }
  }, [login, server, announceSwitch]);

  return notice ? (
    <AccountSwitchDialog message={notice} account={account} tradingEnabled={tradingEnabled} onDismiss={dismiss} />
  ) : null;
}
