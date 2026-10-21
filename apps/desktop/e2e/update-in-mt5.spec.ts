import { expect, test, type Page } from '@playwright/test';
import type { BridgeStatus } from '../src/shared/bridge/types';
import { expectNoErrors, gotoWithStub, pushEvent } from './helpers/tauriStub';

/** The bridge version refusal, worded as the Rust handshake words it. */
const OUTDATED_BRIDGE_MESSAGE =
  'App requires MT5 bridge version 1.012, but installed bridge version is 1.006. Update and reattach BetterChartsBridge in MT5.';

/** Pushes one connection state through the same `bridge-status` listener the real bridge emits into. */
async function pushBridgeStatus(page: Page, status: BridgeStatus): Promise<void> {
  await pushEvent(page, 'bridge-status', status);
}

test.describe('outdated MT5 bridge components', () => {
  test('a version refusal offers the automatic install from the setup guide', async ({ page }) => {
    const errors = await gotoWithStub(page);
    await pushBridgeStatus(page, {
      state: 'protocol_error',
      message: OUTDATED_BRIDGE_MESSAGE,
      componentOutdated: true,
    });

    // The actionable notice carries the same text as the plain error toast and replaces it.
    const notice = page.locator('.notification-region [role=alert]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText(OUTDATED_BRIDGE_MESSAGE);
    await expect(notice.getByRole('button', { name: 'Update in MT5' })).toBeVisible();

    await notice.getByRole('button', { name: 'Update in MT5' }).click();

    const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
    await expect(guide).toBeVisible();
    await expect(guide.getByRole('heading', { name: 'Install automatically' })).toBeVisible();
    await expect(guide.getByRole('button', { name: 'Install to MT5' })).toBeVisible();
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
    await expect(page.getByRole('dialog', { name: 'Set up the MT5 bridge' })).toHaveCount(0);
    expectNoErrors(errors);
  });
});
