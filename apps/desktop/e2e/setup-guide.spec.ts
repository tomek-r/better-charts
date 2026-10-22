import { expect, test } from '@playwright/test';
import {
  currentGuideStep,
  guideSteps,
  mt5Choices,
  mt5Installation,
  openInstallStep,
  openSetupGuide,
  pickerOptions,
  scriptPickedTerminal,
} from './helpers/setupGuide';
import { gotoWithStub } from './helpers/tauriStub';

type SetupGuideSave = { resource: string; destination: string };

/** A terminal in a folder detection never looks at, as the folder picker returns it. */
const PICKED_TERMINAL = 'D:\\Trading\\MetaTrader 5\\terminal64.exe';
const PICKED_INSTALLATION = mt5Installation({ terminalPath: PICKED_TERMINAL, label: 'MT5 Trading' });

/** The install note names the folder an installation lives in, so two installations read apart. */
const DETECTED_FOLDER_NOTE = 'MetaTrader 5 folder: C:\\Program Files\\MetaTrader 5';
const PICKED_FOLDER_NOTE = 'MetaTrader 5 folder: D:\\Trading\\MetaTrader 5';

const MT5_NOT_FOUND_NOTE = 'MetaTrader 5 was not found. Use Choose folder… or the manual steps.';

test('the guide opens on Find MetaTrader 5 and walks to Install and back', async ({ page }) => {
  await gotoWithStub(page);
  const guide = await openSetupGuide(page);
  const steps = guideSteps(guide);

  await expect(steps).toHaveText(['Find MetaTrader 5', 'Install', 'Connect']);
  const stepNumberContent = await steps.evaluateAll((stepItems) =>
    stepItems.map((stepItem) => getComputedStyle(stepItem, '::before').content),
  );
  expect(stepNumberContent).toHaveLength(3);
  for (const content of stepNumberContent) {
    expect(content).toContain('counter(setup-guide-step)');
  }
  await expect(currentGuideStep(guide)).toHaveText('Find MetaTrader 5');
  // The step name lives in the indicator only: its heading stays for assistive tech, hidden on screen.
  const stepTitle = guide.getByRole('heading', { name: 'Find MetaTrader 5' });
  await expect(stepTitle).toBeVisible();
  await expect(stepTitle).toHaveCSS('position', 'absolute');
  // The detected installation is shown by the folder it lives in.
  await expect(guide.locator('.setup-guide-install-target')).toHaveText(DETECTED_FOLDER_NOTE);
  await expect(guide.getByRole('button', { name: 'Next' })).toBeEnabled();
  // The first step has nothing to go back to.
  await expect(guide.getByRole('button', { name: 'Back' })).toHaveCount(0);

  await guide.getByRole('button', { name: 'Next' }).click();

  await expect(currentGuideStep(guide)).toHaveText('Install');
  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  // Back belongs to the step indicator row, not to the install step's own actions.
  await expect(guide.locator('.setup-guide-progress-row').getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(guide.getByText('reopens MT5 with the EA attached')).toHaveCount(0);

  await guide.getByRole('button', { name: 'Back' }).click();

  await expect(currentGuideStep(guide)).toHaveText('Find MetaTrader 5');
  await expect(guide.getByRole('heading', { name: 'Find MetaTrader 5' })).toBeVisible();
});

test('Install manually instead folds out the steps, the downloads and a token copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoWithStub(page);
  const guide = await openInstallStep(page);

  await expect(guide.locator('.setup-guide-steps')).toBeHidden();
  await guide.getByText('Install manually instead').click();
  await expect(guide.locator('.setup-guide-steps li')).toHaveCount(6);

  const ea = guide.locator('.setup-guide-download[data-resource="mql5/Experts/BetterChartsBridge.mq5"]');
  const reader = guide.locator(
    '.setup-guide-download[data-resource="mql5/Indicators/BetterChartsTickHistoryReader.mq5"]',
  );
  await expect(ea).toBeEnabled();
  await expect(reader).toBeEnabled();
  await expect(ea).toContainText('BetterChartsBridge.mq5');
  await expect(reader).toContainText('BetterChartsTickHistoryReader.mq5');

  await ea.click();
  await expect
    .poll(() =>
      page.evaluate(() => ((window as { __setupGuideSaves?: SetupGuideSave[] }).__setupGuideSaves ?? []).length),
    )
    .toBe(1);
  const saves = await page.evaluate(() => (window as { __setupGuideSaves?: SetupGuideSave[] }).__setupGuideSaves);
  expect(saves?.[0]).toEqual({
    resource: 'mql5/Experts/BetterChartsBridge.mq5',
    destination: '/chosen/BetterChartsBridge.mq5',
  });

  await guide.getByRole('button', { name: 'Copy token' }).click();
  await expect(guide.getByRole('button', { name: 'Token copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('demo-settings-token');
});

test('Choose folder points the guide at a terminal outside the detected folders', async ({ page }) => {
  await gotoWithStub(page, {
    responses: { list_mt5_installations: [], choose_mt5_installation: [PICKED_INSTALLATION] },
  });
  const guide = await openSetupGuide(page);

  await expect(guide.getByText(MT5_NOT_FOUND_NOTE)).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Next' })).toBeDisabled();

  await scriptPickedTerminal(page, PICKED_TERMINAL);
  await guide.getByRole('button', { name: 'Choose folder…' }).click();

  await expect(guide.locator('.setup-guide-install-target')).toHaveText(PICKED_FOLDER_NOTE);
  await expect(guide.getByRole('button', { name: 'Next' })).toBeEnabled();
  expect(await mt5Choices(page)).toEqual([PICKED_TERMINAL]);
  expect(await pickerOptions(page)).toEqual({
    defaultPath: 'C:\\Program Files',
    multiple: false,
    directory: false,
    filters: [{ name: 'MetaTrader 5 terminal', extensions: ['exe'] }],
  });
});

test('a refused pick shows its reason inline', async ({ page }) => {
  const refusal = 'Choose the terminal64.exe file of your MetaTrader 5 installation.';
  await gotoWithStub(page, { failures: { choose_mt5_installation: refusal } });
  const guide = await openSetupGuide(page);

  await scriptPickedTerminal(page, 'D:\\Elsewhere\\terminal.exe');
  await guide.getByRole('button', { name: 'Choose folder…' }).click();

  await expect(guide.getByRole('alert')).toHaveText(refusal);
  await expect(guide.locator('.setup-guide-install-target')).toHaveText(DETECTED_FOLDER_NOTE);
});

test('a cancelled pick changes nothing', async ({ page }) => {
  await gotoWithStub(page);
  const guide = await openSetupGuide(page);

  await scriptPickedTerminal(page, null);
  await guide.getByRole('button', { name: 'Choose folder…' }).click();

  await expect.poll(() => pickerOptions(page)).toBeDefined();
  await expect(guide.locator('.setup-guide-install-target')).toHaveText(DETECTED_FOLDER_NOTE);
  await expect(guide.getByRole('button', { name: 'Next' })).toBeEnabled();
  await expect(guide.getByRole('alert')).toHaveCount(0);
  expect(await mt5Choices(page)).toEqual([]);
});

test('Escape and the close button dismiss only the guide; focus returns to the trigger', async ({ page }) => {
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  const trigger = dialog.getByRole('button', { name: 'How to set up the bridge connection' });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();

  const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
  await expect(guide).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(guide).toBeFocused();
  await expect(guide.getByRole('button', { name: 'Close setup guide' })).not.toBeFocused();

  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Close setup guide' }).click();
  await expect(guide).toBeHidden();
  await expect(dialog).toBeVisible();
});
