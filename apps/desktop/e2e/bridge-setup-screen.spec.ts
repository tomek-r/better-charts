import { expect, test, type Locator, type Page } from '@playwright/test';
import type { BridgeStatus } from '../src/shared/bridge/types';
import {
  SETUP_COMPLETED_KEY,
  cleanInstallReport,
  currentGuideStep,
  markSetupCompleted,
  openConnectStepUnderPausedClock,
  openSetupGuide,
  revealLazyGuide,
} from './helpers/setupGuide';
import { gotoWithStub, pausePageClockAhead, pushBridgeStatus } from './helpers/tauriStub';

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

/** The bridge version refusal, worded as the Rust handshake words it. */
const OUTDATED_MESSAGE = 'App requires MT5 bridge version 1.012, but installed bridge version is 1.006.';

/** How long the header waits before it offers the guide back, a little past its 3 s delay. */
const HEADER_STATUS_REVEAL_MS = 3_100;

/** Statuses the header names, and the guide step each one opens. */
const HEADER_STATUSES: { label: string; step: string; status: BridgeStatus }[] = [
  {
    label: 'Token mismatch',
    step: 'Install',
    status: { state: 'protocol_error', message: 'authentication failed', tokenMismatch: true },
  },
  {
    label: 'EA outdated',
    step: 'Install',
    status: { state: 'protocol_error', message: OUTDATED_MESSAGE, componentOutdated: true },
  },
  { label: 'MT5 error', step: 'Connect', status: { state: 'protocol_error', message: 'bridge bind failed' } },
];

const setupScreen = (page: Page) => page.getByRole('region', { name: 'MetaTrader 5 setup' });
const setupGuide = (page: Page) => page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
const setupComplete = (page: Page) => page.getByRole('dialog', { name: 'Setup complete' });
const headerStatus = (page: Page, label: string) =>
  page.getByRole('button', { name: `MetaTrader 5 connection: ${label}` });

/** Loads the app as a completed setup and runs the header's delay, returning the status it now shows. */
async function revealHeaderStatus(
  page: Page,
  label: string,
  responses: Record<string, unknown> = WAITING_FOR_BRIDGE,
): Promise<Locator> {
  await pausePageClockAhead(page);
  await markSetupCompleted(page);
  await gotoWithStub(page, { responses });

  await expect(setupScreen(page)).toHaveCount(0);
  const status = headerStatus(page, label);
  await expect(status).toHaveCount(0);
  await page.clock.runFor(HEADER_STATUS_REVEAL_MS);
  await expect(status).toHaveText(label);
  return status;
}

/** How the finished screen enters: over the setup screen's blur, or fading in over the chart. */
type SetupCompleteEntrance = 'over-setup-screen' | 'fade-in';

/** The entrance animation each kind of finished screen plays. */
const ENTRANCE_ANIMATION: Record<SetupCompleteEntrance, string> = {
  'over-setup-screen': 'none',
  'fade-in': 'settings-fade-in',
};

