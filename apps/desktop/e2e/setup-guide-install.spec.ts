import { expect, test, type Locator, type Page } from '@playwright/test';
import type { BridgeStatus } from '../src/shared/bridge/types';
import { gotoWithStub, pushBridgeStatus } from './helpers/tauriStub';
import {
  DEFAULT_TERMINAL_PATH,
  cleanInstallReport,
  PORTABLE_MQL5_PATH,
  STANDARD_MQL5_PATH,
  mt5InstallRequests,
  mt5Installation,
  mt5RestartRequests,
  openSetupGuide,
} from './helpers/setupGuide';

const FIRST_INSTALL_LINE =
  'Installed and compiled. Drag BetterChartsBridge onto a chart in MT5 and enter the token, or restart MT5 with the EA attached.';
const RECONNECT_LINE = 'Installed and compiled. MT5 reloads the EA and the bridge reconnects.';
const REATTACH_LINE =
  'Installed and compiled. Reattach BetterChartsBridge in MT5. Or restart MT5 with the EA attached.';
/** The words a done line turns into the restart button. */
const RESTART_WORDS = 'restart MT5 with the EA attached';
/** The confirmation the button opens, before anything closes. */
const RESTART_CONFIRM_LINE = 'MT5 will close and reopen with the EA attached.';
/** The line the row reports once the backend has relaunched the terminal. */
const RESTART_DONE_LINE = 'MT5 is restarting with the EA attached. Enable Algo Trading in MT5 if it is off.';
/** The stub's default report updates the EA, and its default bridge is connected: the reconnect line. */
const DONE_LINE = RECONNECT_LINE;
/** The success line's tooltip: the same sentence, then what each file became. */
const DONE_TITLE = `${DONE_LINE} BetterChartsTickHistoryReader.mq5 installed, BetterChartsBridge.mq5 updated`;

/** Layout height: unlike boundingBox it ignores the dialog's scale-in animation transform. */
const layoutHeight = (element: Locator) => element.evaluate((node) => (node as HTMLElement).offsetHeight);

/** The success line shares the button's row: it starts and ends within the button's vertical extent. */
async function expectBesideButton(install: Locator, done: Locator): Promise<void> {
  const button = await install.getByRole('button', { name: 'Install to MT5' }).boundingBox();
  const line = await done.boundingBox();
  expect(line!.y).toBeGreaterThanOrEqual(button!.y);
  expect(line!.y + line!.height).toBeLessThanOrEqual(button!.y + button!.height);
}

test('installs both files into the only data folder and reports the clean compile beside the button', async ({
  page,
}) => {
  await gotoWithStub(page);
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');

  // One target: shown as text, with no folder select to ask about.
  await expect(install.locator('.setup-guide-install-target')).toContainText('MetaTrader 5');
  await expect(install.locator('code')).toHaveText(PORTABLE_MQL5_PATH);
  await expect(install.getByRole('combobox')).toHaveCount(0);
  await expect(install.getByRole('button', { name: 'Install to MT5' })).toBeEnabled();
  expect(await mt5InstallRequests(page)).toEqual([]);
  const heightBefore = await layoutHeight(guide);

  await install.getByRole('button', { name: 'Install to MT5' }).click();

  // A clean run reports one line in the button's own row: no result rows, and the
  // dialog keeps the height it had before installing.
  const done = install.locator('.setup-guide-install-actions .setup-guide-install-done');
  await expect(done).toHaveText(DONE_LINE);
  await expect(done).toHaveAttribute('title', DONE_TITLE);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  expect(await done.evaluate((element) => element.parentElement?.className)).toBe('setup-guide-install-actions');
  expect(await layoutHeight(guide)).toBe(heightBefore);

  // Same row as the button, not a paragraph under it.
  await expectBesideButton(install, done);

  // The line belongs to the automatic section, never to the numbered steps.
  await expect(guide.locator('.setup-guide-steps .setup-guide-install-done')).toHaveCount(0);
  expect(await mt5InstallRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: PORTABLE_MQL5_PATH },
  ]);
});

test('a machine without MetaTrader 5 points at the manual steps and offers no install', async ({ page }) => {
  await gotoWithStub(page, { responses: { list_mt5_installations: [] } });
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');

  await expect(install.locator('.setup-guide-install-note')).toHaveText(
    'MetaTrader 5 was not found on this computer. Use the manual steps below.',
  );
  await expect(install.getByRole('button')).toHaveCount(0);
  await expect(guide.locator('.setup-guide-manual-title')).toHaveText('Or install manually');
});

