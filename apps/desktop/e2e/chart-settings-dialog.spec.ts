import { expect, test, type Locator, type Page } from '@playwright/test';
import { openChartMenu } from './helpers/chartMenu';
import { expectUtcZoneSaved, lastSavedOverridesArgs, timeZoneButton, UTC_CLOCK } from './helpers/chartTimeZonePage';
import {
  chartScopeKey,
  expectNoErrors,
  gotoWithStub,
  STUB_CHART_ID,
  stubChartSettingOverrides,
  stubInvocations,
} from './helpers/tauriStub';

/**
 * The chart's settings dialog: the row in the chart's right-click menu and the gear in its corner both
 * open it. Every edit shows on the chart at once, OK keeps and stores it, and Cancel, the × and Escape
 * put back what the chart showed when the dialog opened.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** The palette colour a candle's body defaults to, and the one a hidden body is drawn in. */
const UP_COLOR = '#26a69a';
const HIDDEN_BODY_UP_COLOR = 'transparent';
const NARROW_VIEWPORT = { width: 480, height: 720 };

const chartSettingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

async function saveCount(page: Page): Promise<number> {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'save_chart_setting_overrides').length;
}

/** Waits for the stub's ten bars, so the chart has candles whose colours can be read. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}

/** The colour the candle series draws its rising bars with, read back from the series itself. */
async function upColor(page: Page): Promise<string> {
  return page.evaluate(() => window.__chartTest!.candles().colors.upColor);
}

/** How many bars carry a colour of their own; none while the bars keep the series colours. */
async function coloredPointCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.candles().points.filter((point) => point.color !== undefined).length);
}

/** Waits for the dialog's entrance animation to finish, so a box read now is where the dialog stays. */
async function waitForDialogSettled(dialog: Locator): Promise<void> {
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
}

/** Opens the dialog from the menu row the feature adds, and waits for it to settle. */
async function openSettingsFromMenu(page: Page): Promise<void> {
  const menu = await openChartMenu(page);
  await menu.getByRole('menuitem', { name: 'Settings…' }).click();
  const dialog = chartSettingsDialog(page);
  await expect(dialog).toBeVisible();
  await waitForDialogSettled(dialog);
}

/** Waits for the bars, then opens the dialog from the chart menu and returns it. */
async function openSettingsDialog(page: Page): Promise<Locator> {
  await openChart(page);
  await openSettingsFromMenu(page);
  return chartSettingsDialog(page);
}

/** Unchecks the candle body and waits for the chart to draw the bodies hidden. */
async function hideCandleBodies(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('checkbox', { name: 'Body' }).uncheck();
  await expect.poll(() => upColor(page)).toBe(HIDDEN_BODY_UP_COLOR);
}

/** The dialog is gone, the chart draws the palette colours again, and nothing was stored. */
async function expectPaletteBackWithoutSave(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => upColor(page)).toBe(UP_COLOR);
  expect(await saveCount(page)).toBe(0);
}

/** How far the page scrolls sideways, which a dialog wider than the window would raise. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** One CSS property of an element as the browser resolved it, so the two settings dialogs can be compared. */
async function computedStyle(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

/** How tall one line of a label's text is, in pixels; `normal` only resolves by measuring a line of it. */
async function lineHeightPixels(label: Locator): Promise<number> {
  const declared = Number.parseFloat(await computedStyle(label, 'line-height'));
  if (!Number.isNaN(declared)) {
    return declared;
  }
  return label.evaluate((element) => {
    const line = element.appendChild(document.createElement('span'));
    line.textContent = 'X';
    const { height } = line.getBoundingClientRect();
    line.remove();
    return height;
  });
}

test('the chart menu lists the view command, a separator and the settings, which open the dialog', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const menu = await openChartMenu(page);
  const rows = menu.getByRole('menuitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Reset chart view');
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await expect(rows.nth(1)).toHaveText('Settings…');

  await rows.nth(1).click();
  const dialog = chartSettingsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Symbol' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Candles' })).toBeVisible();
  expectNoErrors(collected);
});

test('the gear in the chart corner opens the same dialog', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const gear = page.getByRole('button', { name: 'Chart settings', exact: true });
  await expect(gear).toBeVisible();
  const host = (await page.locator('.chart-host').boundingBox())!;
  const gearBox = (await gear.boundingBox())!;
  expect(gearBox.x).toBeGreaterThanOrEqual(host.x);
  expect(gearBox.y).toBeGreaterThanOrEqual(host.y);
  expect(Math.abs(gearBox.x + gearBox.width - (host.x + host.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(gearBox.y + gearBox.height - (host.y + host.height))).toBeLessThanOrEqual(1);

  await gear.click();
  const dialog = chartSettingsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Symbol' })).toHaveAttribute('aria-selected', 'true');
  expectNoErrors(collected);
});

test('unchecking the candle body shows it on the chart at once and Cancel puts the palette back', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);
  await hideCandleBodies(page, dialog);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expectPaletteBackWithoutSave(page, dialog);
  expectNoErrors(collected);
});

