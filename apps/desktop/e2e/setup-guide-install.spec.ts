import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoWithStub, type TauriStubOptions } from './helpers/tauriStub';
import {
  DEFAULT_TERMINAL_PATH,
  PORTABLE_MQL5_PATH,
  STANDARD_MQL5_PATH,
  TWO_DATA_FOLDERS,
  cleanInstallReport,
  mt5Installation,
  mt5InstallRequests,
  mt5RestartRequests,
  openSetupGuide,
  type Mt5InstallRequest,
} from './helpers/setupGuide';

/** The two presses the section offers, in the words their buttons show while idle. */
const INSTALL_BUTTON = 'Install to MT5';
const INSTALL_AND_RESTART_BUTTON = 'Install and restart MT5';

/** The target the stub's default installation resolves to, as both commands name it. */
const PORTABLE_TARGET: Mt5InstallRequest = { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: PORTABLE_MQL5_PATH };

/** Opens the guide on a stub with the given scripted answers, presses `button`, and returns the install section. */
async function pressInstall(page: Page, stubOptions: TauriStubOptions, button: string): Promise<Locator> {
  await gotoWithStub(page, stubOptions);
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');
  await install.getByRole('button', { name: button }).click();
  return install;
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
        compiled: indicatorCompiled && indicatorCompiled.errors > 0 ? null : { errors: 0, warnings: 0, messages: [] },
      },
    ],
  };
}

test('Install to MT5 installs both files and says nothing on a clean compile', async ({ page }) => {
  await gotoWithStub(page, { responses: { install_to_mt5: cleanInstallReport('updated') } });
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');

  // One target: shown as text, with no folder select to ask about, and both actions offered.
  await expect(install.locator('.setup-guide-install-target')).toContainText('MetaTrader 5');
  await expect(install.locator('code')).toHaveText(PORTABLE_MQL5_PATH);
  await expect(install.getByRole('combobox')).toHaveCount(0);
  await expect(install.getByRole('button')).toHaveText([INSTALL_BUTTON, INSTALL_AND_RESTART_BUTTON]);
  expect(await mt5InstallRequests(page)).toEqual([]);

  await install.getByRole('button', { name: INSTALL_BUTTON }).click();

  expect(await mt5InstallRequests(page)).toEqual([PORTABLE_TARGET]);
  expect(await mt5RestartRequests(page)).toEqual([]);
  // Success has no words of its own: the actions row holds its two buttons and nothing else.
  await expect(install.locator('.setup-guide-install-actions > *')).toHaveCount(2);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  await expect(install.getByRole('alert')).toHaveCount(0);
  await expect(install.getByRole('status')).toHaveCount(0);
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
    responses: { list_mt5_installations: [mt5Installation({ dataFolders: TWO_DATA_FOLDERS })] },
  });
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');

  const folder = install.getByLabel('MetaTrader 5 data folder');
  await expect(folder.locator('option')).toHaveText([
    `MetaTrader 5: ${PORTABLE_MQL5_PATH}`,
    `MetaTrader 5: ${STANDARD_MQL5_PATH}`,
  ]);
  await folder.selectOption({ label: `MetaTrader 5: ${STANDARD_MQL5_PATH}` });
  await install.getByRole('button', { name: INSTALL_BUTTON }).click();

  expect(await mt5InstallRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: STANDARD_MQL5_PATH },
  ]);
  await expect(folder).toBeEnabled();
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
});

test('Install and restart MT5 installs, then reopens the same target with nothing else shown', async ({ page }) => {
  await gotoWithStub(page, { responses: { install_to_mt5: cleanInstallReport('installed') } });
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');

  await install.getByRole('button', { name: INSTALL_AND_RESTART_BUTTON }).click();

  // The restart names the folder the install wrote into, and a clean run adds no words.
  expect(await mt5InstallRequests(page)).toEqual([PORTABLE_TARGET]);
  expect(await mt5RestartRequests(page)).toEqual([PORTABLE_TARGET]);
  await expect(install.getByRole('button')).toHaveText([INSTALL_BUTTON, INSTALL_AND_RESTART_BUTTON]);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  await expect(install.locator('.setup-guide-install-error')).toHaveCount(0);
});

