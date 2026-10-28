import { invoke } from '@tauri-apps/api/core';
import type {
  AccountSnapshot,
  BridgeStatus,
  MarketSnapshot,
  PortfolioSnapshot,
  QuoteSnapshot,
} from '../../shared/bridge/types';

/** What the bridge already holds when the app starts, as the backend sent it; callers normalize. */
export async function fetchInitialBridgeState() {
  const [status, market, quote, account, portfolio] = await Promise.all([
    invoke<BridgeStatus>('get_bridge_status'),
    invoke<MarketSnapshot>('get_market_snapshot'),
    invoke<QuoteSnapshot | null>('get_quote_snapshot'),
    invoke<AccountSnapshot | null>('get_account_snapshot'),
    invoke<PortfolioSnapshot | null>('get_portfolio_snapshot'),
  ]);
  return { status, market, quote, account, portfolio };
}
