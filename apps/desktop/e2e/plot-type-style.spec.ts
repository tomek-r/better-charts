import { expect, test, type Locator, type Page } from '@playwright/test';
import type { IndicatorPlotState } from '../src/features/chart/engine/indicators/indicatorPlotSeries';
import {
  defaultSettingStyleValues,
  resolveSettingStyleValues,
  settingStyleKey,
} from '../src/features/chart/engine/settings/settingStyles';
import { PLOT_TYPES, plotTypeStyle } from '../src/features/indicators/plotTypes';
import { drawnIndicators } from './helpers/indicatorFrames';
import { failOnPageNoise } from './helpers/pageNoise';
import { openWithSavedIndicators } from './helpers/savedIndicators';

/**
 * The Plot type row of an indicator's Style tab: one icon button opening a menu that holds the Price line
 * switch and the eleven ways to draw the plot. Escape and a press elsewhere close the menu alone, so the
 * settings dialog under it stays open.
 */

/** The style the unit cases resolve, and the keys it stores. */
const PLOT_TYPE_ID = 'plotTypeId';
const PRICE_LINE_ID = 'priceLineId';
const DEFAULT_TYPE = 'columns';
const UNKNOWN_TYPE = 'sausages';

/** The style a plot type shares a row with, when it names one. */
const INLINE_ROW_ID = 'growingId';

const PLOT_TYPE_STYLE = plotTypeStyle(PLOT_TYPE_ID, { defaultType: DEFAULT_TYPE, priceLineId: PRICE_LINE_ID });
const PRICE_LINE_KEY = settingStyleKey(PRICE_LINE_ID, 'visible');
const STORED_DEFAULTS = { [PLOT_TYPE_ID]: DEFAULT_TYPE, [PRICE_LINE_KEY]: false };

/** The one indicator these cases attach, and the words its row and dialog go by. */
const VOLUME_ENTRY = { instanceId: 'volume-1', definitionId: 'volume', settings: {} };
const PANE_LEGEND_LABEL = 'Indicator pane legend';
const LEGEND_ROW_SELECTOR = '.chart-indicator-legend-row';
const SETTINGS_BUTTON_LABEL = 'Indicator settings';
const SETTINGS_DIALOG_NAME = 'Volume settings';
const STYLE_TAB_LABEL = 'Style';
const VOLUME_LABEL = 'Volume';
const CANCEL_LABEL = 'Cancel';

/** What the Style tab and its menu call the row and its switch, and the types these cases choose. */
const PLOT_TYPE_LABEL = 'Plot type';
const PRICE_LINE_LABEL = 'Price line';
const COLUMNS_LABEL = 'Columns';
const LINE_LABEL = 'Line';

/** The Style tab's rows and their titles, and the style whose row Volume draws the Plot type button on. */
const STYLE_ROW_SELECTOR = '.drawing-settings-style-row';
const STYLE_ROW_TITLE_SELECTOR = '.drawing-settings-style-title';
const GROWING_LABEL = 'Growing';

/** The names the menu lists, in order: the eleven types of the Plot type style. */
const PLOT_TYPE_NAMES = PLOT_TYPES.map((plotType) => plotType.title);

/** Every row of the open menu, the switch included, in the order it draws them. */
const MENU_ROW_SELECTOR = '[role="menuitemradio"], [role="menuitemcheckbox"]';

const CHECKED_TYPE_SELECTOR = '[role="menuitemradio"][aria-checked="true"]';

/** The legend row Volume writes in the pane of its own. */
function volumeLegendRow(page: Page): Locator {
  return page.getByLabel(PANE_LEGEND_LABEL, { exact: true }).locator(LEGEND_ROW_SELECTOR).first();
}

/** Attaches a saved Volume and opens its settings from its legend row, on the Style tab. */
async function openVolumeStyleTab(page: Page): Promise<Locator> {
  await openWithSavedIndicators(page, [VOLUME_ENTRY]);
  const row = volumeLegendRow(page);
  await row.hover();
  await row.getByRole('button', { name: SETTINGS_BUTTON_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: SETTINGS_DIALOG_NAME });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: STYLE_TAB_LABEL, exact: true }).click();
  return dialog;
}

/** The Style tab's Plot type button, which opens the menu. */
function plotTypeButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PLOT_TYPE_LABEL, exact: true });
}

/** The open menu, which is portalled out of the dialog's panel. */
function plotTypeMenu(page: Page): Locator {
  return page.getByRole('menu', { name: PLOT_TYPE_LABEL });
}

