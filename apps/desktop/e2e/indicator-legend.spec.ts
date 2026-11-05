import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import { attachSma } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
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
});

test('indicatorLegendTitle words a known indicator with its input values', () => {
  const settings = resolveSettingValues(smaPlugin, { length: 20 });

  expect(indicatorLegendTitle('sma', settings)).toBe('SMA 20 close');
});

test('indicatorLegendTitle reads an unregistered definition as its id', () => {
  expect(indicatorLegendTitle('unknown-indicator', {})).toBe('unknown-indicator');
});
