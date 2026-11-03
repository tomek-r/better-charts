import { expect, test, type Locator, type Page } from '@playwright/test';
import { openChartMenu } from './helpers/chartMenu';
import { chartSettingsDialog, openChartSettingsDialog, openChartSettingsTab } from './helpers/chartSettingsDialog';
import { expectUtcZoneSaved, lastSavedOverridesArgs, timeZoneButton, UTC_CLOCK } from './helpers/chartTimeZonePage';
import {
  chartScopeKey,
  expectNoErrors,
  gotoWithStub,
  STUB_CHART_ID,
  stubChartSettingOverrides,
  stubInvocations,
} from './helpers/tauriStub';
import { palette } from '../src/shared/theme/palette';

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
  const dialog = await openChartSettingsDialog(page);
  await waitForDialogSettled(dialog);
}

/** Waits for the bars, then opens the dialog from the chart menu and returns it. */
async function openSettingsDialog(page: Page): Promise<Locator> {
  await openChart(page);
  await openSettingsFromMenu(page);
  return chartSettingsDialog(page);
}

/** Waits for the bars, then opens the dialog on the Canvas tab, where the chart's own canvas is edited. */
async function openCanvasTab(page: Page): Promise<Locator> {
  await openChart(page);
  return openChartSettingsTab(page, 'Canvas');
}

/** Waits for the bars, then opens the dialog on the Scales and lines tab, where the scales are edited. */
async function openScalesTab(page: Page): Promise<Locator> {
  await openChart(page);
  return openChartSettingsTab(page, 'Scales and lines');
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

/** Clicks OK, waits for the dialog to go, and waits for the stub to hold exactly this chart's overrides. */
async function expectKeptOverrides(page: Page, dialog: Locator, overrides: Record<string, unknown>): Promise<void> {
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => stubChartSettingOverrides(page)).toEqual({ [EURUSD_CHART]: overrides });
}

