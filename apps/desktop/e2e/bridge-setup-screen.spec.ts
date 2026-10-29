import { expect, test, type Locator, type Page } from '@playwright/test';
import type { BridgeStatus, Mt5BackendStatus, TerminalProcess } from '../src/shared/bridge/types';
import { bridgeNotice } from './helpers/bridgeNotice';
import { CONNECTED_STATUS, CONNECTING_BRIDGE, TOKEN_MISMATCH_STATUS, WAITING_FOR_BRIDGE } from './helpers/bridgeStates';
import {
  SETUP_COMPLETED_KEY,
  cleanInstallReport,
  expectGuideOnStep,
  markSetupCompleted,
  openConnectStepUnderPausedClock,
  openSetupGuide,
  revealLazyGuide,
  setupCompleteDialog,
  setupGuideDialog,
  setupScreen,
  waitingScreen,
} from './helpers/setupGuide';
import {
  gotoWithStub,
  pausePageClockAhead,
  pushBridgeStatus,
  setStubResponse,
  wasInvoked,
  type TauriStubOptions,
} from './helpers/tauriStub';

/** The heading of the guide's first step, which every entry point opens. */
const SETUP_GUIDE_FIRST_STEP = 'Find MetaTrader 5';

/** A protocol error the EA words itself, the one refusal no other notice explains. */
const OTHER_REFUSAL_MESSAGE = 'Bridge bind failed';

/** How long a drawn chart waits for its bridge before the not-connected notice shows, a little past its 12 s delay. */
const NOT_CONNECTED_NOTICE_REVEAL_MS = 12_100;

/** A blip just under the 3 s the reconnect loader waits before it shows. */
const BLIP_BEFORE_RECONNECT_LOADER_MS = 2_900;

/** How long a drawn chart waits for its bridge before the reconnect loader shows, a little past its 3 s delay. */
const RECONNECT_LOADER_REVEAL_MS = 3_100;

/** What is left of the notice delay once the loader has shown, so the clock lands on the notice's reveal. */
const LOADER_TO_NOTICE_MS = NOT_CONNECTED_NOTICE_REVEAL_MS - RECONNECT_LOADER_REVEAL_MS;

/** The EA's longest gap between connection attempts (10 s) plus a second of slack for the handshake. */
const EA_LONGEST_RETRY_GAP_WITH_SLACK_MS = 11_000;

/** How long a completed setup waits behind the blurred screen, a little past its 15 s limit. */
const WAITING_SCREEN_LIMIT_MS = 15_100;

/** The notice wording per terminal check; the stub answers `running` unless a test says otherwise. */
const TERMINAL_NOT_RUNNING_MESSAGE = 'MetaTrader 5 is not running.';
const EA_NOT_CONNECTED_MESSAGE = 'MetaTrader 5 is running, but the EA is not connected.';
const UNKNOWN_TERMINAL_MESSAGE = 'MetaTrader 5 is not connected.';

/** The backend status the stub answers when the terminal check finds `terminalProcess`. */
function backendStatusWith(terminalProcess: TerminalProcess): Mt5BackendStatus {
  return { running: terminalProcess === 'running', terminalProcess, configured: true, autoStartEnabled: false };
}

/** How often the shown notice asks again whether MetaTrader 5 runs. */
const TERMINAL_RECHECK_MS = 5_000;

/** One problem of a completed setup: the notice it shows and the fix button it offers. */
interface BridgeProblemNotice {
  message: string;
  action: string;
  status: BridgeStatus;
}

/** Every problem a completed setup reports bottom right, with the fix its notice offers. */
const BRIDGE_PROBLEM_NOTICES: BridgeProblemNotice[] = [
  {
    // The default stub reports a running terminal, so the connecting bridge is the EA's absence.
    message: EA_NOT_CONNECTED_MESSAGE,
    action: 'Open setup guide',
    status: { state: 'connecting' },
  },
  {
    message: 'MetaTrader 5 uses a different bridge token.',
    action: 'Install again',
    status: TOKEN_MISMATCH_STATUS,
  },
  {
    message: OTHER_REFUSAL_MESSAGE,
    action: 'Install again',
    status: { state: 'protocol_error', message: OTHER_REFUSAL_MESSAGE },
  },
];

/** Loads a completed setup whose chart is drawn, with no blurred screen and no top bar status over it. */
async function openCompletedSetupWithCandles(page: Page, stubOptions: TauriStubOptions = {}): Promise<void> {
  await pausePageClockAhead(page);
  await markSetupCompleted(page);
  await gotoWithStub(page, { ...stubOptions, responses: { ...CONNECTING_BRIDGE, ...stubOptions.responses } });

  await expect(setupScreen(page)).toHaveCount(0);
  await expect(waitingScreen(page)).toHaveCount(0);
  // Bridge problems are notices at the bottom right, so the top bar carries no status button.
  await expect(page.locator('.bridge-header-status')).toHaveCount(0);
  // The chart is drawn, so the bridge's silence only becomes a notice once its delay has passed.
  await expect(page.getByRole('alert')).toHaveCount(0);
}

