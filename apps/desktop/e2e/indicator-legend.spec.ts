import { expect, test, type Locator, type Page } from '@playwright/test';
import { indicatorSettingsSchema } from '../src/features/chart/engine/indicators/indicatorDisplaySettings';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { withCalculation } from '../src/features/indicators/calculation/withCalculation';
import { indicatorLegendTitle, indicatorLegendWords } from '../src/features/indicators/indicatorLegendTitle';
import {
  INDICATOR_ACTION_LABELS,
  OWN_PANE_VISUAL_ORDER_TITLE,
  REMOVE_SHORTCUT_HINT,
} from '../src/features/indicators/indicatorActionsMenu/indicatorActionsMenuLabels';
import { visualOrderTargets } from '../src/features/indicators/indicatorActionsMenu/indicatorVisualOrder';
import { rsiPlugin } from '../src/features/indicators/rsi/rsiPlugin';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import { palette } from '../src/shared/theme/palette';
import { OBJECT_SETTINGS_ICON_PATHS } from '../src/shared/ui/icons/objectSettingsIcon';
import { CHART_HOST_SELECTOR, RESIZE_HANDLE_SELECTOR, paneSeparatorCenter } from './helpers/chartHost';
import { openChartSettingsTab } from './helpers/chartSettingsDialog';
import { rgbText } from './helpers/cssColor';
import {
  actionsMenuRow,
  indicatorActionsMenu,
  legendMoreButton,
  openLegendActionsMenu,
  openVisualOrderSubmenu,
  pickVisualOrder,
  removeRow,
} from './helpers/indicatorActionsMenu';
import { legendRowNamed, smaSettingsDialog } from './helpers/indicatorObjectTree';
import { expectPaintedOnTop, savedIndicatorOrder } from './helpers/indicatorOrder';
import { attachedIndicators, attachSma } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { EURUSD_CHART, openWithSavedIndicators } from './helpers/savedIndicators';
import { savedOverrides } from './helpers/savedOverrides';
import { gotoWithStub } from './helpers/tauriStub';

