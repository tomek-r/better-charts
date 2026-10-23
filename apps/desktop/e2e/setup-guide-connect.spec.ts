import { expect, test, type Locator, type Page } from '@playwright/test';
import { bridgeNotice } from './helpers/bridgeNotice';
import { CONNECTING_BRIDGE, TOKEN_MISMATCH_STATUS } from './helpers/bridgeStates';
import {
  expectGuideOnStep,
  openConnectStep,
  openConnectStepUnderPausedClock,
  setupGuideDialog,
} from './helpers/setupGuide';
import { gotoWithStub, pausePageClockAhead, pushBridgeStatus } from './helpers/tauriStub';

const TOKEN_MISMATCH_MESSAGE = 'MetaTrader 5 uses a different bridge token.';

/** The wait the connect step shows instead of anything about the bridge. */
const CONNECTING_TITLE = 'Waiting for the EA to connect…';

/** How long the connect step is left without an EA before the test looks at it again, a little past 20 s. */
const PATIENCE_MS = 20_100;

/** Asserts the connect step reports nothing itself: no Install again, only its wait. */
async function expectConnectStepSilent(guide: Locator): Promise<void> {
  await expect(guide.getByRole('button', { name: 'Install again' })).toHaveCount(0);
  await expect(guide.locator('.loading-message strong')).toHaveText(CONNECTING_TITLE);
}

/** The notice sits under the dialogs' backdrops, so its fix is reached once they are closed. */
async function closeGuideAndSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(setupGuideDialog(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
}

test('a token mismatch leaves the guide silent and offers Install again in the bottom-right notice', async ({
  page,
}) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  const guide = await openConnectStep(page);

  await pushBridgeStatus(page, TOKEN_MISMATCH_STATUS);

  await expectConnectStepSilent(guide);

  const notice = bridgeNotice(page, TOKEN_MISMATCH_MESSAGE);
  await expect(notice.locator('span')).toHaveText(TOKEN_MISMATCH_MESSAGE);

  await closeGuideAndSettings(page);
  await notice.getByRole('button', { name: 'Install again' }).click();

  const reopenedGuide = setupGuideDialog(page);
  await expectGuideOnStep(reopenedGuide, 'Install', { marksIndicator: true });
});

test('an outdated component keeps its Update in MT5 notice and leaves the guide silent', async ({ page }) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  const guide = await openConnectStep(page);
  const message = 'App requires MT5 bridge version 1.012, but installed bridge version is 1.006.';

  await pushBridgeStatus(page, { state: 'protocol_error', message, componentOutdated: true });

  await expectConnectStepSilent(guide);
  const notice = bridgeNotice(page, message);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Update in MT5' })).toBeVisible();
});

test('the connect step keeps reporting only its wait after 20 s without an EA', async ({ page }) => {
  await pausePageClockAhead(page);
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  await page.clock.runFor(100);
  const guide = await openConnectStepUnderPausedClock(page);

  await expectConnectStepSilent(guide);

  await page.clock.runFor(PATIENCE_MS);

  await expectConnectStepSilent(guide);
});

test('Back leaves the connect step for the install step', async ({ page }) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  const guide = await openConnectStep(page);

  await guide.getByRole('button', { name: 'Back' }).click();

  await expectGuideOnStep(guide, 'Install');
  await expect(guide.getByRole('button', { name: 'Install and restart MT5' })).toBeVisible();
});