/** The loader that covers a drawn chart while its bridge reconnects. */
function reconnectLoader(page: Page): Locator {
  return page.locator('.loading-message strong', { hasText: 'Reconnecting to MetaTrader 5…' });
}

/** The notice reporting `message`, once the clock passed the delay it holds its problem for. */
async function expectBridgeNotice(page: Page, message: string): Promise<Locator> {
  await page.clock.runFor(NOT_CONNECTED_NOTICE_REVEAL_MS);
  const notice = bridgeNotice(page, message);
  await expect(notice).toBeVisible();
  await expect(notice.locator('span')).toHaveText(message);
  return notice;
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
  await expect(setupGuideDialog(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
  const complete = setupCompleteDialog(page);
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
  await expect(setupGuideDialog(page)).toBeVisible();

  await pushBridgeStatus(page, CONNECTED_STATUS);
  const complete = setupCompleteDialog(page);
  await expect(complete).toBeVisible();
  return complete;
}

/**
 * Opens the awaiting screen of a completed setup, ends the wait with `endingStatus`, and returns the
 * screen while its fade-out is still playing.
 */
async function endAwaitingScreen(page: Page, endingStatus: BridgeStatus): Promise<Locator> {
  await markSetupCompleted(page);
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  const screen = waitingScreen(page);
  await expect(screen).toBeVisible();

  await pushBridgeStatus(page, endingStatus);
  // The screen does not vanish: it fades out, so it is still there wearing `is-leaving`.
  await expect(screen).toHaveClass(/is-leaving/);
  return screen;
}

test('an unconnected bridge covers the workspace and offers the guide alone', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  const screen = setupScreen(page);
  await expect(screen).toBeVisible();
  await expect(screen.locator('.loading-message strong')).toHaveText('Connect MetaTrader 5');
  // No chart is rendered, so the connection dot has nothing to describe.
  await expect(page.locator('.chart-connection-dot')).toBeHidden();

  await screen.getByRole('button', { name: 'Open setup guide' }).click();
  await expect(setupGuideDialog(page)).toBeVisible();
  await expect(setupGuideDialog(page).getByRole('heading', { name: SETUP_GUIDE_FIRST_STEP })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
});

test('a connected bridge with candles leaves the workspace uncovered', async ({ page }) => {
  await gotoWithStub(page);
  await expect(setupScreen(page)).toHaveCount(0);
  await expect(page.locator('.chart-connection-dot')).toBeVisible();
});

test('a completed setup waits for MetaTrader 5 behind the blurred screen', async ({ page }) => {
  await markSetupCompleted(page);
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });

  const screen = waitingScreen(page);
  await expect(screen).toBeVisible();
  await expect(screen.locator('.loading-message strong')).toHaveText('Waiting for MetaTrader 5');
  // Without the blur the empty workspace would show through the wait.
  await expect(screen).toHaveCSS('backdrop-filter', /blur/);
  // The launch shows it at once, so it has no fade-in to sit through.
  await expect(screen).toHaveCSS('animation-name', 'none');
  // The setup is done, so the guide is no longer the way on: the notices below the chart are.
  await expect(screen.getByRole('button', { name: 'Open setup guide' })).toHaveCount(0);
});

test('the awaiting screen fades out when the data arrives', async ({ page }) => {
  const screen = await endAwaitingScreen(page, CONNECTED_STATUS);

  await expect(screen).toHaveCSS('animation-name', 'settings-fade-out');
  await expect(screen).toHaveCount(0);
});

test('a completed setup that waits too long hands over to a notice that opens the guide at its first step', async ({
  page,
}) => {
  await pausePageClockAhead(page);
  await markSetupCompleted(page);
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await expect(waitingScreen(page)).toBeVisible();

  await page.clock.runFor(WAITING_SCREEN_LIMIT_MS);
  await expect(waitingScreen(page)).toHaveCount(0);
  const notice = bridgeNotice(page, 'MetaTrader 5 is not sending data');
  await expect(notice).toBeVisible();

  await notice.getByRole('button', { name: 'Open setup guide' }).click();
  await revealLazyGuide(page);
  await expectGuideOnStep(setupGuideDialog(page), SETUP_GUIDE_FIRST_STEP);

  // The data arriving answers the problem, so the notice retires itself.
  await pushBridgeStatus(page, CONNECTED_STATUS);
  await expect(notice).toHaveCount(0);
});