const INDICATOR_LEGEND_LABEL = 'Indicator legend';
const CANDLE_LEGEND_LABEL = 'Candle OHLC';
const COLLAPSE_BUTTON = 'Collapse indicator legend';
const EXPAND_BUTTON = 'Expand indicator legend';
const ROW_SELECTOR = '.chart-indicator-legend-row';
const SMA_SHORT_TITLE = 'SMA';
const SMA_INPUTS = '9 close';
const SMA_ROW_TEXT = `${SMA_SHORT_TITLE} ${SMA_INPUTS}`;
const NO_VALUE_TEXT = '∅';
const SMA_ROW_COUNT = '1';
const SECONDS_TO_MS = 1000;
const CLOSE_PRICE_PATTERN = /C \d+\.(\d+)/;
const HIDE_BUTTON_LABEL = 'Hide indicator';
const SHOW_BUTTON_LABEL = 'Show indicator';
const SETTINGS_BUTTON_LABEL = 'Indicator settings';
const REMOVE_BUTTON_LABEL = 'Remove indicator';
const TITLE_SELECTOR = '.chart-indicator-legend-title';
const INPUTS_SELECTOR = '.chart-indicator-legend-inputs';
const ACTIONS_SELECTOR = '.chart-indicator-legend-actions';
const HIDDEN_ATTRIBUTE = 'data-hidden';
const ACTION_ICON_SIZE = '16x16';
const OHLC_FONT_SIZE = '13px';
const INDICATOR_FONT_SIZE = '12px';
const HIDDEN_WORDS_OPACITY = '0.5';
const PANE_LEGEND_LABEL = 'Indicator pane legend';
const SMA_SETTINGS_DIALOG = 'Moving Average Simple settings';
const RSI_SETTINGS_DIALOG = 'Relative Strength Index settings';
const RSI_DEFINITION_ID = 'rsi';
const RSI_INSTANCE_ID = 'rsi-1';
const RSI_SHORT_TITLE = 'RSI';
const RSI_INPUTS = '14 close';
/** A calculation timeframe the SMA can be calculated on, and the word the legend writes it with. */
const HIGHER_TIMEFRAME = 'H1';
const HIGHER_TIMEFRAME_LABEL = '1H';
const PRICE_SCALE_MIN_WIDTH = 70;
const TRANSPARENT_COLOR = 'rgba(0, 0, 0, 0)';
/** The white a row's action icons are drawn in, whatever the row's text colour is. */
const WHITE_ICON_COLOR = rgbText(palette.textBright);
/** A row's short title takes the legend's text colour, and the inputs after it the muted one. */
const TITLE_COLOR = rgbText(palette.textLabel);
/** The app's own hover band on that separator, drawn over the pane's width instead. */
const SEPARATOR_BAND_SELECTOR = '.chart-pane-separator-band';
/** The label of the stored checkbox the Status line tab draws no row for. */
const INDICATOR_LEGEND_COLLAPSED_LABEL = 'Indicator legend collapsed';
/** A saved SMA that starts hidden, so its row shows the eye-off button from the first paint. */
const HIDDEN_SMA_ENTRY = { instanceId: 'sma-1', definitionId: 'sma', settings: {}, hidden: true };
/** A saved SMA a collapsed legend counts. */
const SMA_ENTRY = { instanceId: 'sma-1', definitionId: 'sma', settings: {} };
/** A second price-pane indicator, so that one of them can move in front of or behind the other. */
const EMA_ENTRY = { instanceId: 'ema-1', definitionId: 'ema', settings: {} };
const SMA_INSTANCE_ID = 'sma-1';
const EMA_INSTANCE_ID = 'ema-1';
const EMA_9_CLOSE = 'EMA 9 close';
/** A third price-pane indicator, so one of them has a plot on either side of it in the paint order. */
const BOLLINGER_ENTRY = { instanceId: 'bb-1', definitionId: 'bb', settings: {} };
const BOLLINGER_INSTANCE_ID = 'bb-1';
/** A saved indicator with a pane of its own, which has no paint order among the price pane's plots. */
const RSI_ENTRY = { instanceId: RSI_INSTANCE_ID, definitionId: RSI_DEFINITION_ID, settings: {} };
/** The tab the indicator's Visibility settings live on. */
const VISIBILITY_TAB = 'Visibility';
/** The words of a menu row, which stand to the right of its icon's column. */
const MENU_ROW_LABEL_SELECTOR = '.chart-context-menu-label';
/** The column a menu row's command icon sits in, which a row without one leaves empty. */
const MENU_ICON_SLOT_SELECTOR = '.indicator-actions-menu-icon';
/** The shortcut a menu row names at its far end, in the muted colour of the menus' hints. */
const MENU_SHORTCUT_SELECTOR = 'kbd';
const MUTED_TEXT_COLOR = rgbText(palette.muted);
const OBJECT_TREE_DRAWER_SELECTOR = 'aside[aria-label="Object tree"]';
/** The paint-order commands, in the order the submenu offers them. */
const VISUAL_ORDER_COMMAND_LABELS = [
  INDICATOR_ACTION_LABELS.bringToFront,
  INDICATOR_ACTION_LABELS.sendToBack,
  INDICATOR_ACTION_LABELS.bringForward,
  INDICATOR_ACTION_LABELS.sendBackward,
];

/** The legend an indicator holding a pane of its own shows its row in. */
function paneLegend(page: Page): Locator {
  return page.getByLabel(PANE_LEGEND_LABEL, { exact: true });
}

/** Asserts the row writes its words as runs: the short title in the legend's colour, its inputs muted. */
async function expectWordsSplit(row: Locator, shortTitle: string, inputs: string): Promise<void> {
  const title = row.locator(TITLE_SELECTOR);
  const inputsRun = row.locator(INPUTS_SELECTOR);
  await expect(title).toHaveText(shortTitle);
  await expect(inputsRun).toHaveText(inputs);
  await expect(title).toHaveCSS('color', TITLE_COLOR);
  await expect(inputsRun).toHaveCSS('color', MUTED_TEXT_COLOR);
}

