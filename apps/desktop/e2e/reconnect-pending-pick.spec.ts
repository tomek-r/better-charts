import { expect, test } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch } from './helpers/panel';
import { brokerSymbolFixture, gotoWithStub, pushEvent, windowCandles } from './helpers/tauriStub';

// A symbol picked just before the session changed never gets its window. The
// new session opens its own first window, which must not be mistaken for a stale
// answer to the old pick.
test('a symbol pick still loading when the account changes does not block the new session', async ({ page }) => {
  await gotoWithStub(page, { historyDelayMs: 600_000 });
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'NAS100 description')]);
  await chooseSearchResult(dialog, 'NAS100');
  await expect(page.locator('.loading-message')).toContainText('Loading market data');

  // The bridge announces the other account without a separate disconnected status.
  await pushEvent(page, 'bridge-status', {
    state: 'connected',
    supportedTimeframes: ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'MN1'],
    terminal: 'MetaTrader 5 (demo)',
    account: '50999999',
    server: 'Broker-Demo',
    tradingEnabled: true,
  });
  await pushEvent(page, 'market-snapshot', {
    symbol: 'GBPUSD',
    timeframe: 'M1',
    complete: true,
    candles: windowCandles(10),
  });

  await expect(page.locator('.chart-heading h1')).toHaveText('GBPUSD');
  await expect(page.locator('.loading-message')).toHaveCount(0);
});