test('a completed setup with a token mismatch offers the install notice instead of the screen', async ({ page }) => {
  const screen = await endAwaitingScreen(page, TOKEN_MISMATCH_STATUS);

  await expect(screen).toHaveCount(0);
  const notice = bridgeNotice(page, 'MetaTrader 5 uses a different bridge token');
  await expect(notice.locator('span')).toHaveText('MetaTrader 5 uses a different bridge token.');

  // Installing again is what hands the EA the token the app knows.
  await notice.getByRole('button', { name: 'Install again' }).click();
  await expectGuideOnStep(setupGuideDialog(page), SETUP_GUIDE_FIRST_STEP);
});

test('the standalone guide gives way to the setup complete screen once the bridge connects', async ({ page }) => {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await setupScreen(page).getByRole('button', { name: 'Open setup guide' }).click();
  await expect(setupGuideDialog(page)).toBeVisible();

  await expectSetupCompleteAfterConnect(page, 'over-setup-screen');
});

test('the settings guide closes App settings onto the setup complete screen once the bridge connects', async ({
  page,
}) => {
  await gotoWithStub(page, { responses: CONNECTING_BRIDGE });
  await openSetupGuide(page);
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeVisible();

  await expectSetupCompleteAfterConnect(page, 'fade-in');
});

test('a guide opened on an already connected bridge stays open', async ({ page }) => {
  await gotoWithStub(page);
  await openSetupGuide(page);
  await expect(setupCompleteDialog(page)).toHaveCount(0);

  // The same state again is no change, so the guide keeps the window.
  await pushBridgeStatus(page, CONNECTED_STATUS);
  await expect(setupGuideDialog(page)).toBeVisible();
  await expect(setupCompleteDialog(page)).toHaveCount(0);
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
  await pushBridgeStatus(page, TOKEN_MISMATCH_STATUS);
  const screen = setupScreen(page);
  await expect(screen.locator('.loading-message strong')).toHaveText('Bridge token does not match');
  await expect(
    screen.getByText(
      'MetaTrader 5 uses a different bridge token. Open the setup guide and choose Install and restart MT5.',
    ),
  ).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Open setup guide' })).toBeVisible();
  await expect(page.getByText('authentication failed')).toHaveCount(0);

  // The hint names Install and restart MT5, but the guide still opens at its first step.
  await screen.getByRole('button', { name: 'Open setup guide' }).click();
  await expectGuideOnStep(setupGuideDialog(page), SETUP_GUIDE_FIRST_STEP);
});

/** Opens the guide's Connect step from App settings under the paused clock, its install already done. */
async function openConnectStepWithUpdatedInstall(page: Page): Promise<void> {
  await gotoWithStub(page, {
    responses: { ...CONNECTING_BRIDGE, install_to_mt5: cleanInstallReport('updated') },
  });
  await openConnectStepUnderPausedClock(page);
}

test('Happy trading remembers the setup on the device, so a reload keeps the setup screen away', async ({ page }) => {
  await pausePageClockAhead(page);
  await openConnectStepWithUpdatedInstall(page);

  await pushBridgeStatus(page, CONNECTED_STATUS);
  const complete = setupCompleteDialog(page);
  await expect(complete).toBeVisible();
  await complete.getByRole('button', { name: 'Happy trading' }).click();
  await expect(complete).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), SETUP_COMPLETED_KEY)).toBe('true');

  await page.reload();
  // Wait for the reloaded window to stand before judging what is missing from it.
  await expect(page.locator('main.dashboard')).toBeVisible();
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(setupScreen(page)).toHaveCount(0);
  // The reloaded device waits out its start before the notice offers the guide back.
  const notice = await expectBridgeNotice(page, EA_NOT_CONNECTED_MESSAGE);

  await notice.getByRole('button', { name: 'Open setup guide' }).click();
  await revealLazyGuide(page);
  await expectGuideOnStep(setupGuideDialog(page), SETUP_GUIDE_FIRST_STEP);
});

// Install and restart MT5 drops the bridge for a moment, so its silence must not raise a notice
// that sends the user back to the guide they are already in.
test('a completed setup keeps the guide notices away while the guide and its finished screen hold the window', async ({
  page,
}) => {
  await pausePageClockAhead(page);
  await markSetupCompleted(page);
  await openConnectStepWithUpdatedInstall(page);

  await page.clock.runFor(NOT_CONNECTED_NOTICE_REVEAL_MS);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(reconnectLoader(page)).toHaveCount(0);

  await pushBridgeStatus(page, CONNECTED_STATUS);
  await expect(setupCompleteDialog(page)).toBeVisible();

  await page.clock.runFor(NOT_CONNECTED_NOTICE_REVEAL_MS);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the not-connected notice waits out the EA longest retry gap before it shows', async ({ page }) => {
  await openCompletedSetupWithCandles(page);
  await pushBridgeStatus(page, { state: 'connecting' });

  await page.clock.runFor(EA_LONGEST_RETRY_GAP_WITH_SLACK_MS);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await expectBridgeNotice(page, EA_NOT_CONNECTED_MESSAGE);
});

