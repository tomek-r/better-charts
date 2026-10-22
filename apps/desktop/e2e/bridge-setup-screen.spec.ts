import { expect, test, type Page } from '@playwright/test';
import type { BridgeStatus } from '../src/shared/bridge/types';
import { openSetupGuide } from './helpers/setupGuide';
import { gotoWithStub, pushBridgeStatus } from './helpers/tauriStub';

/** A bridge that has not connected yet and holds no candles, so the setup screen stands in for the chart. */
const WAITING_FOR_BRIDGE = {
  get_bridge_status: { state: 'connecting' },
  get_market_snapshot: { complete: false, candles: [] },
};

/** A bridge still connecting but already holding candles, so the header stays reachable. */
const CONNECTING_WITH_CANDLES = {
  get_bridge_status: { state: 'connecting' },
};

/** The status the stub pushes once the bridge answers, worded like the real one. */
const CONNECTED_STATUS: BridgeStatus = {
  state: 'connected',
  supportedTimeframes: ['M1'],
  message: 'Bridge connected.',
};

const setupScreen = (page: Page) => page.getByRole('region', { name: 'MetaTrader 5 setup' });
const setupGuide = (page: Page) => page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
const setupComplete = (page: Page) => page.getByRole('dialog', { name: 'Setup complete' });

/** Pushes the connected status and checks the guide and App settings give way to the finished screen. */
async function expectSetupCompleteAfterConnect(page: Page): Promise<void> {
  await pushBridgeStatus(page, CONNECTED_STATUS);
  await expect(setupGuide(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
  const complete = setupComplete(page);
  await expect(complete).toBeVisible();
  const happyTrading = complete.getByRole('button', { name: 'Happy trading' });
  await expect(happyTrading).toBeFocused();
  await happyTrading.click();
  await expect(complete).toBeHidden();
}

test('an unconnected bridge covers the workspace and offers the guide alone', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  const screen = setupScreen(page);
  await expect(screen).toBeVisible();
  await expect(screen.locator('.loading-message strong')).toHaveText('Connect MetaTrader 5');
  // No chart is rendered, so the connection dot has nothing to describe.
  await expect(page.locator('.chart-connection-dot')).toBeHidden();

  await screen.getByRole('button', { name: 'Open setup guide' }).click();
  await expect(setupGuide(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
});

test('a connected bridge with candles leaves the workspace uncovered', async ({ page }) => {
  await gotoWithStub(page);
  await expect(setupScreen(page)).toHaveCount(0);
  await expect(page.locator('.chart-connection-dot')).toBeVisible();
});

test('the standalone guide gives way to the setup complete screen once the bridge connects', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await setupScreen(page).getByRole('button', { name: 'Open setup guide' }).click();
  await expect(setupGuide(page)).toBeVisible();

  await expectSetupCompleteAfterConnect(page);
});

test('the settings guide closes App settings onto the setup complete screen once the bridge connects', async ({
  page,
}) => {
  await gotoWithStub(page, { responses: CONNECTING_WITH_CANDLES });
  await openSetupGuide(page);
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeVisible();

  await expectSetupCompleteAfterConnect(page);
});

test('a guide opened on an already connected bridge stays open', async ({ page }) => {
  await gotoWithStub(page);
  await openSetupGuide(page);
  await expect(setupComplete(page)).toHaveCount(0);

  // The same state again is no change, so the guide keeps the window.
  await pushBridgeStatus(page, CONNECTED_STATUS);
  await expect(setupGuide(page)).toBeVisible();
  await expect(setupComplete(page)).toHaveCount(0);
});