/** The price decimals the chart prints, read from the OHLC legend's own close price. */
async function priceDecimals(page: Page): Promise<number> {
  const ohlcText = (await page.getByLabel(CANDLE_LEGEND_LABEL).textContent()) ?? '';
  const fraction = CLOSE_PRICE_PATTERN.exec(ohlcText)?.[1];
  if (fraction === undefined) {
    throw new Error(`The OHLC legend shows no close price: ${ohlcText}`);
  }
  return fraction.length;
}

/** The newest value the attached SMA plots, or null while its layer holds none. */
function plottedSmaValue(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const point = window.__chartTest!.indicators()[0]?.plots[0]?.points.at(-1);
    return point === undefined ? null : point.value;
  });
}

async function attachedSmaValue(page: Page): Promise<number> {
  await expect.poll(() => plottedSmaValue(page)).not.toBeNull();
  const value = await plottedSmaValue(page);
  if (value === null) {
    throw new Error('The attached SMA plots no value on the stub history.');
  }
  return value;
}

/** The status line group of the overrides the app saved last, read the way the e2e helpers read them. */
async function savedStatusLine(page: Page): Promise<unknown> {
  const latest = (await savedOverrides(page)).at(-1);
  if (typeof latest !== 'object' || latest === null) {
    return undefined;
  }
  return (latest as Readonly<Record<string, unknown>>).statusLine;
}

/** Opens the app with the legend collapsed as the chart's settings stored it, and one SMA row to count. */
async function openWithCollapsedLegend(page: Page): Promise<void> {
  const overrides = { statusLine: { indicatorLegendCollapsed: true }, indicators: [SMA_ENTRY] };
  await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: overrides } });
  await openChart(page);
}

/** Whether each of `rows` is greyed out, in the order the menu draws them; a row without the attribute reads null. */
function disabledStates(rows: Locator): Promise<Array<string | null>> {
  return rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-disabled')));
}

/** Waits for the open paint-order submenu to offer the four commands, in the reference's order. */
async function expectVisualOrderCommands(submenu: Locator): Promise<void> {
  await expect(submenu.locator(MENU_ROW_LABEL_SELECTOR)).toHaveText(VISUAL_ORDER_COMMAND_LABELS);
}