test('Escape closes the dialog and puts the chart back as it was', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);
  await hideCandleBodies(page, dialog);

  await page.keyboard.press('Escape');
  await expectPaletteBackWithoutSave(page, dialog);
  expectNoErrors(collected);
});

test('OK stores coloring by the previous close without moving the visible bars, and a reload keeps it', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);

  const rangeBeforeToggle = await page.evaluate(() => window.__chartTest!.visibleRange());
  await dialog.getByRole('checkbox', { name: 'Color bars based on previous close' }).check();
  await expect.poll(() => coloredPointCount(page)).toBe(STUB_BAR_COUNT);
  expect(await page.evaluate(() => window.__chartTest!.visibleRange())).toEqual(rangeBeforeToggle);

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  const overrides = { barStyles: { candles: { colorByPreviousClose: true } } };
  await expect.poll(() => stubChartSettingOverrides(page)).toEqual({ [EURUSD_CHART]: overrides });
  expect(await lastSavedOverridesArgs(page)).toEqual({
    chartId: STUB_CHART_ID,
    accountKey: ACCOUNT_KEY,
    symbol: 'EURUSD',
    overrides,
  });

  await page.reload();
  await openChart(page);
  await expect.poll(() => coloredPointCount(page)).toBe(STUB_BAR_COUNT);
  expectNoErrors(collected);
});

test('choosing UTC in the dialog relabels the footer clock before OK, and OK stores the zone', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);

  await dialog.getByRole('button', { name: 'Timezone' }).click();
  await page.getByRole('option', { name: 'UTC', exact: true }).click();
  await expect(timeZoneButton(page)).toHaveText(UTC_CLOCK);

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expectUtcZoneSaved(page);
  expectNoErrors(collected);
});

test('the Timezone row names the broker offset, the way the footer clock under the chart does', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);

  await expect(timeZoneButton(page)).toHaveText(/UTC\+3$/);
  await expect(dialog.getByRole('button', { name: 'Timezone' })).toHaveText('(UTC+3) Exchange');
  expectNoErrors(collected);
});

test('the Timezone select shows the default value in full, not cut off by its column', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);
  // The entrance animation moves the panel, so the select's box is read only once the dialog has settled.
  await waitForDialogSettled(dialog);

  const timeZoneSelect = dialog.getByRole('button', { name: 'Timezone' });
  await expect(timeZoneSelect).toHaveText('(UTC+3) Exchange');
  // An ellipsised value overflows its button, so scrollWidth grows past clientWidth.
  const { clientWidth, scrollWidth } = await timeZoneSelect.evaluate((button) => ({
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expectNoErrors(collected);
});

test('the chart Settings dialog is framed like App settings, its title and its open tab included', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const chartDialog = await openSettingsDialog(page);
  const chartTitleSize = await computedStyle(
    chartDialog.getByRole('heading', { name: 'Settings', exact: true }),
    'font-size',
  );
  const chartTabBorder = await computedStyle(chartDialog.getByRole('tab', { name: 'Symbol' }), 'border-top-color');
  await chartDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(chartDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const appDialog = page.getByRole('dialog', { name: 'App settings' });
  await expect(appDialog).toBeVisible();
  const appTitleSize = await computedStyle(
    appDialog.getByRole('heading', { name: 'App settings', exact: true }),
    'font-size',
  );
  const appTabBorder = await computedStyle(
    appDialog.getByRole('button', { name: 'MT5 setup', exact: true }),
    'border-top-color',
  );

  expect(chartTitleSize).toBe(appTitleSize);
  expect(chartTabBorder).toBe(appTabBorder);
  expectNoErrors(collected);
});

test('the previous-close checkbox label reads on one line at the default window', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);

  const previousCloseLabel = dialog
    .locator('.chart-settings-checkbox-row')
    .filter({ hasText: 'Color bars based on previous close' });
  const labelHeight = (await previousCloseLabel.boundingBox())!.height;
  const labelLineHeight = await lineHeightPixels(previousCloseLabel);
  expect(labelHeight).toBeLessThan(1.5 * labelLineHeight);
  expectNoErrors(collected);
});

test('in a narrow window the dialog fits, with its tabs above the panel and no sideways scroll', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const collected = await gotoWithStub(page);
  await openChart(page);
  const overflowBefore = await horizontalOverflow(page);

  await openSettingsFromMenu(page);
  const dialog = chartSettingsDialog(page);
  // The entrance animation moves the panel, so the boxes below are read only once the dialog has settled.
  await waitForDialogSettled(dialog);
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(NARROW_VIEWPORT.width);
  expect(await horizontalOverflow(page)).toBe(overflowBefore);

  const tabs = (await dialog.getByRole('tablist').boundingBox())!;
  const panel = (await dialog.getByRole('tabpanel').boundingBox())!;
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(panel.y + 1);
  expectNoErrors(collected);
});
