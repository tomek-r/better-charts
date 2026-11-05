import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  readSavedIndicators,
  sameSavedIndicators,
  type SavedIndicator,
} from '../src/features/chart/chartSettings/savedIndicators';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { attachSma, attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { openWithSavedIndicators } from './helpers/savedIndicators';
import { gotoWithStub } from './helpers/tauriStub';

const INDICATOR_LEGEND_LABEL = 'Indicator legend';
const ROW_SELECTOR = '.chart-indicator-legend-row';
const HIDDEN_ROW_SELECTOR = '.chart-indicator-legend-row[data-hidden=true]';
/** The eye-off icon a hidden row used to show in front of its name; this selector now asserts its absence. */
const HIDDEN_ICON_SELECTOR = '.chart-indicator-legend-hidden-icon';
const SHORT_SMA_LENGTH = 3;

/** One saved indicator with the hidden flag on and the same one without any hidden flag. */
const HIDDEN_SAVED_INDICATOR: SavedIndicator = { instanceId: 'a', definitionId: 'sma', settings: {}, hidden: true };
const SHOWN_SAVED_INDICATOR: SavedIndicator = { instanceId: 'a', definitionId: 'sma', settings: {} };

function legend(page: Page): Locator {
  return page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true });
}

/** The legend's first row, which is the one attached indicator's row. */
function firstLegendRow(page: Page): Locator {
  return legend(page).locator(ROW_SELECTOR).first();
}

/** The legend rows that say their indicator is hidden. */
function hiddenLegendRows(page: Page): Locator {
  return legend(page).locator(HIDDEN_ROW_SELECTOR);
}

/** The hidden flag the dev hook reports for the first indicator the layer holds. */
function layerHidden(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => window.__chartTest!.indicators()[0]?.hidden);
}

/** The id of the one attached indicator, once the chart has attached it. */
async function attachedInstanceId(page: Page): Promise<string> {
  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
  const [attached] = await attachedIndicators(page);
  if (attached === undefined) {
    throw new Error('No indicator is attached to the chart.');
  }
  return attached.instanceId;
}

/** Hides or shows an attached indicator through the dev hook, which the Object tree button will drive. */
function setIndicatorHidden(
  page: Page,
  change: { readonly instanceId: string; readonly hidden: boolean },
): Promise<void> {
  return page.evaluate(({ instanceId, hidden }) => window.__chartTest!.setIndicatorHidden(instanceId, hidden), change);
}

/** Reloads an attached indicator from new settings through the dev hook. */
function setIndicatorSettings(
  page: Page,
  change: { readonly instanceId: string; readonly settings: SettingValues },
): Promise<void> {
  return page.evaluate(
    ({ instanceId, settings }) => window.__chartTest!.setIndicatorSettings(instanceId, settings),
    change,
  );
}

/** Opens the stub chart, attaches an SMA through the dialog and answers its instance id. */
async function openChartWithSma(page: Page): Promise<string> {
  await gotoWithStub(page);
  await openChart(page);
  await attachSma(page);
  return attachedInstanceId(page);
}

test.describe('hidden indicators', () => {
  failOnPageNoise();

  test('a saved hidden indicator is attached but draws no line and dims its legend row without an icon in front of its name', async ({
    page,
  }) => {
    await openWithSavedIndicators(page, [{ instanceId: 'hidden-1', definitionId: 'sma', settings: {}, hidden: true }]);

    await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(true);
    await expect.poll(() => layerHidden(page)).toBe(true);
    await expect(firstLegendRow(page)).toHaveAttribute('data-hidden', 'true');
    await expect(firstLegendRow(page).locator(HIDDEN_ICON_SELECTOR)).toHaveCount(0);
  });

  test('hiding and showing an attached indicator toggles its line and its row', async ({ page }) => {
    const instanceId = await openChartWithSma(page);

    await setIndicatorHidden(page, { instanceId, hidden: true });

    await expect.poll(() => layerHidden(page)).toBe(true);
    await expect(hiddenLegendRows(page)).toHaveCount(1);

    await setIndicatorHidden(page, { instanceId, hidden: false });

    await expect.poll(() => layerHidden(page)).toBe(false);
    await expect(hiddenLegendRows(page)).toHaveCount(0);
  });

  test('a hidden indicator stays hidden when it reloads with new settings', async ({ page }) => {
    const instanceId = await openChartWithSma(page);
    await setIndicatorHidden(page, { instanceId, hidden: true });
    await expect.poll(() => layerHidden(page)).toBe(true);

    await setIndicatorSettings(page, { instanceId, settings: { length: SHORT_SMA_LENGTH } });

    await expect.poll(async () => (await attachedIndicators(page))[0]?.settings.length).toBe(SHORT_SMA_LENGTH);
    const [reloadedIndicator] = await attachedIndicators(page);
    expect(reloadedIndicator?.hidden).toBe(true);
    await expect.poll(() => layerHidden(page)).toBe(true);
  });
});

test('readSavedIndicators keeps hidden only when it is exactly true', () => {
  expect(
    readSavedIndicators([
      { instanceId: 'a', definitionId: 'sma', settings: {}, hidden: true },
      { instanceId: 'b', definitionId: 'sma', settings: {}, hidden: 'yes' },
      { instanceId: 'c', definitionId: 'sma', settings: {}, hidden: false },
    ]),
  ).toEqual([
    { instanceId: 'a', definitionId: 'sma', settings: {}, hidden: true },
    { instanceId: 'b', definitionId: 'sma', settings: {} },
    { instanceId: 'c', definitionId: 'sma', settings: {} },
  ]);
});

test('sameSavedIndicators tells a shown indicator from a hidden one', () => {
  expect(sameSavedIndicators([SHOWN_SAVED_INDICATOR], [HIDDEN_SAVED_INDICATOR])).toBe(false);
  expect(sameSavedIndicators([HIDDEN_SAVED_INDICATOR], [HIDDEN_SAVED_INDICATOR])).toBe(true);
});