test('two data folders ask which one to install into and send its path', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      list_mt5_installations: [
        mt5Installation({
          dataFolders: [
            { mql5Path: PORTABLE_MQL5_PATH, layout: 'portable' },
            { mql5Path: STANDARD_MQL5_PATH, layout: 'standard' },
          ],
        }),
      ],
    },
  });
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');

  const folder = install.getByLabel('MetaTrader 5 data folder');
  await expect(folder.locator('option')).toHaveText([
    `MetaTrader 5: ${PORTABLE_MQL5_PATH}`,
    `MetaTrader 5: ${STANDARD_MQL5_PATH}`,
  ]);
  await folder.selectOption({ label: `MetaTrader 5: ${STANDARD_MQL5_PATH}` });
  await install.getByRole('button', { name: 'Install to MT5' }).click();

  await expect(install.locator('.setup-guide-install-actions .setup-guide-install-done')).toHaveText(DONE_LINE);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  expect(await mt5InstallRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: STANDARD_MQL5_PATH },
  ]);
});

/** Opens the guide on a stub with the given scripted answers, clicks Install, and returns the install section. */
async function runInstall(page: Page, stubOptions: Parameters<typeof gotoWithStub>[1]): Promise<Locator> {
  await gotoWithStub(page, stubOptions);
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');
  await install.getByRole('button', { name: 'Install to MT5' }).click();
  return install;
}

/**
 * Opens the guide, shows `bridge` as the current connection when a test needs one other
 * than the stub's connected default, installs once, and returns the dialog with the
 * install section and the done line it reports.
 */
async function installOnce(page: Page, stubOptions: Parameters<typeof gotoWithStub>[1], bridge?: BridgeStatus) {
  await gotoWithStub(page, stubOptions);
  const guide = await openSetupGuide(page);
  if (bridge) {
    await pushBridgeStatus(page, bridge);
  }
  const install = guide.locator('.setup-guide-install');
  const done = install.locator('.setup-guide-install-actions .setup-guide-install-done');
  await install.getByRole('button', { name: 'Install to MT5' }).click();
  return { guide, install, done };
}

const DONE_LINE_CASES = [
  {
    name: 'a first install names both routes to a connection',
    report: cleanInstallReport('installed'),
    bridge: { state: 'connected' },
    line: FIRST_INSTALL_LINE,
  },
  {
    name: 'an update while connected says the bridge reconnects',
    report: cleanInstallReport('updated'),
    bridge: { state: 'connected' },
    line: RECONNECT_LINE,
  },
  {
    name: 'an update while not connected asks to reattach the EA',
    report: cleanInstallReport('updated'),
    bridge: { state: 'disconnected' },
    line: REATTACH_LINE,
  },
] as const;

