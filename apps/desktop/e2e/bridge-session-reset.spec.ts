import { expect, test, type Page } from '@playwright/test';
import { accountSnapshotFixture, connectedStatus } from './helpers/bridgeConnect';
import { gotoWithStub, pushEvent, windowCandles } from './helpers/tauriStub';

// A bridge-status event that keeps the connected session (same terminal,
// account and server) leaves the selection on screen, so a window for another
// symbol is still a stale answer. A disconnect or a different identity starts a
// new session, whose first window is accepted whatever it is.

const heading = (page: Page) => page.locator('.chart-heading h1');

const pushForeignWindow = (page: Page) =>
  pushEvent(page, 'market-snapshot', {
    symbol: 'GBPUSD',
    timeframe: 'M5',
    complete: true,
    candles: windowCandles(10),
  });

test('a status update of the same session keeps the selection and rejects a window for another symbol', async ({
  page,
}) => {
  await gotoWithStub(page);
  await expect(heading(page)).toHaveText('EURUSD');

  await pushEvent(page, 'bridge-status', connectedStatus(accountSnapshotFixture()));
  await pushForeignWindow(page);

  await page.waitForTimeout(300);
  await expect(heading(page)).toHaveText('EURUSD');
});

test('a disconnect followed by the same identity starts a new session that accepts any first window', async ({
  page,
}) => {
  await gotoWithStub(page);
  await expect(heading(page)).toHaveText('EURUSD');

  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'MT5 exited' });
  await pushEvent(page, 'bridge-status', connectedStatus(accountSnapshotFixture()));
  await pushForeignWindow(page);

  await expect(heading(page)).toHaveText('GBPUSD');
});

test('a different account identity starts a new session that accepts any first window', async ({ page }) => {
  await gotoWithStub(page);
  await expect(heading(page)).toHaveText('EURUSD');

  await pushEvent(page, 'bridge-status', connectedStatus(accountSnapshotFixture({ accountLogin: '50999999' })));
  await pushForeignWindow(page);

  await expect(heading(page)).toHaveText('GBPUSD');
});
