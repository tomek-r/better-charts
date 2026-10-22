import { expect, test, type Page } from '@playwright/test';
import { openSetupGuide } from './helpers/setupGuide';
import { gotoWithStub, pushEvent } from './helpers/tauriStub';

/** A bridge that has not connected yet and holds no candles, so the setup screen stands in for the chart. */
const WAITING_FOR_BRIDGE = {
  get_bridge_status: { state: 'connecting' },
  get_market_snapshot: { complete: false, candles: [] },
};

/** The status the stub pushes once the bridge answers, worded like the real one. */
const CONNECTED_STATUS = {
  state: 'connected',
  supportedTimeframes: ['M1'],
  message: 'Bridge connected.',
};

const setupScreen = (page: Page) => page.getByRole('region', { name: 'MetaTrader 5 setup' });

test('an unconnected bridge covers the workspace and offers the guide alone', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  const screen = setupScreen(page);
  await expect(screen).toBeVisible();
  await expect(screen.locator('.loading-message strong')).toHaveText('Connect MetaTrader 5');
  // No chart is rendered, so the connection dot has nothing to describe.
  await expect(page.locator('.chart-connection-dot')).toBeHidden();

  await screen.getByRole('button', { name: 'Open setup guide' }).click();
  await expect(page.getByRole('dialog', { name: 'Set up the MT5 bridge' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
});

test('a connected bridge with candles leaves the workspace uncovered', async ({ page }) => {
  await gotoWithStub(page);
  await expect(setupScreen(page)).toHaveCount(0);
  await expect(page.locator('.chart-connection-dot')).toBeVisible();
});

test('the standalone guide offers Happy trading once the bridge connects', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await setupScreen(page).getByRole('button', { name: 'Open setup guide' }).click();
  const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
  await expect(guide).toBeVisible();

  await pushEvent(page, 'bridge-status', CONNECTED_STATUS);
  await expect(guide.getByText('MetaTrader 5 is connected.')).toBeVisible();
  await guide.getByRole('button', { name: 'Happy trading' }).click();
  await expect(guide).toBeHidden();
});

test('Happy trading from the settings guide closes both dialogs', async ({ page }) => {
  await gotoWithStub(page);
  const guide = await openSetupGuide(page);
  const settings = page.getByRole('dialog', { name: 'App settings' });
  await expect(settings).toBeVisible();

  await guide.getByRole('button', { name: 'Happy trading' }).click();
  await expect(guide).toBeHidden();
  await expect(settings).toBeHidden();
});
