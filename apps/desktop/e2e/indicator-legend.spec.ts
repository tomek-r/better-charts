import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { rsiPlugin } from '../src/features/indicators/rsi/rsiPlugin';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import { palette } from '../src/shared/theme/palette';
import { OBJECT_SETTINGS_ICON_PATHS } from '../src/shared/ui/icons/objectSettingsIcon';
import { CHART_HOST_SELECTOR, RESIZE_HANDLE_SELECTOR, paneSeparatorCenter } from './helpers/chartHost';
import { openChartSettingsTab } from './helpers/chartSettingsDialog';
import { attachedIndicators, attachSma } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { parseHexColor } from './helpers/pngPixels';
import { EURUSD_CHART, openWithSavedIndicators } from './helpers/savedIndicators';
import { savedOverrides } from './helpers/savedOverrides';
import { gotoWithStub } from './helpers/tauriStub';

const INDICATOR_LEGEND_LABEL = 'Indicator legend';
const CANDLE_LEGEND_LABEL = 'Candle OHLC';
const COLLAPSE_BUTTON = 'Collapse indicator legend';
const EXPAND_BUTTON = 'Expand indicator legend';
const ROW_SELECTOR = '.chart-indicator-legend-row';
const SMA_ROW_TEXT = 'SMA 9 close';
const NO_VALUE_TEXT = '∅';
const SMA_ROW_COUNT = '1';
const SECONDS_TO_MS = 1000;
const CLOSE_PRICE_PATTERN = /C \d+\.(\d+)/;
const HIDE_BUTTON_LABEL = 'Hide indicator';
const SHOW_BUTTON_LABEL = 'Show indicator';
const SETTINGS_BUTTON_LABEL = 'Indicator settings';
const REMOVE_BUTTON_LABEL = 'Remove indicator';
const TITLE_SELECTOR = '.chart-indicator-legend-title';
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
const PRICE_SCALE_MIN_WIDTH = 70;
const TRANSPARENT_COLOR = 'rgba(0, 0, 0, 0)';
/** The white a row's action icons are drawn in, whatever the row's text colour is. */
const WHITE_ICON_COLOR = rgbOf(palette.textBright);
/** The app's own hover band on that separator, drawn over the pane's width instead. */
const SEPARATOR_BAND_SELECTOR = '.chart-pane-separator-band';
/** The label of the stored checkbox the Status line tab draws no row for. */
const INDICATOR_LEGEND_COLLAPSED_LABEL = 'Indicator legend collapsed';
/** A saved SMA that starts hidden, so its row shows the eye-off button from the first paint. */
const HIDDEN_SMA_ENTRY = { instanceId: 'sma-1', definitionId: 'sma', settings: {}, hidden: true };
/** A saved SMA a collapsed legend counts. */
const SMA_ENTRY = { instanceId: 'sma-1', definitionId: 'sma', settings: {} };

/** A palette hex colour written the way `toHaveCSS` reports a computed colour. */
function rgbOf(hex: string): string {
  const [red, green, blue] = parseHexColor(hex);
  return `rgb(${red}, ${green}, ${blue})`;
}

/** The legend an indicator holding a pane of its own shows its row in. */
function paneLegend(page: Page): Locator {
  return page.getByLabel(PANE_LEGEND_LABEL, { exact: true });
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
    const firstBarX = await page.evaluate(
      (timeMs) => window.__chartTest!.timeToX(timeMs),
      firstBarSeconds * SECONDS_TO_MS,
    );

    await page.mouse.move(hostBox.x + firstBarX, hostBox.y + hostBox.height / 2);
    await expect(rows.first()).toHaveText(`${SMA_ROW_TEXT} ${NO_VALUE_TEXT}`);

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

test('indicatorLegendTitle words a known indicator with its input values', () => {
  const settings = resolveSettingValues(smaPlugin, { length: 20 });

  expect(indicatorLegendTitle('sma', settings)).toBe('SMA 20 close');
});

test('indicatorLegendTitle reads an unregistered definition as its id', () => {
  expect(indicatorLegendTitle('unknown-indicator', {})).toBe('unknown-indicator');
});
