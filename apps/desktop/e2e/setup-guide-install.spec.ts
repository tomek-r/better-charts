import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_TERMINAL_PATH,
  PORTABLE_MQL5_PATH,
  STANDARD_MQL5_PATH,
  TWO_DATA_FOLDERS,
  cleanInstallReport,
  mt5Installation,
  mt5InstallRequests,
  mt5RestartRequests,
  openInstallStep,
  openSetupGuide,
  type Mt5InstallRequest,
} from './helpers/setupGuide';
import { gotoWithStub, pushBridgeStatus, type TauriStubOptions } from './helpers/tauriStub';

/** The two automatic presses, in the words their buttons show while idle. */
const INSTALL_ONLY_BUTTON = 'Install only';
const INSTALL_AND_RESTART_BUTTON = 'Install and restart MT5';

/** The target the stub's default installation resolves to, as both commands name it. */
const PORTABLE_TARGET: Mt5InstallRequest = { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: PORTABLE_MQL5_PATH };

/** A bridge that is still connecting while the guide installs, with candles so no screen covers the chart. */
const CONNECTING_BRIDGE = { get_bridge_status: { state: 'connecting' } };

/** The label the data-folder select gives the installation's user data folder. */
const USER_DATA_FOLDER = 'MetaTrader 5 — user data folder';

/** A machine whose one installation offers two data folders, with an install that only updates files. */
const TWO_FOLDER_RESPONSES = {
  ...CONNECTING_BRIDGE,
  list_mt5_installations: [mt5Installation({ dataFolders: TWO_DATA_FOLDERS })],
  install_to_mt5: cleanInstallReport('updated'),
};

/** Picks the user data folder on the guide's first step, so an install has to name that path. */
async function pickUserDataFolder(guide: Locator): Promise<void> {
  await guide.getByLabel('MetaTrader 5 data folder').selectOption({ label: USER_DATA_FOLDER });
}

/** Opens the guide on a stub with the given scripted answers, presses `button`, and returns the guide. */
async function pressInstall(
  page: Page,
  button: string,
  script: Pick<TauriStubOptions, 'responses' | 'failures'>,
): Promise<Locator> {
  await gotoWithStub(page, {
    responses: { ...CONNECTING_BRIDGE, ...(script.responses ?? {}) },
    failures: script.failures,
  });
  const guide = await openInstallStep(page);
  await guide.getByRole('button', { name: button }).click();
  return guide;
}

/** A compile result with nothing left to fix. */
function cleanCompile() {
  return { errors: 0, warnings: 0, messages: [] };
}

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
        compiled: indicatorCompiled && indicatorCompiled.errors > 0 ? null : cleanCompile(),
      },
    ],
  };
}