test.describe('indicator legend', () => {
  let legend: Locator;
  let rows: Locator;

  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
    legend = page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true });
    rows = legend.locator(ROW_SELECTOR);
  });

  test('the legend is hidden until an indicator is attached', async ({ page }) => {
    await expect(legend).toBeHidden();

    await attachSma(page);

    await expect(legend).toBeVisible();
    await expect(rows).toHaveCount(1);
  });

  test('an attached SMA shows its short title, inputs and last value', async ({ page }) => {
    await attachSma(page);
    // The dialog closes under the pointer; off the chart, the row reads the last bar.
    await page.mouse.move(0, 0);

    const digits = await priceDecimals(page);
    const value = await attachedSmaValue(page);

    await expect(rows.first()).toHaveText(`${SMA_ROW_TEXT} ${value.toFixed(digits)}`);
  });

  test('the row writes its short title in the text colour and its inputs muted', async ({ page }) => {
    await attachSma(page);
    // The dialog closes under the pointer; off the chart, the row reads the last bar.
    await page.mouse.move(0, 0);

    const row = rows.first();
    await expectWordsSplit(row, SMA_SHORT_TITLE, SMA_INPUTS);
    // The two runs read as one phrase, so the row still names the indicator the way the Object tree does.
    await expect(row).toContainText(SMA_ROW_TEXT);
  });

  test('the OHLC line is written at 13 px and the indicator rows at 12 px', async ({ page }) => {
    await attachSma(page);

    const ohlc = page.getByLabel(CANDLE_LEGEND_LABEL);
    await expect(ohlc).toHaveCSS('font-size', OHLC_FONT_SIZE);
    await expect(rows.first()).toHaveCSS('font-size', INDICATOR_FONT_SIZE);

    const ohlcBox = await ohlc.boundingBox();
    const rowBox = await rows.first().boundingBox();
    if (ohlcBox === null || rowBox === null) {
      throw new Error('The OHLC legend or the indicator legend row is not laid out.');
    }
    expect(rowBox.y).toBeGreaterThanOrEqual(ohlcBox.y + ohlcBox.height);
  });

  test('the row follows the crosshair and returns to the last bar when it leaves', async ({ page }) => {
    await attachSma(page);
    // The range the time zone spec pins: bar 0 sits in the pane, where SMA(9) has no value yet.
    await page.evaluate(() => window.__chartTest!.scrollToRange({ from: -2, to: 14 }));
    const hostBox = await page.locator(CHART_HOST_SELECTOR).boundingBox();
    if (hostBox === null) {
      throw new Error('The chart host is not laid out.');
    }
    const firstBarSeconds = await page.evaluate(() => window.__chartTest!.data()[0]!.time);
    // The bar's place is read again on every try: a move made while the scroll still settles misses the bar.
    await expect(async () => {
      const firstBarX = await page.evaluate(
        (timeMs) => window.__chartTest!.timeToX(timeMs),
        firstBarSeconds * SECONDS_TO_MS,
      );
      await page.mouse.move(hostBox.x + firstBarX, hostBox.y + hostBox.height / 2);
      await expect(rows.first()).toHaveText(`${SMA_ROW_TEXT} ${NO_VALUE_TEXT}`, { timeout: 1000 });
    }).toPass();

    await page.mouse.move(0, 0);
    await expect(rows.first()).not.toContainText(NO_VALUE_TEXT);
  });

  test('the chevron collapses the rows to a count and expands them again', async ({ page }) => {
    await attachSma(page);

    await legend.getByRole('button', { name: COLLAPSE_BUTTON }).click();
    await expect(rows.first()).toBeHidden();
    const expand = legend.getByRole('button', { name: EXPAND_BUTTON });
    await expect(expand).toHaveText(SMA_ROW_COUNT);
    await expect(expand).toHaveAttribute('aria-expanded', 'false');

    await expand.click();
    await expect(rows.first()).toBeVisible();
  });

  test('the chevron saves the collapsed legend with the chart settings', async ({ page }) => {
    await attachSma(page);

    await legend.getByRole('button', { name: COLLAPSE_BUTTON }).click();

    await expect.poll(() => savedStatusLine(page)).toEqual({ indicatorLegendCollapsed: true });
  });

  test('the Status line tab draws no row for the legend collapse', async ({ page }) => {
    const dialog = await openChartSettingsTab(page, 'Status line');

    await expect(dialog.getByRole('checkbox', { name: INDICATOR_LEGEND_COLLAPSED_LABEL })).toHaveCount(0);
  });

  test('a hovered row offers Hide and Show, which save the hidden flag and dim the row', async ({ page }) => {
    await attachSma(page);

    await rows.first().hover();
    await rows.first().getByRole('button', { name: HIDE_BUTTON_LABEL, exact: true }).click();
    await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(true);
    await expect(rows.first()).toHaveAttribute(HIDDEN_ATTRIBUTE, 'true');

    await rows.first().hover();
    await rows.first().getByRole('button', { name: SHOW_BUTTON_LABEL, exact: true }).click();
    await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(false);
  });

  test('the row buttons are white', async ({ page }) => {
    await attachSma(page);

    await rows.first().hover();
    await expect(rows.first().getByRole('button', { name: REMOVE_BUTTON_LABEL, exact: true })).toHaveCSS(
      'color',
      WHITE_ICON_COLOR,
    );
  });

  test('the row buttons draw their icons at one size, 16 px', async ({ page }) => {
    await attachSma(page);

    await rows.first().hover();
    const sizes = await Promise.all(
      [HIDE_BUTTON_LABEL, SETTINGS_BUTTON_LABEL, REMOVE_BUTTON_LABEL].map(async (name) => {
        const icon = rows.first().getByRole('button', { name, exact: true }).locator('svg');
        const box = await icon.boundingBox();
        if (box === null) {
          throw new Error(`The ${name} icon is not laid out.`);
        }
        return `${box.width}x${box.height}`;
      }),
    );
    expect(sizes).toEqual([ACTION_ICON_SIZE, ACTION_ICON_SIZE, ACTION_ICON_SIZE]);
  });

  test('the settings button draws the Object tree settings icon', async ({ page }) => {
    await attachSma(page);

    await rows.first().hover();
    const paths = rows.first().getByRole('button', { name: SETTINGS_BUTTON_LABEL, exact: true }).locator('path');
    const drawn = await paths.evaluateAll((elements) => elements.map((element) => element.getAttribute('d')));
    expect(drawn).toEqual([...OBJECT_SETTINGS_ICON_PATHS]);
  });

  test('the settings button and a double click on the title open the settings dialog', async ({ page }) => {
    await attachSma(page);
    const dialog = page.getByRole('dialog', { name: SMA_SETTINGS_DIALOG });

    await rows.first().hover();
    await rows.first().getByRole('button', { name: SETTINGS_BUTTON_LABEL, exact: true }).click();
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await rows.first().locator(TITLE_SELECTOR).dblclick();
    await expect(dialog).toBeVisible();
  });

  test('Remove detaches the indicator and empties the legend', async ({ page }) => {
    await attachSma(page);

    await rows.first().hover();
    await rows.first().getByRole('button', { name: REMOVE_BUTTON_LABEL, exact: true }).click();

    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(0);
    await expect(legend).toBeHidden();
  });

  test('hovering a row keeps its height, so the rows under it stay put', async ({ page }) => {
    await attachSma(page);
    // The dialog closes under the pointer; off the chart, the row shows no buttons.
    await page.mouse.move(0, 0);

    const before = await rows.first().boundingBox();
    await rows.first().hover();
    await expect(rows.first().getByRole('button', { name: REMOVE_BUTTON_LABEL, exact: true })).toBeVisible();
    const after = await rows.first().boundingBox();

    if (before === null || after === null) {
      throw new Error('The indicator legend row is not laid out.');
    }
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });
});

