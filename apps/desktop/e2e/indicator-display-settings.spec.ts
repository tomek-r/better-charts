import { expect, test, type Locator, type Page } from '@playwright/test';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import { indicatorLegendRow, openSmaSettings } from './helpers/indicatorSettingsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { latestSavedIndicators } from './helpers/savedIndicators';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * The display switches every indicator's Style tab ends with: the labels on the price scale, the plot
 * values of the legend row, and the inputs the row writes after the short title.
 */

const SECTION_SELECTOR = '.drawing-settings-style-section';
const STYLE_ROW_SELECTOR = '.drawing-settings-style-row';
const SWITCH_TITLE_SELECTOR = 'label.drawing-settings-style-title';
const TITLE_SELECTOR = '.chart-indicator-legend-title';
const STYLE_TAB_LABEL = 'Style';
const OK_BUTTON_LABEL = 'OK';
const OUTPUT_VALUES = 'Output values';
const INPUT_VALUES = 'Input values';

/** The three switches, in the order the Style tab lists them. */
const LABELS_ON_PRICE_SCALE = 'Labels on price scale';
const VALUES_IN_STATUS_LINE = 'Values in status line';
const INPUTS_IN_STATUS_LINE = 'Inputs in status line';

/** Each of those switches with whether it starts on: only the price labels start off. */
const DISPLAY_SWITCHES = [
  { name: LABELS_ON_PRICE_SCALE, on: false },
  { name: VALUES_IN_STATUS_LINE, on: true },
  { name: INPUTS_IN_STATUS_LINE, on: true },
] as const;

/** How far a switch title's width may sit from the width of its row, in pixels. */
const MAX_TITLE_WIDTH_GAP_PX = 1;

/** The words the SMA goes by with its inputs shown and without them. */
const SMA_WORDS = 'SMA 9 close';
const SMA_SHORT_TITLE = 'SMA';

/** The stored key of the inputs switch. */
const INPUTS_SWITCH_KEY = settingStyleKey('inputsInStatusLine', 'visible');

/** The Style tab of `dialog`. */
function styleTab(dialog: Locator): Locator {
  return dialog.getByRole('tabpanel');
}

/** Whether the first plot of the first drawn indicator writes its last value on the price scale. */
function priceLabelVisible(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => window.__chartTest!.indicators()[0]?.plots[0]?.priceLabelVisible);
}

/** The `inputsInStatusLine.visible` of the saved moving average, as the chart's settings keep it. */
async function savedInputsSwitch(page: Page): Promise<boolean | undefined> {
  const saved = readSavedIndicators(await latestSavedIndicators(page));
  const stored = saved?.[0]?.settings[INPUTS_SWITCH_KEY];
  return typeof stored === 'boolean' ? stored : undefined;
}

/** Attaches the moving average, opens its settings from the legend row and switches to its Style tab. */
async function openStyleTab(page: Page): Promise<Locator> {
  const dialog = await openSmaSettings(page);
  await dialog.getByRole('tab', { name: STYLE_TAB_LABEL }).click();
  return dialog;
}

/** Clicks one display switch of the open dialog, on or off, and saves it. */
async function clickSwitchAndSave(dialog: Locator, switchName: string): Promise<void> {
  await styleTab(dialog).getByRole('checkbox', { name: switchName }).click();
  await dialog.getByRole('button', { name: OK_BUTTON_LABEL, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('indicator display settings', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
  });

  test('the Style tab ends with the three display switches under their captions', async ({ page }) => {
    const tab = styleTab(await openStyleTab(page));

    await expect(tab.locator(SECTION_SELECTOR)).toHaveText([OUTPUT_VALUES, INPUT_VALUES]);

    const checkboxes = tab.getByRole('checkbox');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThanOrEqual(DISPLAY_SWITCHES.length);
    for (const [index, { name, on }] of DISPLAY_SWITCHES.entries()) {
      const checkbox = checkboxes.nth(count - DISPLAY_SWITCHES.length + index);
      await expect(checkbox).toHaveAccessibleName(name);
      await expect(checkbox).toBeChecked({ checked: on });
    }
  });

  test('the plot writes no price label until Labels on price scale is ticked', async ({ page }) => {
    const dialog = await openStyleTab(page);
    await expect.poll(() => priceLabelVisible(page)).toBe(false);

    await clickSwitchAndSave(dialog, LABELS_ON_PRICE_SCALE);

    await expect.poll(() => priceLabelVisible(page)).toBe(true);
  });

  test('the Labels on price scale title fills its row instead of wrapping', async ({ page }) => {
    const tab = styleTab(await openStyleTab(page));

    const row = tab.locator(STYLE_ROW_SELECTOR).filter({ hasText: LABELS_ON_PRICE_SCALE });
    await expect(row).toHaveCount(1);
    const title = row.locator(SWITCH_TITLE_SELECTOR);
    const rowBox = await row.boundingBox();
    const titleBox = await title.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(titleBox).not.toBeNull();

    expect(Math.abs(titleBox!.width - rowBox!.width)).toBeLessThanOrEqual(MAX_TITLE_WIDTH_GAP_PX);
  });

  test('unticking Values in status line leaves the legend row its words only', async ({ page }) => {
    const dialog = await openStyleTab(page);

    await clickSwitchAndSave(dialog, VALUES_IN_STATUS_LINE);

    await expect(indicatorLegendRow(page)).toHaveText(SMA_WORDS);
  });

  test('unticking Inputs in status line shortens the row and is saved', async ({ page }) => {
    const dialog = await openStyleTab(page);

    await clickSwitchAndSave(dialog, INPUTS_IN_STATUS_LINE);

    await expect(indicatorLegendRow(page).locator(TITLE_SELECTOR)).toHaveText(SMA_SHORT_TITLE);
    await expect.poll(() => savedInputsSwitch(page)).toBe(false);
  });
});
