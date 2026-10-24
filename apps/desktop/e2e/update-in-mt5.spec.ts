import { expect, test } from '@playwright/test';
import { expectGuideOnStep, setupGuideDialog } from './helpers/setupGuide';
import { expectNoErrors, gotoWithStub, pushBridgeStatus } from './helpers/tauriStub';

/** The bridge version refusal, worded as the Rust handshake words it. */
const OUTDATED_BRIDGE_MESSAGE =
  'App requires MT5 bridge version 1.012, but installed bridge version is 1.006. Update and reattach BetterChartsBridge in MT5.';

test('a version refusal opens the setup guide at its first step', async ({ page }) => {
  const errors = await gotoWithStub(page);
  await pushBridgeStatus(page, { state: 'protocol_error', message: OUTDATED_BRIDGE_MESSAGE, componentOutdated: true });

  // The actionable notice carries the same text as the plain error toast and replaces it.
  const notice = page.locator('.notification-region [role=alert]');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(OUTDATED_BRIDGE_MESSAGE);
  await expect(notice.getByRole('button', { name: 'Update in MT5' })).toBeVisible();

  await notice.getByRole('button', { name: 'Update in MT5' }).click();

  const guide = setupGuideDialog(page);
  await expect(guide).toBeVisible();
  // The guide stands on its own window: no App settings dialog opens beneath it.
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
  await expectGuideOnStep(guide, 'Find MetaTrader 5', { marksIndicator: true });

  expectNoErrors(errors);
});

test('another refusal keeps the plain error notice without the install action', async ({ page }) => {
  const errors = await gotoWithStub(page);
  await pushBridgeStatus(page, {
    state: 'protocol_error',
    message: 'bridge bind failed: address already in use; retrying in 1s',
  });

  const notice = page.locator('.notification-region [role=alert]');
  await expect(notice).toContainText('Bridge bind failed: address already in use; retrying in 1s');
  await expect(page.getByRole('button', { name: 'Update in MT5' })).toHaveCount(0);
  await expect(setupGuideDialog(page)).toHaveCount(0);
  expectNoErrors(errors);
});