test.describe('hidden indicator legend row', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await openWithSavedIndicators(page, [HIDDEN_SMA_ENTRY]);
  });

  test('a hidden row shows its buttons without hovering, and only its words are dimmed', async ({ page }) => {
    const row = page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true }).locator(ROW_SELECTOR).first();

    await page.mouse.move(0, 0);

    await expect(row.getByRole('button', { name: SHOW_BUTTON_LABEL, exact: true })).toBeVisible();
    await expect(row.locator(ACTIONS_SELECTOR)).toHaveCSS('opacity', '1');
    await expect(row).toHaveCSS('opacity', '1');
    await expect(row.locator(TITLE_SELECTOR)).toHaveCSS('opacity', HIDDEN_WORDS_OPACITY);
  });
});

test.describe('own-pane indicator legend', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await openWithSavedIndicators(page, [
      { instanceId: RSI_INSTANCE_ID, definitionId: RSI_DEFINITION_ID, settings: {} },
    ]);
  });

  test('an RSI row sits in its own pane, not under the OHLC line', async ({ page }) => {
    await expect(page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true })).toBeHidden();

    const rows = paneLegend(page).locator(ROW_SELECTOR);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(
      indicatorLegendTitle(RSI_DEFINITION_ID, resolveSettingValues(rsiPlugin, {})),
    );
  });

  test("the RSI row's words are split the way the price pane's are", async ({ page }) => {
    await expectWordsSplit(paneLegend(page).locator(ROW_SELECTOR).first(), RSI_SHORT_TITLE, RSI_INPUTS);
  });

  test("the pane's top border stops at the price axis", async ({ page }) => {
    const overlay = paneLegend(page);
    await expect(overlay).toHaveCSS('border-top-width', '1px');
    await expect(overlay).toHaveCSS('border-top-style', 'solid');

    const overlayBox = await overlay.boundingBox();
    const hostBox = await page.locator(CHART_HOST_SELECTOR).boundingBox();
    if (overlayBox === null || hostBox === null) {
      throw new Error('The pane legend or the chart host is not laid out.');
    }
    expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width - PRICE_SCALE_MIN_WIDTH);
  });

  test("the RSI row's settings button opens its settings", async ({ page }) => {
    const row = paneLegend(page).locator(ROW_SELECTOR).first();

    await row.hover();
    await row.getByRole('button', { name: SETTINGS_BUTTON_LABEL, exact: true }).click();

    await expect(page.getByRole('dialog', { name: RSI_SETTINGS_DIALOG })).toBeVisible();
  });

  test('hovering the line between the panes paints a band over the pane only', async ({ page }) => {
    const handle = page.locator(RESIZE_HANDLE_SELECTOR);
    const centre = await paneSeparatorCenter(page);

    await page.mouse.move(centre.x, centre.y);

    await expect(handle).toHaveCSS('background-color', TRANSPARENT_COLOR);

    const band = page.locator(SEPARATOR_BAND_SELECTOR);
    await expect(band).toHaveCSS('opacity', '1');
    const bandBox = await band.boundingBox();
    const overlayBox = await paneLegend(page).boundingBox();
    const hostBox = await page.locator(CHART_HOST_SELECTOR).boundingBox();
    if (bandBox === null || overlayBox === null || hostBox === null) {
      throw new Error('The separator band, the pane legend or the chart host is not laid out.');
    }
    expect(bandBox.width).toBeCloseTo(overlayBox.width, 0);
    expect(bandBox.x + bandBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width - PRICE_SCALE_MIN_WIDTH);

    await page.mouse.move(0, 0);
    await expect(band).toHaveCSS('opacity', '0');
  });
});