const NOTICE_PER_TERMINAL_PROCESS: Array<{ terminalProcess: TerminalProcess; message: string }> = [
  { terminalProcess: 'not_running', message: TERMINAL_NOT_RUNNING_MESSAGE },
  { terminalProcess: 'running', message: EA_NOT_CONNECTED_MESSAGE },
  { terminalProcess: 'unknown', message: UNKNOWN_TERMINAL_MESSAGE },
];

for (const { terminalProcess, message } of NOTICE_PER_TERMINAL_PROCESS) {
  test(`the not-connected notice says "${message}" when the terminal check answers ${terminalProcess}`, async ({
    page,
  }) => {
    await openCompletedSetupWithCandles(page, {
      responses: { get_mt5_backend_status: backendStatusWith(terminalProcess) },
    });
    await pushBridgeStatus(page, { state: 'connecting' });

    const notice = await expectBridgeNotice(page, message);
    await expect(notice.getByRole('button', { name: 'Open setup guide' })).toBeVisible();
  });
}

test('the not-connected notice keeps its plain wording when the terminal check fails', async ({ page }) => {
  await openCompletedSetupWithCandles(page, { failures: { get_mt5_backend_status: 'inspection failed' } });
  await pushBridgeStatus(page, { state: 'connecting' });

  await expectBridgeNotice(page, UNKNOWN_TERMINAL_MESSAGE);
});

test('the terminal is not checked before the notice shows', async ({ page }) => {
  await openCompletedSetupWithCandles(page);
  await pushBridgeStatus(page, { state: 'connecting' });

  await page.clock.runFor(EA_LONGEST_RETRY_GAP_WITH_SLACK_MS);
  expect(await wasInvoked(page, 'get_mt5_backend_status')).toBeUndefined();

  await expectBridgeNotice(page, EA_NOT_CONNECTED_MESSAGE);
  expect(await wasInvoked(page, 'get_mt5_backend_status')).toBeDefined();
});

test('the shown notice follows the terminal as it starts, in place', async ({ page }) => {
  await openCompletedSetupWithCandles(page, {
    responses: { get_mt5_backend_status: backendStatusWith('not_running') },
  });
  await pushBridgeStatus(page, { state: 'connecting' });
  await expectBridgeNotice(page, TERMINAL_NOT_RUNNING_MESSAGE);

  await setStubResponse(page, 'get_mt5_backend_status', backendStatusWith('running'));
  await page.clock.runFor(TERMINAL_RECHECK_MS);

  await expect(bridgeNotice(page, EA_NOT_CONNECTED_MESSAGE)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(1);
});

test('a drawn chart hides a blip, then shows the reconnect loader, then hands over to the notice', async ({ page }) => {
  await openCompletedSetupWithCandles(page);
  await pushBridgeStatus(page, { state: 'connecting' });

  await page.clock.runFor(BLIP_BEFORE_RECONNECT_LOADER_MS);
  await expect(reconnectLoader(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.clock.runFor(RECONNECT_LOADER_REVEAL_MS - BLIP_BEFORE_RECONNECT_LOADER_MS);
  await expect(reconnectLoader(page)).toBeVisible();
  await expect(page.locator('.chart-overlay')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.clock.runFor(LOADER_TO_NOTICE_MS);
  await expect(bridgeNotice(page, EA_NOT_CONNECTED_MESSAGE)).toBeVisible();
  await expect(reconnectLoader(page)).toHaveCount(0);
});

test('connecting again removes the reconnect loader at once', async ({ page }) => {
  await openCompletedSetupWithCandles(page);
  await pushBridgeStatus(page, { state: 'connecting' });
  await page.clock.runFor(RECONNECT_LOADER_REVEAL_MS);
  await expect(reconnectLoader(page)).toBeVisible();

  await pushBridgeStatus(page, CONNECTED_STATUS);
  await expect(reconnectLoader(page)).toHaveCount(0);
  await expect(page.locator('.chart-overlay')).toHaveCount(0);
});

for (const { message, action, status: problemStatus } of BRIDGE_PROBLEM_NOTICES) {
  test(`a completed setup reports "${message}" in a notice whose ${action} button opens the first step`, async ({
    page,
  }) => {
    await openCompletedSetupWithCandles(page);
    await pushBridgeStatus(page, problemStatus);

    const notice = await expectBridgeNotice(page, message);
    await notice.getByRole('button', { name: action }).click();
    await revealLazyGuide(page);

    await expectGuideOnStep(setupGuideDialog(page), SETUP_GUIDE_FIRST_STEP);
  });
}