test('two data folders ask which one to install into, and Install only sends its path', async ({ page }) => {
  await gotoWithStub(page, { responses: TWO_FOLDER_RESPONSES });
  const guide = await openSetupGuide(page);

  // The options name the layout, never the folder path.
  const folder = guide.getByLabel('MetaTrader 5 data folder');
  await expect(folder.locator('option')).toHaveText(['MetaTrader 5 — portable data folder', USER_DATA_FOLDER]);
  await pickUserDataFolder(guide);
  await guide.getByRole('button', { name: 'Next' }).click();
  await guide.getByRole('button', { name: INSTALL_ONLY_BUTTON }).click();

  await expect(guide.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
  expect(await mt5InstallRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: STANDARD_MQL5_PATH },
  ]);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a clean Install only moves on to the connection step', async ({ page }) => {
  await gotoWithStub(page, { responses: { ...CONNECTING_BRIDGE, install_to_mt5: cleanInstallReport('updated') } });
  const guide = await openInstallStep(page);

  await guide.getByRole('button', { name: INSTALL_ONLY_BUTTON }).click();

  await expect(guide.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
  await expect(guide.locator('.loading-message strong')).toHaveText('Waiting for the EA to connect…');
  await expect(guide.getByText('BetterChartsBridge is attached to a chart')).toBeVisible();
  await expect(guide.locator('.setup-guide-install-file')).toHaveCount(0);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a clean Install and restart moves on to Connect, and the connection finishes the setup', async ({ page }) => {
  await gotoWithStub(page, { responses: { ...CONNECTING_BRIDGE, install_to_mt5: cleanInstallReport('installed') } });
  const guide = await openInstallStep(page);

  await guide.getByRole('button', { name: INSTALL_AND_RESTART_BUTTON }).click();

  await expect(guide.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
  expect(await mt5InstallRequests(page)).toEqual([PORTABLE_TARGET]);
  expect(await mt5RestartRequests(page)).toEqual([PORTABLE_TARGET]);

  await pushBridgeStatus(page, { state: 'connected', message: 'Bridge connected.' });

  await expect(guide).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Setup complete' })).toBeVisible();
});

test('a compile with a warning is not clean, so the restart button stops at the rows', async ({ page }) => {
  const guide = await pressInstall(page, INSTALL_AND_RESTART_BUTTON, {
    responses: { install_to_mt5: reportWithIndicator({ errors: 0, warnings: 1, messages: [] }) },
  });

  await expect(guide.locator('.setup-guide-install-file-compile')).toHaveText([
    '0 errors, 1 warning',
    'Compiled, 0 errors',
  ]);
  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  expect(await mt5InstallRequests(page)).toEqual([PORTABLE_TARGET]);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a broken indicator reports its messages and never restarts MT5', async ({ page }) => {
  const indicatorMessage =
    "BetterChartsTickHistoryReader.mq5 (48,12) : error 123: 'OnCalculate' - undeclared identifier";
  const guide = await pressInstall(page, INSTALL_AND_RESTART_BUTTON, {
    responses: { install_to_mt5: reportWithIndicator({ errors: 1, warnings: 2, messages: [indicatorMessage] }) },
  });

  await expect(guide.locator('.setup-guide-install-file-outcome')).toHaveText(['Installed', 'Already up to date']);
  await expect(guide.locator('.setup-guide-install-file-compile')).toHaveText([
    '1 error, 2 warnings',
    'Not compiled: the indicator has errors',
  ]);
  await expect(guide.locator('.setup-guide-install-messages li')).toHaveText([indicatorMessage]);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a refused install shows the reason inline and never restarts MT5', async ({ page }) => {
  const refusal = 'An order is being sent to MT5; install after it settles.';
  const guide = await pressInstall(page, INSTALL_AND_RESTART_BUTTON, { failures: { install_to_mt5: refusal } });

  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  await expect(guide.getByRole('alert')).toHaveText(refusal);
  await expect(guide.locator('.setup-guide-install-file')).toHaveCount(0);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a refused restart shows the reason and leaves no rows behind', async ({ page }) => {
  const refusal = 'Set the bridge token in App settings first.';
  const guide = await pressInstall(page, INSTALL_AND_RESTART_BUTTON, {
    responses: { install_to_mt5: cleanInstallReport('installed') },
    failures: { restart_mt5_with_ea: refusal },
  });

  await expect(guide.getByRole('alert')).toHaveText(refusal);
  await expect(guide.locator('.setup-guide-install-file')).toHaveCount(0);
  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  expect(await mt5RestartRequests(page)).toEqual([PORTABLE_TARGET]);
});

test('both buttons wait out the install and the restart', async ({ page }) => {
  await gotoWithStub(page, { responses: TWO_FOLDER_RESPONSES, installDelayMs: 800, restartDelayMs: 800 });
  const guide = await openSetupGuide(page);
  await pickUserDataFolder(guide);
  await guide.getByRole('button', { name: 'Next' }).click();
  const installOnly = guide.getByRole('button', { name: INSTALL_ONLY_BUTTON });
  const installAndRestart = guide.getByRole('button', { name: INSTALL_AND_RESTART_BUTTON });

  await installAndRestart.click();

  // The pressed button names its step; the other keeps its label, and nothing else can be used.
  const installButtons = guide.locator('.setup-guide-install-run');
  await expect(installButtons.first()).toHaveText('Installing…');
  await expect(installButtons.nth(1)).toHaveText(INSTALL_ONLY_BUTTON);
  await expect(installButtons.first()).toBeDisabled();
  await expect(installOnly).toBeDisabled();
  await expect(installButtons.first()).toHaveText('Restarting MT5…');
  await expect(installButtons.first()).toBeDisabled();

  await expect.poll(async () => mt5RestartRequests(page)).toHaveLength(1);
  expect(await mt5RestartRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: STANDARD_MQL5_PATH },
  ]);
  // A clean restart hands the guide on to the connection step.
  await expect(guide.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Setup complete' })).toHaveCount(0);
});