test.describe('saved collapsed indicator legend', () => {
  failOnPageNoise();

  test('a legend saved collapsed opens collapsed', async ({ page }) => {
    await openWithCollapsedLegend(page);
    const legend = page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true });

    await expect(legend.locator(ROW_SELECTOR).first()).toBeHidden();
    await expect(legend.getByRole('button', { name: EXPAND_BUTTON })).toHaveText(SMA_ROW_COUNT);
  });

  test('expanding a legend saved collapsed saves that', async ({ page }) => {
    await openWithCollapsedLegend(page);
    const legend = page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true });
    const rows = legend.locator(ROW_SELECTOR);

    await legend.getByRole('button', { name: EXPAND_BUTTON }).click();

    await expect(rows.first()).toBeVisible();
    await expect.poll(async () => (await savedStatusLine(page)) ?? {}).not.toEqual({ indicatorLegendCollapsed: true });
  });
});

test.describe('indicator actions menu', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await openWithSavedIndicators(page, [SMA_ENTRY, EMA_ENTRY]);
  });

  test('the More button opens a menu with the indicator commands, in order', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));

    await expect(menu.getByRole('menuitem').locator(MENU_ROW_LABEL_SELECTOR)).toHaveText([
      INDICATOR_ACTION_LABELS.visualOrder,
      INDICATOR_ACTION_LABELS.visibilityOnIntervals,
      INDICATOR_ACTION_LABELS.hide,
      INDICATOR_ACTION_LABELS.remove,
      INDICATOR_ACTION_LABELS.objectTree,
      INDICATOR_ACTION_LABELS.settings,
    ]);
  });

  test('the command rows draw their icons, and every row starts its words at the same place', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    const rowsWithIcon = [
      actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visualOrder),
      actionsMenuRow(menu, INDICATOR_ACTION_LABELS.hide),
      removeRow(menu),
      actionsMenuRow(menu, INDICATOR_ACTION_LABELS.settings),
    ];
    const rowsWithoutIcon = [
      actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visibilityOnIntervals),
      actionsMenuRow(menu, INDICATOR_ACTION_LABELS.objectTree),
    ];

    for (const row of rowsWithIcon) {
      await expect(row.locator(`${MENU_ICON_SLOT_SELECTOR} svg`)).toHaveAttribute('aria-hidden', 'true');
    }
    for (const row of rowsWithoutIcon) {
      await expect(row.locator(`${MENU_ICON_SLOT_SELECTOR} svg`)).toHaveCount(0);
    }

    const labelLefts = await menu
      .locator(MENU_ROW_LABEL_SELECTOR)
      .evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().left));
    expect(new Set(labelLefts).size).toBe(1);
  });

  test('Remove names the key that removes the selected indicator', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    const shortcut = removeRow(menu).locator(MENU_SHORTCUT_SELECTOR);

    await expect(shortcut).toHaveText(REMOVE_SHORTCUT_HINT);
    await expect(shortcut).toHaveCSS('color', MUTED_TEXT_COLOR);
  });

  test('the Object tree row opens the Object tree drawer from its own section', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    const objectTreeRow = actionsMenuRow(menu, INDICATOR_ACTION_LABELS.objectTree);
    const separatedFromTheRowsAroundIt = await objectTreeRow.evaluate(
      (row) => row.previousElementSibling?.getAttribute('role') === 'separator',
    );
    expect(separatedFromTheRowsAroundIt).toBe(true);

    await objectTreeRow.click();

    const drawer = page.locator(OBJECT_TREE_DRAWER_SELECTOR);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: INDICATOR_ACTION_LABELS.objectTree })).toBeVisible();
    await expect(menu).toBeHidden();
  });

  test('Visual order greys out the commands that would leave the order as it is', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, EMA_9_CLOSE));
    const submenu = await openVisualOrderSubmenu(menu);
    await expectVisualOrderCommands(submenu);

    // The EMA is the last of the pane's two plots: it can move toward the front only.
    expect(await disabledStates(submenu.getByRole('menuitem'))).toEqual(['false', 'true', 'false', 'true']);
  });

  test('Bring to front saves the order and paints the indicator over the other one', async ({ page }) => {
    await expect.poll(() => savedIndicatorOrder(page)).toEqual([SMA_INSTANCE_ID, EMA_INSTANCE_ID]);

    await pickVisualOrder(page, EMA_9_CLOSE, INDICATOR_ACTION_LABELS.bringToFront);
    await expectPaintedOnTop(page, EMA_INSTANCE_ID, SMA_INSTANCE_ID);
  });

  test('Send to back saves the order and paints the other indicator over it', async ({ page }) => {
    await pickVisualOrder(page, SMA_ROW_TEXT, INDICATOR_ACTION_LABELS.sendToBack);
    await expectPaintedOnTop(page, EMA_INSTANCE_ID, SMA_INSTANCE_ID);
  });

  test('Visibility on intervals opens the settings dialog on its Visibility tab', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));

    await actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visibilityOnIntervals).click();

    const dialog = smaSettingsDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: VISIBILITY_TAB, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('Hide hides the indicator from the menu, and the menu then offers Show', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    await actionsMenuRow(menu, INDICATOR_ACTION_LABELS.hide).click();

    await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(true);
    await expect(indicatorActionsMenu(page)).toBeHidden();

    const reopened = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    await actionsMenuRow(reopened, INDICATOR_ACTION_LABELS.show).click();

    await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(false);
  });

  test('Remove detaches the indicator from the menu', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    await removeRow(menu).click();

    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
    await expect(page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true })).not.toContainText(SMA_ROW_TEXT);
  });

  test('Escape closes the menu and gives the focus back to the More button', async ({ page }) => {
    const row = legendRowNamed(page, SMA_ROW_TEXT);
    const menu = await openLegendActionsMenu(row);

    await page.keyboard.press('Escape');

    await expect(menu).toBeHidden();
    await expect(legendMoreButton(row)).toBeFocused();
  });

  test('a press outside the menu closes it', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));

    await page.locator(CHART_HOST_SELECTOR).click({ position: { x: 600, y: 120 } });

    await expect(menu).toBeHidden();
  });

  test('the arrow keys walk the menu rows', async ({ page }) => {
    const menu = await openLegendActionsMenu(legendRowNamed(page, SMA_ROW_TEXT));
    // The menu opens on its first row, and the keys move one row at a time, wrapping at the ends.
    await expect(actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visualOrder)).toBeFocused();

    await page.keyboard.press('ArrowDown');

    await expect(actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visibilityOnIntervals)).toBeFocused();
  });
});

