import { expect, test, type Page } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch } from './helpers/panel';
import { brokerSymbolFixture, gotoWithStub, pushEvent, stubInvocations, windowCandles } from './helpers/tauriStub';

// On a reconnect the Rust bridge opens the first window itself: the selection
// the user was viewing when the account is unchanged, the EA's chart symbol
// otherwise. These specs play that bridge and check what the chart does with it.

const heading = (page: Page) => page.locator('.chart-heading h1');
const timeframeButton = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button', { name: label, exact: true });

async function viewNas100OnM15(page: Page): Promise<void> {
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'NAS100 description')]);
  await chooseSearchResult(dialog, 'NAS100');
  await expect(heading(page)).toHaveText('NAS100');
  await timeframeButton(page, '15m').click();
  await expect(timeframeButton(page, '15m')).toHaveAttribute('aria-pressed', 'true');
}

/** The same terminal and account coming back, as the bridge announces it. */
async function reconnect(page: Page): Promise<void> {
  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'MT5 exited' });
  await pushEvent(page, 'bridge-status', {
    state: 'connected',
    supportedTimeframes: ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'MN1'],
    terminal: 'MetaTrader 5 (demo)',
    account: '50123456',
    server: 'Broker-Demo',
    tradingEnabled: true,
  });
}

const historyRequests = async (page: Page) =>
  (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history');

test('a reconnect leaves the symbol and timeframe the user was viewing on the chart', async ({ page }) => {
  await gotoWithStub(page);
  await viewNas100OnM15(page);
  const requestsBefore = (await historyRequests(page)).length;

  await reconnect(page);
  await pushEvent(page, 'market-snapshot', {
    symbol: 'NAS100',
    timeframe: 'M15',
    complete: true,
    candles: windowCandles(10),
  });

  await expect(heading(page)).toHaveText('NAS100');
  await expect(timeframeButton(page, '15m')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length)).toBe(10);
  // The bridge chose the window; the page does not ask for another one.
  expect((await historyRequests(page)).length).toBe(requestsBefore);
});

test('a selection the bridge could not reopen is replaced by the chart symbol with a notice', async ({ page }) => {
  await gotoWithStub(page);
  await viewNas100OnM15(page);

  await reconnect(page);
  await pushEvent(page, 'selection-fallback', { symbol: 'NAS100', timeframe: 'M15', shownSymbol: 'EURUSD' });
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M1',
    complete: true,
    candles: windowCandles(10),
  });

  await expect(page.getByText('NAS100 is not available on this account — showing EURUSD')).toBeVisible();
  await expect(heading(page)).toHaveText('EURUSD');
  await expect(timeframeButton(page, '1m')).toHaveAttribute('aria-pressed', 'true');
});