/** Pushes the connected status and checks the guide and App settings give way to the finished screen. */
async function expectSetupCompleteAfterConnect(page: Page, entrance: SetupCompleteEntrance): Promise<void> {
  await pushBridgeStatus(page, CONNECTED_STATUS);
  // The guide does not vanish: it fades out first, so its backdrop wears `is-finishing` on the way.
  await expect(page.locator('.setup-guide-backdrop.is-finishing')).toHaveCount(1);
  if (entrance === 'over-setup-screen') {
    // The blur stays beneath the fading guide instead of lifting and settling back in.
    await expect(setupScreen(page)).toHaveCount(1);
  }
  await expect(setupGuide(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
  const complete = setupComplete(page);
  await expect(complete).toBeVisible();
  await expect(setupScreen(page)).toHaveCount(0);
  await expect(complete).toHaveCSS('animation-name', ENTRANCE_ANIMATION[entrance]);
  await expect(complete.locator('.setup-complete-icon')).toHaveCSS('animation-name', 'setup-complete-icon-in');
  const happyTrading = complete.getByRole('button', { name: 'Happy trading' });
  await expect(happyTrading).toBeFocused();
  await happyTrading.click();
  // "Happy trading" fades the screen out before it leaves the workspace.
  await expect(complete).toHaveClass(/is-leaving/);
  await expect(complete).toHaveCSS('animation-name', 'settings-fade-out');
  // The exit mirrors the entrance: the button and the mark leave before the blur.
  await expect(happyTrading).toHaveCSS('animation-name', 'setup-complete-button-out');
  await expect(complete.locator('.setup-complete-icon')).toHaveCSS('animation-name', 'setup-complete-icon-out');
  await expect(complete).toBeHidden();
}

/** Loads a waiting bridge, opens the guide from the setup screen and lets the bridge connect; returns the finished screen. */
async function connectThroughStandaloneGuide(page: Page): Promise<Locator> {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await setupScreen(page).getByRole('button', { name: 'Open setup guide' }).click();
  await expect(setupGuide(page)).toBeVisible();

  await pushBridgeStatus(page, CONNECTED_STATUS);
  const complete = setupComplete(page);
  await expect(complete).toBeVisible();
  return complete;
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
  await expect(setupGuide(page).getByRole('heading', { name: 'Find MetaTrader 5' })).toBeVisible();
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

  await expectSetupCompleteAfterConnect(page, 'over-setup-screen');
});

test('the settings guide closes App settings onto the setup complete screen once the bridge connects', async ({
  page,
}) => {
  await gotoWithStub(page, { responses: CONNECTING_WITH_CANDLES });
  await openSetupGuide(page);
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeVisible();

  await expectSetupCompleteAfterConnect(page, 'fade-in');
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

test('reduced motion shows the finished screen without its entrance animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const complete = await connectThroughStandaloneGuide(page);
  await expect(complete.locator('.setup-complete-icon')).toHaveCSS('animation-name', 'none');
  await expect(complete.getByRole('button', { name: 'Happy trading' })).toHaveCSS('animation-name', 'none');
});

test('the finished screen holds its entrance until the window is in front, then a moment longer', async ({ page }) => {
  // The user is still in MT5 when the bridge answers, so the window has not come to the front yet.
  await page.addInitScript(() => {
    Document.prototype.hasFocus = () => false;
  });
  const complete = await connectThroughStandaloneGuide(page);
  const mark = complete.locator('.setup-complete-icon');
  await expect(complete).toHaveClass(/is-awaiting-front/);
  await expect(mark).toHaveCSS('animation-play-state', 'paused');

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  // The class changes at once; CSS then adds the settle time to the entrance delays itself.
  await expect(complete).not.toHaveClass(/is-awaiting-front/);
  await expect(complete).toHaveClass(/is-returning-to-front/);
  await expect(mark).toHaveCSS('animation-delay', '0.5s');
  await expect(complete.getByRole('button', { name: 'Happy trading' })).toHaveCSS('animation-delay', '1.4s');
  await expect(mark).toHaveCSS('animation-play-state', 'running');
});

test('a token mismatch explains itself on the setup screen without an error toast', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await pushBridgeStatus(page, {
    state: 'protocol_error',
    message: 'authentication failed',
    tokenMismatch: true,
  });
  const screen = setupScreen(page);
  await expect(screen.locator('.loading-message strong')).toHaveText('Bridge token does not match');
  await expect(
    screen.getByText(
      'MetaTrader 5 uses a different bridge token. Open the setup guide and choose Install and restart MT5.',
    ),
  ).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Open setup guide' })).toBeVisible();
  await expect(page.getByText('authentication failed')).toHaveCount(0);
});

test('Happy trading remembers the setup on the device, so a reload keeps the setup screen away', async ({ page }) => {
  await pausePageClockAhead(page);
  await gotoWithStub(page, {
    responses: { ...CONNECTING_WITH_CANDLES, install_to_mt5: cleanInstallReport('updated') },
  });
  await openConnectStepUnderPausedClock(page);

  await pushBridgeStatus(page, CONNECTED_STATUS);
  const complete = setupComplete(page);
  await expect(complete).toBeVisible();
  await complete.getByRole('button', { name: 'Happy trading' }).click();
  await expect(complete).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), SETUP_COMPLETED_KEY)).toBe('true');

  await page.reload();
  // Wait for the reloaded window to stand before judging what is missing from it.
  await expect(page.locator('main.dashboard')).toBeVisible();
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(setupScreen(page)).toHaveCount(0);
  // The header waits out the start before it offers the guide back.
  const status = headerStatus(page, 'MT5 not connected');
  await page.clock.runFor(HEADER_STATUS_REVEAL_MS);
  await expect(status).toBeVisible();

  await status.click();
  await revealLazyGuide(page);
  await expect(setupGuide(page).getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
});

test('a completed setup shows the header status instead of the setup screen', async ({ page }) => {
  const status = await revealHeaderStatus(page, 'MT5 not connected');

  await status.click();
  await revealLazyGuide(page);

  const guide = setupGuide(page);
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
  await expect(currentGuideStep(guide)).toHaveText('Connect');
});

for (const { label, step, status: bridgeStatus } of HEADER_STATUSES) {
  test(`the header status names ${label} and opens the guide on ${step}`, async ({ page }) => {
    const status = await revealHeaderStatus(page, label, {
      get_bridge_status: bridgeStatus,
      get_market_snapshot: { complete: false, candles: [] },
    });

    await status.click();
    await revealLazyGuide(page);

    await expect(setupGuide(page).getByRole('heading', { name: step, exact: true })).toBeVisible();
  });
}