test.describe('own-pane indicator actions menu', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await openWithSavedIndicators(page, [RSI_ENTRY]);
  });

  test('Visual order stays enabled while each of its commands is greyed out and says why', async ({ page }) => {
    const menu = await openLegendActionsMenu(paneLegend(page).locator(ROW_SELECTOR).first());
    const visualOrder = actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visualOrder);
    await expect(visualOrder).not.toHaveAttribute('aria-disabled', 'true');

    const submenu = await openVisualOrderSubmenu(menu);
    const commands = submenu.getByRole('menuitem');
    await expectVisualOrderCommands(submenu);
    expect(await disabledStates(commands)).toEqual(['true', 'true', 'true', 'true']);
    await expect(commands.first()).toHaveAttribute('title', OWN_PANE_VISUAL_ORDER_TITLE);

    // Playwright treats an aria-disabled row as unclickable, so the press is forced: it must still move nothing.
    await actionsMenuRow(submenu, INDICATOR_ACTION_LABELS.bringToFront).click({ force: true });
    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
  });
});

test('indicatorLegendTitle words a known indicator with its input values', () => {
  const settings = resolveSettingValues(smaPlugin, { length: 20 });

  expect(indicatorLegendTitle('sma', settings)).toBe('SMA 20 close');
});

test('indicatorLegendTitle reads an unregistered definition as its id', () => {
  expect(indicatorLegendTitle('unknown-indicator', {})).toBe('unknown-indicator');
});

