import { expect, test } from '@playwright/test';
import { currentGuideStep, openConnectStep } from './helpers/setupGuide';
import { gotoWithStub, pausePageClockAhead, pushBridgeStatus } from './helpers/tauriStub';

/** A bridge that keeps waiting for its first EA for the whole test. */
const CONNECTING_BRIDGE = { get_bridge_status: { state: 'connecting' } };

const NO_CONNECTION_HINT = 'No EA has connected yet. Attach BetterChartsBridge to a chart and turn on Algo Trading.';

test('a token mismatch names the reason and sends Install again to the install step', async ({ page }) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  const guide = await openConnectStep(page);

  await pushBridgeStatus(page, { state: 'protocol_error', message: 'authentication failed', tokenMismatch: true });

  await expect(guide.getByText('MetaTrader 5 uses a different bridge token.')).toBeVisible();
  await guide.getByRole('button', { name: 'Install again' }).click();
  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  await expect(currentGuideStep(guide)).toHaveText('Install');
});

test('an outdated component shows the bridge message and Install again', async ({ page }) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  const guide = await openConnectStep(page);
  const message = 'App requires MT5 bridge version 1.012, but installed bridge version is 1.006.';

  await pushBridgeStatus(page, { state: 'protocol_error', message, componentOutdated: true });

  await expect(guide.getByText(message)).toBeVisible();
  await guide.getByRole('button', { name: 'Install again' }).click();
  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
});

test('the connect step names what to do after 20 s without an EA', async ({ page }) => {
  await pausePageClockAhead(page);
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  await page.clock.runFor(100);
  const guide = await openConnectStep(page);
  const hint = guide.getByText(NO_CONNECTION_HINT);

  await expect(hint).toHaveCount(0);

  await page.clock.runFor(20_100);
  await expect(hint).toBeVisible();
});

test('Back leaves the connect step for the install step', async ({ page }) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  const guide = await openConnectStep(page);

  await guide.getByRole('button', { name: 'Back' }).click();

  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Install and restart MT5' })).toBeVisible();
});