/** Opens the menu from the Plot type button and hands it back. */
async function openPlotTypeMenu(page: Page, dialog: Locator): Promise<Locator> {
  await plotTypeButton(dialog).click();
  const menu = plotTypeMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** The first plot of the drawn Volume, as the display layer reports it. */
async function volumePlot(page: Page): Promise<IndicatorPlotState | undefined> {
  const [volume] = await drawnIndicators(page);
  return volume?.plots[0];
}

/** The line type the layer draws the volume plot with. */
async function volumeLineType(page: Page): Promise<string | undefined> {
  return (await volumePlot(page))?.lineType;
}

test.describe('plot type style', () => {
  test('a plot type style resolves to its default type and the price line off', () => {
    expect(defaultSettingStyleValues([PLOT_TYPE_STYLE])).toEqual(STORED_DEFAULTS);
  });

  test('a stored type the list does not know resolves to the default', () => {
    const resolved = resolveSettingStyleValues([PLOT_TYPE_STYLE], { [PLOT_TYPE_ID]: UNKNOWN_TYPE });

    expect(resolved).toEqual(STORED_DEFAULTS);
  });

  test('a plot type style passes the row it shares through', () => {
    const style = plotTypeStyle(PLOT_TYPE_ID, {
      defaultType: DEFAULT_TYPE,
      priceLineId: PRICE_LINE_ID,
      inlineWithId: INLINE_ROW_ID,
    });

    expect(style.inlineWithId).toBe(INLINE_ROW_ID);
  });
});

test.describe('plot type menu', () => {
  failOnPageNoise();

  test('the Style tab shows the Plot type button, with no drop-down and no Price line checkbox', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    const tab = dialog.getByRole('tabpanel');

    await expect(plotTypeButton(dialog)).toBeVisible();
    await expect(tab.getByRole('combobox', { name: PLOT_TYPE_LABEL })).toHaveCount(0);
    await expect(tab.getByRole('checkbox', { name: PRICE_LINE_LABEL })).toHaveCount(0);
  });

  test('the Plot type button sits on the Growing row, beside its colour', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    const growingRow = dialog.locator(STYLE_ROW_SELECTOR).filter({ hasText: GROWING_LABEL });

    await expect(growingRow).toHaveCount(1);
    await expect(growingRow.locator('.color-trigger')).toHaveCount(1);
    await expect(growingRow.getByRole('button', { name: PLOT_TYPE_LABEL, exact: true })).toBeVisible();
  });

  test('the Style tab draws no Plot type row of its own', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);

    await expect(dialog.locator(STYLE_ROW_TITLE_SELECTOR).getByText(PLOT_TYPE_LABEL)).toHaveCount(0);
  });

  test('the menu lists the Price line switch above the eleven types, with Columns checked', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    const menu = await openPlotTypeMenu(page, dialog);

    await expect(menu.locator(MENU_ROW_SELECTOR)).toHaveText([PRICE_LINE_LABEL, ...PLOT_TYPE_NAMES]);
    await expect(menu.getByRole('menuitemcheckbox')).toHaveAccessibleName(PRICE_LINE_LABEL);
    await expect(menu.locator(CHECKED_TYPE_SELECTOR)).toHaveText([COLUMNS_LABEL]);
  });

  test('choosing Line closes the menu, focuses the button and previews the line', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    const menu = await openPlotTypeMenu(page, dialog);

    await menu.getByRole('menuitemradio', { name: LINE_LABEL, exact: true }).click();

    await expect(plotTypeMenu(page)).toHaveCount(0);
    await expect(plotTypeButton(dialog)).toBeFocused();
    await expect.poll(() => volumeLineType(page)).toBe('simple');
  });

  test('the Price line switch keeps the menu open and previews the line at the last value', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    const menu = await openPlotTypeMenu(page, dialog);

    await menu.getByRole('menuitemcheckbox', { name: PRICE_LINE_LABEL }).click();

    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await volumePlot(page))?.priceLineVisible).toBe(true);
  });

  test('Escape closes the menu and leaves the settings dialog open', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    await openPlotTypeMenu(page, dialog);

    await page.keyboard.press('Escape');

    await expect(plotTypeMenu(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('a press on the dialog panel closes the menu and leaves the dialog open', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    await openPlotTypeMenu(page, dialog);

    await dialog.getByRole('heading', { name: SETTINGS_DIALOG_NAME }).click();

    await expect(plotTypeMenu(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('Cancel puts the stored plot type back', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);
    const menu = await openPlotTypeMenu(page, dialog);
    await menu.getByRole('menuitemradio', { name: LINE_LABEL, exact: true }).click();
    await expect.poll(() => volumeLineType(page)).toBe('simple');

    await dialog.getByRole('button', { name: CANCEL_LABEL, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => volumeLineType(page)).toBe('histogram');
  });

  test('unticking Volume disables the Plot type button', async ({ page }) => {
    const dialog = await openVolumeStyleTab(page);

    await dialog.getByRole('tabpanel').getByRole('checkbox', { name: VOLUME_LABEL, exact: true }).click();

    await expect(plotTypeButton(dialog)).toBeDisabled();
  });
});