test('indicatorLegendWords parts a known indicator into its short title and inputs', () => {
  const settings = resolveSettingValues(smaPlugin, { length: 20 });

  expect(indicatorLegendWords('sma', settings)).toEqual({ shortTitle: 'SMA', inputs: '20 close' });
});

test('indicatorLegendWords keeps the calculation timeframe with the inputs', () => {
  const settings = resolveSettingValues(indicatorSettingsSchema(withCalculation(smaPlugin)), {
    calculationTimeframe: HIGHER_TIMEFRAME,
  });

  expect(indicatorLegendWords('sma', settings)).toEqual({
    shortTitle: SMA_SHORT_TITLE,
    inputs: `${SMA_INPUTS} ${HIGHER_TIMEFRAME_LABEL}`,
  });
});

test('indicatorLegendWords gives an unregistered definition no inputs', () => {
  expect(indicatorLegendWords('unknown-indicator', {})).toEqual({ shortTitle: 'unknown-indicator', inputs: '' });
});

test('visualOrderTargets names the row each paint-order command moves to', () => {
  const saved = [EMA_ENTRY, SMA_ENTRY, BOLLINGER_ENTRY];

  expect(visualOrderTargets(saved, SMA_INSTANCE_ID)).toEqual({
    frontInstanceId: EMA_INSTANCE_ID,
    forwardInstanceId: EMA_INSTANCE_ID,
    backwardInstanceId: BOLLINGER_INSTANCE_ID,
    backInstanceId: BOLLINGER_INSTANCE_ID,
  });
});

test('visualOrderTargets leaves the commands that would not change the order with no row', () => {
  expect(visualOrderTargets([SMA_ENTRY, EMA_ENTRY], EMA_INSTANCE_ID)).toEqual({
    frontInstanceId: SMA_INSTANCE_ID,
    forwardInstanceId: SMA_INSTANCE_ID,
    backwardInstanceId: undefined,
    backInstanceId: undefined,
  });
});

test('visualOrderTargets gives an indicator with a pane of its own no paint order', () => {
  expect(visualOrderTargets([SMA_ENTRY, RSI_ENTRY], RSI_INSTANCE_ID)).toBeUndefined();
});
