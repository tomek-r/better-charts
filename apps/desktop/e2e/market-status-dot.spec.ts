import { expect, test } from '@playwright/test';
import type { BridgeStatus } from '../src/shared/bridge/types';
import { expectNoErrors, gotoWithStub, pushBridgeStatus, STUB_NOW } from './helpers/tauriStub';

/**
 * The dot beside the OHLC legend reports the market of the symbol on screen: green while it is
 * open, red while it is closed, grey while that is unknown.
 */

/** A connected bridge heartbeat for `symbol`, with the account identity the stub's own status carries. */
function connectedStatus(symbol: string, isOpen: boolean): BridgeStatus {
  return {
    state: 'connected',
    supportedTimeframes: ['M1'],
    terminal: 'MetaTrader 5 (demo)',
    account: '50123456',
    server: 'Broker-Demo',
    lastHeartbeat: STUB_NOW,
    message: 'Bridge connected — market data is flowing.',
    marketSession: { symbol, isOpen, tradeMode: 4, serverTimeMs: STUB_NOW },
  };
}

test('the default stub session is open, so the dot is green and reads Market open', async ({ page }) => {
  const errors = await gotoWithStub(page);

  const dot = page.locator('.chart-legend .chart-market-dot');
  await expect(dot).toHaveCount(1);
  await expect(dot).toBeVisible();
  await expect(dot).toHaveClass(/chart-market-open/);
  await expect(dot).toHaveAttribute('aria-label', 'Market open');
  await expect(dot).toHaveAttribute('title', 'Market open');
  expectNoErrors(errors);
});

test('a closed session for the shown symbol turns the dot red', async ({ page }) => {
  const errors = await gotoWithStub(page);
  const dot = page.locator('.chart-market-dot');
  await expect(dot).toHaveClass(/chart-market-open/);

  await pushBridgeStatus(page, connectedStatus('EURUSD', false));

  await expect(dot).toHaveClass(/chart-market-closed/);
  await expect(dot).toHaveAttribute('aria-label', 'Market closed');
  await expect(dot).toHaveAttribute('title', 'Market closed');
  expectNoErrors(errors);
});

test('a session reported for another symbol leaves the dot unknown', async ({ page }) => {
  const errors = await gotoWithStub(page);
  const dot = page.locator('.chart-market-dot');
  await expect(dot).toHaveClass(/chart-market-open/);

  await pushBridgeStatus(page, connectedStatus('GBPUSD', true));

  await expect(dot).toHaveClass(/chart-market-unknown/);
  await expect(dot).toHaveAttribute('aria-label', 'Market status unknown');
  expectNoErrors(errors);
});

test('a disconnected bridge leaves the dot unknown and names the disconnect', async ({ page }) => {
  const errors = await gotoWithStub(page);
  const dot = page.locator('.chart-market-dot');
  await expect(dot).toHaveClass(/chart-market-open/);

  await pushBridgeStatus(page, { state: 'disconnected' });

  await expect(dot).toHaveClass(/chart-market-unknown/);
  await expect(dot).toHaveAttribute('aria-label', 'Market status unknown: MT5 disconnected');
  await expect(dot).toHaveAttribute('title', 'Market status unknown: MT5 disconnected');
  expectNoErrors(errors);
});