test('the chart menu lists the view command, a separator and the settings, which open the dialog', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const menu = await openChartMenu(page);
  const rows = menu.getByRole('menuitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Reset chart view');
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await expect(rows.nth(1)).toHaveText('Settings');

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

  // The box is the corner cell the two axes make: it starts past the price axis' border line on the left
  // and below the time axis' border line on top, so its chip lines up with the axes instead of covering them.
  // The axes are re-measured with the width of the price labels, so they are read with the gear's box.
  const corner = await page.evaluate(() => {
    const gearElement = document.querySelector('.chart-settings-corner-button');
    const hostElement = document.querySelector('.chart-host');
    if (gearElement === null || hostElement === null) {
      throw new Error('the gear or the chart host is missing');
    }
    const gearRect = gearElement.getBoundingClientRect();
    const hostRect = hostElement.getBoundingClientRect();
    const scale = window.__chartTest!.priceScale();
    return {
      gear: { left: gearRect.left, top: gearRect.top },
      priceAxisLeft: hostRect.right - scale.axisWidth,
      timeAxisTop: hostRect.bottom - scale.timeAxisHeight,
    };
  });
  expect(corner.gear.left).toBeGreaterThanOrEqual(corner.priceAxisLeft + 1);
  expect(corner.gear.top).toBeGreaterThanOrEqual(corner.timeAxisTop + 1);

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

  const overrides = { barStyles: { candles: { colorByPreviousClose: true } } };
  await expectKeptOverrides(page, dialog, overrides);
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

test('the Canvas tab lists the chart canvas settings in its three groups', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  for (const heading of ['Chart basic styles', 'Scales', 'Margins']) {
    await expect(dialog.getByRole('heading', { name: heading })).toBeVisible();
  }
  for (const name of ['Vertical grid lines', 'Horizontal grid lines']) {
    await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeVisible();
  }
  for (const name of ['Top', 'Bottom', 'Right']) {
    await expect(dialog.getByRole('spinbutton', { name, exact: true })).toBeVisible();
  }
  for (const name of [
    'Background fill',
    'Background colour',
    'Vertical grid lines colour',
    'Horizontal grid lines colour',
    'Crosshair',
    'Text colour',
    'Text font size',
    'Lines',
  ]) {
    await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // A line's swatch is as wide as its face instead of filling the control column of its row.
  await waitForDialogSettled(dialog);
  const gridLineSwatch = dialog.getByRole('button', { name: 'Vertical grid lines colour', exact: true });
  expect((await gridLineSwatch.boundingBox())!.width).toBeLessThan(100);
  expectNoErrors(collected);
});

test('the Vertical grid lines colour picker offers line styles and no thickness', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  await dialog.getByRole('button', { name: 'Vertical grid lines colour', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Vertical grid lines colour options' });

  // The chart draws grid lines one pixel wide, so this line's picker has no thickness to offer.
  await expect(picker.getByRole('group', { name: 'Line style' })).toBeVisible();
  await expect(picker.getByText('Thickness')).toHaveCount(0);
  expectNoErrors(collected);
});

test('the Crosshair picker offers four thicknesses, and choosing one then OK stores the width', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  await dialog.getByRole('button', { name: 'Crosshair', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Crosshair options' });
  const thickness = picker.getByRole('group', { name: 'Thickness' });

  for (const width of [1, 2, 3, 4]) {
    await expect(thickness.getByRole('button', { name: `${width} px`, exact: true })).toBeVisible();
  }
  await expect(thickness.getByRole('button')).toHaveCount(4);
  await expect(picker.getByRole('group', { name: 'Line style' })).toBeVisible();

  await thickness.getByRole('button', { name: '2 px', exact: true }).click();
  await expect(thickness.getByRole('button', { name: '2 px', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Escape closes the picker alone; the dialog below it stays to be kept.
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);

  const crosshair = { color: palette.textLabel, style: 'solid', width: 2 };
  await expectKeptOverrides(page, dialog, { canvas: { crosshair } });
  expectNoErrors(collected);
});

test('unchecking the vertical grid lines then OK stores exactly that canvas override', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  await dialog.getByRole('checkbox', { name: 'Vertical grid lines', exact: true }).uncheck();
  const overrides = { canvas: { verticalGrid: { visible: false, color: palette.borderSubtle, style: 'solid' } } };
  await expectKeptOverrides(page, dialog, overrides);
  expectNoErrors(collected);
});

test('switching the background to a gradient shows the top and the bottom colour', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  await dialog.getByRole('button', { name: 'Background fill', exact: true }).click();
  await page.getByRole('option', { name: 'Gradient', exact: true }).click();

  await expect(dialog.getByRole('button', { name: 'Background top colour', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Background bottom colour', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Background colour', exact: true })).toHaveCount(0);
  expectNoErrors(collected);
});

test('typing 3 in the right margin then OK stores just that canvas override', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  await dialog.getByRole('spinbutton', { name: 'Right', exact: true }).fill('3');
  await expectKeptOverrides(page, dialog, { canvas: { rightMargin: 3 } });
  expectNoErrors(collected);
});

test('Cancel on the Canvas tab saves nothing', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openCanvasTab(page);

  await dialog.getByRole('checkbox', { name: 'Vertical grid lines', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  expect(await saveCount(page)).toBe(0);
  expectNoErrors(collected);
});

test('the tabs read Symbol, Scales and lines, Canvas in that order', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openSettingsDialog(page);

  await expect(dialog.getByRole('tab')).toHaveText(['Symbol', 'Scales and lines', 'Canvas']);
  expectNoErrors(collected);
});

test('the Scales and lines tab lists the price scale, its labels and lines, and the time scale', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openScalesTab(page);

  for (const heading of ['Price scale', 'Price labels & lines', 'Time scale']) {
    await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  for (const name of ['Countdown to bar close', 'Day of week on labels']) {
    await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeVisible();
  }
  for (const name of ['Scale modes (A and L)', 'Bid and ask display', 'Bid colour', 'Ask colour', 'Date format']) {
    await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(dialog.getByRole('button', { name: 'Time hours format', exact: true })).toBeVisible();
  expectNoErrors(collected);
});

test('unchecking the countdown then OK stores exactly that scales override', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openScalesTab(page);

  await dialog.getByRole('checkbox', { name: 'Countdown to bar close', exact: true }).uncheck();
  await expectKeptOverrides(page, dialog, { scales: { countdown: false } });
  expectNoErrors(collected);
});

test('choosing Hidden for Bid and ask then OK stores the mode with both colours', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openScalesTab(page);

  await dialog.getByRole('button', { name: 'Bid and ask display', exact: true }).click();
  await page.getByRole('option', { name: 'Hidden', exact: true }).click();
  const bidAsk = { mode: 'hidden', bid: palette.sell, ask: palette.buy };
  await expectKeptOverrides(page, dialog, { scales: { bidAsk } });
  expectNoErrors(collected);
});

test('Cancel on the Scales and lines tab puts the chart back without storing anything', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openScalesTab(page);

  await dialog.getByRole('checkbox', { name: 'Countdown to bar close', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // The dialog opens again on the countdown the chart kept, which the cancelled edit never reached.
  const reopened = await openScalesTab(page);
  await expect(reopened.getByRole('checkbox', { name: 'Countdown to bar close', exact: true })).toBeChecked();

  expect(await saveCount(page)).toBe(0);
  expectNoErrors(collected);
});
