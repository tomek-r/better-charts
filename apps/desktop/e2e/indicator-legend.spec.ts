import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { rsiPlugin } from '../src/features/indicators/rsi/rsiPlugin';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import { attachedIndicators, attachSma } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { openWithSavedIndicators } from './helpers/savedIndicators';
import { gotoWithStub } from './helpers/tauriStub';

const INDICATOR_LEGEND_LABEL = 'Indicator legend';
const CANDLE_LEGEND_LABEL = 'Candle OHLC';
const COLLAPSE_BUTTON = 'Collapse indicator legend';
const EXPAND_BUTTON = 'Expand indicator legend';
const ROW_SELECTOR = '.chart-indicator-legend-row';
const CHART_HOST_SELECTOR = '.chart-host';
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
const HIDDEN_ATTRIBUTE = 'data-hidden';
const PANE_LEGEND_LABEL = 'Indicator pane legend';
const SMA_SETTINGS_DIALOG = 'Moving Average Simple settings';
const RSI_SETTINGS_DIALOG = 'Relative Strength Index settings';
const RSI_DEFINITION_ID = 'rsi';
const RSI_INSTANCE_ID = 'rsi-1';
const PRICE_SCALE_MIN_WIDTH = 70;
/** The library's resize handle on the pane separator; its full-window drag backdrop is the fixed one. */
const RESIZE_HANDLE_SELECTOR = '.chart-host td[colspan="3"] > div[style*="position: absolute"]';
const TRANSPARENT_COLOR = 'rgba(0, 0, 0, 0)';
/** The app's own hover band on that separator, drawn over the pane's width instead. */
const SEPARATOR_BAND_SELECTOR = '.chart-pane-separator-band';

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
    const box = await handle.boundingBox();
    if (box === null) {
      throw new Error('The pane separator has no resize handle.');
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

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

test('indicatorLegendTitle words a known indicator with its input values', () => {
  const settings = resolveSettingValues(smaPlugin, { length: 20 });

  expect(indicatorLegendTitle('sma', settings)).toBe('SMA 20 close');
});

test('indicatorLegendTitle reads an unregistered definition as its id', () => {
  expect(indicatorLegendTitle('unknown-indicator', {})).toBe('unknown-indicator');
});