test('a compile with a warning is not clean, so the restart button stops at the rows', async ({ page }) => {
  const install = await pressInstall(
    page,
    { responses: { install_to_mt5: reportWithIndicator({ errors: 0, warnings: 1, messages: [] }) } },
    INSTALL_AND_RESTART_BUTTON,
  );

  await expect(install.locator('.setup-guide-install-file-compile')).toHaveText([
    '0 errors, 1 warning',
    'Compiled, 0 errors',
  ]);
  expect(await mt5InstallRequests(page)).toEqual([PORTABLE_TARGET]);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a broken indicator reports its messages and never restarts MT5', async ({ page }) => {
  const indicatorMessage =
    "BetterChartsTickHistoryReader.mq5 (48,12) : error 123: 'OnCalculate' - undeclared identifier";
  const install = await pressInstall(
    page,
    { responses: { install_to_mt5: reportWithIndicator({ errors: 1, warnings: 2, messages: [indicatorMessage] }) } },
    INSTALL_AND_RESTART_BUTTON,
  );

  await expect(install.locator('.setup-guide-install-file-outcome')).toHaveText(['Installed', 'Already up to date']);
  await expect(install.locator('.setup-guide-install-file-compile')).toHaveText([
    '1 error, 2 warnings',
    'Not compiled: the indicator has errors',
  ]);
  await expect(install.locator('.setup-guide-install-messages li')).toHaveText([indicatorMessage]);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a refused install shows the reason and never restarts MT5', async ({ page }) => {
  const refusal = 'An order is being sent to MT5; install after it settles.';
  const install = await pressInstall(page, { failures: { install_to_mt5: refusal } }, INSTALL_AND_RESTART_BUTTON);

  await expect(install.getByRole('alert')).toHaveText(refusal);
  await expect(install.getByRole('button')).toHaveText([INSTALL_BUTTON, INSTALL_AND_RESTART_BUTTON]);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  expect(await mt5RestartRequests(page)).toEqual([]);
});

test('a refused restart shows the reason and leaves no rows behind', async ({ page }) => {
  const refusal = 'Set the bridge token in App settings first.';
  const install = await pressInstall(
    page,
    { responses: { install_to_mt5: cleanInstallReport('installed') }, failures: { restart_mt5_with_ea: refusal } },
    INSTALL_AND_RESTART_BUTTON,
  );

  await expect(install.getByRole('alert')).toHaveText(refusal);
  await expect(install.locator('.setup-guide-install-file')).toHaveCount(0);
  expect(await mt5RestartRequests(page)).toEqual([PORTABLE_TARGET]);
});

test('both buttons and the folder select wait out the install and the restart', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      list_mt5_installations: [mt5Installation({ dataFolders: TWO_DATA_FOLDERS })],
      install_to_mt5: cleanInstallReport('updated'),
    },
    installDelayMs: 800,
    restartDelayMs: 800,
  });
  const guide = await openSetupGuide(page);
  const install = guide.locator('.setup-guide-install');
  const folder = install.getByLabel('MetaTrader 5 data folder');
  const buttons = install.locator('.setup-guide-install-run');
  await folder.selectOption({ label: `MetaTrader 5: ${STANDARD_MQL5_PATH}` });

  await buttons.last().click();

  // The pressed button names its step; the other keeps its label, and nothing else can be used.
  await expect(buttons.last()).toHaveText('Installing…');
  await expect(buttons.first()).toHaveText(INSTALL_BUTTON);
  await expect(buttons.first()).toBeDisabled();
  await expect(buttons.last()).toBeDisabled();
  await expect(folder).toBeDisabled();
  await expect(buttons.last()).toHaveText('Restarting MT5…');
  await expect(buttons.last()).toBeDisabled();

  await expect.poll(async () => mt5RestartRequests(page)).toHaveLength(1);
  expect(await mt5RestartRequests(page)).toEqual([
    { terminalPath: DEFAULT_TERMINAL_PATH, mql5Path: STANDARD_MQL5_PATH },
  ]);
  await expect(buttons.last()).toHaveText(INSTALL_AND_RESTART_BUTTON);
  await expect(buttons.first()).toBeEnabled();
  await expect(folder).toBeEnabled();
});
