import { expect, test, type Locator, type Page } from '@playwright/test';
import { openChart } from './helpers/openChart';
import { savedOverrides } from './helpers/savedOverrides';
import { chartScopeKey, expectNoErrors, gotoWithStub } from './helpers/tauriStub';

/**
 * The bar type picker in the chart header: the button beside the timeframes, the twelve bar types it lists in
 * their groups, and the choice it saves with the chart's settings. The chart is read back through the DEV test
 * hook and through what the backend stored.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bar type the chart draws until another one is chosen. */
const DEFAULT_LABEL = 'Candles';
/** Every bar type the menu lists, in the order of its groups. */
const BAR_TYPE_LABELS = [
  'Bars',
  'Candles',
  'Hollow candles',
  'Volume candles',
  'Line',
  'Line with markers',
  'Step line',
  'Area',
  'Baseline',
  'Columns',
  'High-low',
  'Heikin Ashi',
];
/** The separator between two of the menu's five groups. */
const GROUP_SEPARATOR_COUNT = 4;

/** The button beside the timeframes that names and opens the bar type menu. */
const barTypeTrigger = (page: Page) => page.getByRole('button', { name: 'Bar type', exact: true });

/** The menu the trigger opens. */
const barTypeMenu = (page: Page) => page.getByRole('menu', { name: 'Bar type' });

/** One row of the menu, found by the name it shows. */
const barTypeRow = (menu: Locator, label: string) => menu.getByRole('menuitemradio', { name: label, exact: true });

/** Opens the bar type menu and returns it. */
async function openBarTypeMenu(page: Page): Promise<Locator> {
  await barTypeTrigger(page).click();
  const menu = barTypeMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** The series the chart draws right now, as the engine reports it. */
async function drawnSeriesType(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__chartTest?.barStyle().seriesType ?? null);
}

/** Presses on the chart itself, away from the menu and from the button that opens it. */
async function pressOnChart(page: Page): Promise<void> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.click(host.x + host.width / 4, host.y + host.height / 2);
}

test('the trigger names the bar type, and the menu lists the twelve in their groups', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const trigger = barTypeTrigger(page);
  await expect(trigger).toHaveAttribute('title', DEFAULT_LABEL);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  const menu = await openBarTypeMenu(page);

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitemradio')).toHaveText(BAR_TYPE_LABELS);
  await expect(menu.getByRole('separator')).toHaveCount(GROUP_SEPARATOR_COUNT);
  await expect(barTypeRow(menu, DEFAULT_LABEL)).toHaveAttribute('aria-checked', 'true');
  await expect(barTypeRow(menu, 'Line')).toHaveAttribute('aria-checked', 'false');
  expectNoErrors(collected);
});

test('choosing a bar type saves it, draws it, and closes the menu', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openBarTypeMenu(page);

  await barTypeRow(menu, 'Line').click();

  await expect(menu).toHaveCount(0);
  await expect(barTypeTrigger(page)).toHaveAttribute('title', 'Line');
  await expect.poll(() => drawnSeriesType(page)).toBe('Line');
  await expect.poll(async () => (await savedOverrides(page)).at(-1)).toEqual({ barStyle: 'line' });
  expectNoErrors(collected);
});

test('a chart saved on Area opens with Area checked', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'area' } } });
  await openChart(page);
  await expect(barTypeTrigger(page)).toHaveAttribute('title', 'Area');

  const menu = await openBarTypeMenu(page);

  await expect(barTypeRow(menu, 'Area')).toHaveAttribute('aria-checked', 'true');
  await expect(barTypeRow(menu, DEFAULT_LABEL)).toHaveAttribute('aria-checked', 'false');
  expectNoErrors(collected);
});

test('the keys walk the menu and Escape closes back to the trigger', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const trigger = barTypeTrigger(page);
  await trigger.focus();

  await page.keyboard.press('Enter');
  const menu = barTypeMenu(page);
  await expect(menu).toBeVisible();
  // The menu opens on the bar type the chart draws, so the keys start from there.
  await expect(barTypeRow(menu, DEFAULT_LABEL)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(barTypeRow(menu, 'Hollow candles')).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expectNoErrors(collected);
});

test('a press outside closes the menu', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openBarTypeMenu(page);

  await pressOnChart(page);

  await expect(menu).toHaveCount(0);
  expectNoErrors(collected);
});
