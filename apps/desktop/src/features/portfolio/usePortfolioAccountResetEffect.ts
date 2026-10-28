import { useEffect } from 'react';
import type { BridgeSessionState } from '../bridge/useBridgeSession';

/**
 * Portfolio guard: drops the portfolio as soon as the account identity changes,
 * so positions from the previous account can never render against the new one.
 *
 * Registered at its fixed slot inside `WorkspaceLifecycle` (between the
 * timeframe reset and the ticket entry seed), which is why this stays a single
 * effect with a frozen dependency list.
 */
export function usePortfolioAccountResetEffect(session: Pick<BridgeSessionState, 'account' | 'setPortfolio'>): void {
  const { account, setPortfolio } = session;
  useEffect(() => {
    setPortfolio((previous) =>
      previous && account?.accountLogin && previous.accountLogin === account.accountLogin ? previous : undefined,
    );
  }, [account?.accountLogin, account?.currency, setPortfolio]);
}