for (const { name, report, bridge, line } of DONE_LINE_CASES) {
  test(`${name}, in full beside the button without changing the dialog height`, async ({ page }) => {
    await gotoWithStub(page, { responses: { install_to_mt5: report } });
    const guide = await openSetupGuide(page);
    const install = guide.locator('.setup-guide-install');
    await pushBridgeStatus(page, bridge);
    const heightBefore = await layoutHeight(guide);

    await install.getByRole('button', { name: 'Install to MT5' }).click();

    const done = install.locator('.setup-guide-install-actions .setup-guide-install-done');
    await expect(done).toHaveText(line);
    await expectBesideButton(install, done);
    expect(await layoutHeight(guide)).toBe(heightBefore);
    // The two-line clamp must not cut the sentence off at the default viewport.
    expect(await done.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  });
}

test('a refused install shows the reason and leaves the button usable', async ({ page }) => {
  const refusal = 'An order is being sent to MT5; install after it settles.';
  const install = await runInstall(page, { failures: { install_to_mt5: refusal } });

  await expect(install.getByRole('alert')).toHaveText(refusal);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  await expect(install.getByRole('button', { name: 'Install to MT5' })).toBeEnabled();
});

/** An install report whose indicator compiled as given and whose EA compiled clean. */
function reportWithIndicator(indicatorCompiled: { errors: number; warnings: number; messages: string[] } | null) {
  return {
    files: [
      {
        file: 'indicator',
        path: '/mt5/drive_c/Program Files/MetaTrader 5/MQL5/Indicators/BetterChartsTickHistoryReader.mq5',
        outcome: 'installed',
        compiled: indicatorCompiled,
      },
      {
        file: 'expertAdvisor',
        path: '/mt5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/BetterChartsBridge.mq5',
        outcome: 'unchanged',
        compiled: indicatorCompiled && indicatorCompiled.errors > 0 ? null : { errors: 0, warnings: 0, messages: [] },
      },
    ],
  };
}

test('a compile with a warning is not reported as clean and gets no done line', async ({ page }) => {
  const install = await runInstall(page, {
    responses: { install_to_mt5: reportWithIndicator({ errors: 0, warnings: 1, messages: [] }) },
  });

  await expect(install.locator('.setup-guide-install-file-compile')).toHaveText([
    '0 errors, 1 warning',
    'Compiled, 0 errors',
  ]);
  await expect(install.locator('.setup-guide-install-done')).toHaveCount(0);
});

test('a broken indicator reports its messages and stops short of the done line', async ({ page }) => {
  const indicatorMessage =
    "BetterChartsTickHistoryReader.mq5 (48,12) : error 123: 'OnCalculate' - undeclared identifier";
  const install = await runInstall(page, {
    responses: {
      install_to_mt5: reportWithIndicator({ errors: 1, warnings: 2, messages: [indicatorMessage] }),
    },
  });

  await expect(install.locator('.setup-guide-install-file-outcome')).toHaveText(['Installed', 'Already up to date']);
  await expect(install.locator('.setup-guide-install-file-compile')).toHaveText([
    '1 error, 2 warnings',
    'Not compiled: the indicator has errors',
  ]);
  await expect(install.locator('.setup-guide-install-messages li')).toHaveText([indicatorMessage]);
  await expect(install.locator('.setup-guide-install-done')).toHaveCount(0);
});

test('a first install offers a restart that asks before MT5 closes', async ({ page }) => {
  const { guide, install, done } = await installOnce(page, {
    responses: { install_to_mt5: cleanInstallReport('installed') },
  });
  await expect(done).toHaveText(FIRST_INSTALL_LINE);
  const heightWithLink = await layoutHeight(guide);
  const link = done.getByRole('button', { name: RESTART_WORDS });
  await expect(link).toBeVisible();

  // The link only asks: nothing reaches the backend until Restart MT5 is pressed, and
  // the confirmation replaces the line without moving the row.
  await link.click();
  await expect(install.locator('.setup-guide-install-confirm-text')).toHaveText(RESTART_CONFIRM_LINE);
  await expect(install.getByRole('button', { name: 'Restart MT5' })).toBeFocused();
  expect(await mt5RestartRequests(page)).toEqual([]);
  expect(await layoutHeight(guide)).toBe(heightWithLink);

  // Cancel puts the line back, with focus on the button it came from.
  await install.getByRole('button', { name: 'Cancel' }).click();
  await expect(done).toHaveText(FIRST_INSTALL_LINE);
  await expect(link).toBeFocused();
  expect(await mt5RestartRequests(page)).toEqual([]);
  expect(await layoutHeight(guide)).toBe(heightWithLink);

  // Confirmed: the target the install wrote into goes to the backend, and the row
  // reports the terminal coming back in the same slot.
  await link.click();
  await install.getByRole('button', { name: 'Restart MT5' }).click();
  await expect(done).toHaveText(RESTART_DONE_LINE);
  expect(await layoutHeight(guide)).toBe(heightWithLink);
  expect(await mt5RestartRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: PORTABLE_MQL5_PATH },
  ]);
});

test('a refused restart shows the reason and brings the line back', async ({ page }) => {
  const refusal = 'Set the bridge token in App settings first.';
  const { install, done } = await installOnce(page, {
    responses: { install_to_mt5: cleanInstallReport('installed') },
    failures: { restart_mt5_with_ea: refusal },
  });
  await expect(done).toHaveText(FIRST_INSTALL_LINE);

  await done.getByRole('button', { name: RESTART_WORDS }).click();
  await install.getByRole('button', { name: 'Restart MT5' }).click();

  await expect(install.getByRole('alert')).toHaveText(refusal);
  await expect(done).toHaveText(FIRST_INSTALL_LINE);
  await expect(install.getByRole('button', { name: 'Install to MT5' })).toBeEnabled();
  expect(await mt5RestartRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: PORTABLE_MQL5_PATH },
  ]);
});

test('the reconnect line offers no restart, since the bridge returns by itself', async ({ page }) => {
  const { done } = await installOnce(page, { responses: { install_to_mt5: cleanInstallReport('updated') } });

  await expect(done).toHaveText(RECONNECT_LINE);
  await expect(done.getByRole('button')).toHaveCount(0);
});

test('an update with no bridge offers the restart beside the line asking to reattach the EA', async ({ page }) => {
  const { install, done } = await installOnce(
    page,
    { responses: { install_to_mt5: cleanInstallReport('updated') } },
    { state: 'disconnected' },
  );

  await expect(done).toHaveText(REATTACH_LINE);
  await done.getByRole('button', { name: RESTART_WORDS }).click();
  await expect(install.getByRole('button', { name: 'Restart MT5' })).toBeFocused();
  expect(await mt5RestartRequests(page)).toEqual([]);
});
