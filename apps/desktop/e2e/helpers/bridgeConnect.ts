import type { Page } from '@playwright/test';
import { pushEvent, STUB_NOW, windowCandles } from './tauriStub';

/** An `account-snapshot` payload; the login and server are what the app binds a session to. */
export type AccountSnapshotFixture = Record<string, unknown> & { accountLogin: string; brokerServer: string };

/** The stub's demo account, with `overrides` laid over it. */
export function accountSnapshotFixture(overrides: Record<string, unknown> = {}): AccountSnapshotFixture {
  return {
    accountLogin: '50123456',
    brokerServer: 'Broker-Demo',
    accountTradeMode: 0,
    accountTradeModeName: 'demo',
    currency: 'USD',
    currencyDigits: 2,
    balance: '10000.00',
    equity: '10000.00',
    margin: '0.00',
    freeMargin: '10000.00',
    marginLevel: '0.00',
    leverage: 100,
    marginMode: 2,
    tradeAllowed: true,
    expertAllowed: true,
    ...overrides,
  };
}

/** The `bridge-status` payload of a handshake that bound the session to `account`. */
export function connectedStatus(
  account: AccountSnapshotFixture,
  tradingEnabled = true,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: 'connected',
    protocolVersion: '2.1',
    terminal: 'MetaTrader 5 (demo)',
    account: account.accountLogin,
    server: account.brokerServer,
    tradingEnabled,
    marketSession: { symbol: 'EURUSD', isOpen: true, tradeMode: 4, serverTimeMs: STUB_NOW },
    ...extra,
  };
}

export interface BridgeConnectOptions {
  tradingEnabled?: boolean;
  /** Fields merged over the connected status, e.g. the handshake's `supportedTimeframes`. */
  status?: Record<string, unknown>;
  symbol?: string;
  timeframe?: string;
  candleCount?: number;
}

/**
 * The EA connecting: the handshake status, the session's default window, then the
 * account, in the order the bridge sends them.
 */
export async function connectBridgeSession(
  page: Page,
  account: AccountSnapshotFixture,
  options: BridgeConnectOptions = {},
): Promise<void> {
  const { tradingEnabled = true, status = {}, symbol = 'EURUSD', timeframe = 'M5', candleCount = 10 } = options;
  await pushEvent(page, 'bridge-status', connectedStatus(account, tradingEnabled, status));
  await pushEvent(page, 'market-snapshot', {
    symbol,
    timeframe,
    complete: true,
    candles: windowCandles(candleCount),
  });
  await pushEvent(page, 'account-snapshot', account);
}
