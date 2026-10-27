import { expect, test, type Page } from '@playwright/test';
import { GREYSCALE_ROW, HUE_ROW } from '../src/shared/ui/colorPicker/colorPalette';
import { MAX_CUSTOM_COLORS } from '../src/shared/ui/colorPicker/savedCustomColors';
import { cancelCount, mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import { defaultToolStyleValues } from '../src/features/chart/engine/drawings/toolStyles';
import { HISTOGRAM_BOX, POC_LINE } from './helpers/toolStyleFixtures';

/**
 * The colour and line picker of the Style tab: a swatch button opening a popover with preset colours, the
 * user's own colours, opacity and, for a line, thickness and line style. Changes land in the dialog's pending
 * values, and Cancel discards them.
 */

/** POC_LINE's own colour, an opaque red that is not one of the presets. */
const POC_DEFAULT = '#ff0000';
const GREEN = HUE_ROW[3];

const trigger = (page: Page) => page.getByLabel('POC colour', { exact: true });
const popover = (page: Page) => page.getByRole('dialog', { name: 'POC colour options' });
const swatch = (page: Page, hex: string) => popover(page).getByRole('button', { name: hex, exact: true });
const ok = (page: Page) => page.getByRole('button', { name: 'OK', exact: true });

/** Closes the open popover (it would cover the footer), presses OK and reads the POC colour the form saved. */
async function savedPocColor(page: Page): Promise<unknown> {
  await page.keyboard.press('Escape');
  await ok(page).click();
  return (await savedValues(page))[0]['poc.color'];
}

test.beforeEach(async ({ page }) => {
  await mountSettingsForm(page, { styles: [POC_LINE, HISTOGRAM_BOX] });
});

test('the swatch button names its setting and reports the popover it controls', async ({ page }) => {
  await expect(trigger(page)).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');

  await trigger(page).click();

  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(popover(page)).toBeVisible();
});

test('the presets are ten columns: greys, then hues, then six tinted and shaded rows', async ({ page }) => {
  await trigger(page).click();
  const swatches = popover(page).getByRole('group', { name: 'Preset colours' }).getByRole('button');

  await expect(swatches).toHaveCount(80);
  await expect(swatches.first()).toHaveAttribute('aria-label', GREYSCALE_ROW[0]);
  await expect(swatches.nth(9)).toHaveAttribute('aria-label', GREYSCALE_ROW[9]);
  await expect(swatches.nth(10)).toHaveAttribute('aria-label', HUE_ROW[0]);
  const rowTops = await swatches.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().y),
  );
  expect(new Set(rowTops.slice(0, 10)).size).toBe(1);
  expect(new Set(rowTops.slice(10, 20)).size).toBe(1);
  expect(rowTops[20] - rowTops[10]).toBeGreaterThan(rowTops[10] - rowTops[0]);
  expect(new Set(rowTops).size).toBe(8);
});

test('choosing a preset sets the colour and outlines it as the current one', async ({ page }) => {
  await trigger(page).click();
  await expect(popover(page).locator('[aria-pressed="true"].color-swatch')).toHaveCount(0);
  await swatch(page, GREEN).click();
  await expect(swatch(page, GREEN)).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, HUE_ROW[0])).toHaveAttribute('aria-pressed', 'false');

  expect(await savedPocColor(page)).toBe(GREEN);
});

test('a preset keeps the opacity already chosen', async ({ page }) => {
  await mountSettingsForm(page, { styles: [POC_LINE] }, { 'poc.color': `${POC_DEFAULT}80` });
  await trigger(page).click();
  await swatch(page, GREEN).click();

  expect(await savedPocColor(page)).toBe(`${GREEN}80`);
});

test('half opacity stores the 80 suffix and full opacity stores six digits again', async ({ page }) => {
  await trigger(page).click();
  const percent = popover(page).getByLabel('Opacity percent', { exact: true });

  await percent.fill('50');
  expect(await savedPocColor(page)).toBe(`${POC_DEFAULT}80`);

  await mountSettingsForm(page, { styles: [POC_LINE] }, { 'poc.color': `${POC_DEFAULT}80` });
  await trigger(page).click();
  await popover(page).getByLabel('Opacity percent', { exact: true }).fill('100');
  expect(await savedPocColor(page)).toBe(POC_DEFAULT);
});

test('the opacity slider and the percent field stay in step', async ({ page }) => {
  await trigger(page).click();
  const slider = popover(page).getByLabel('Opacity', { exact: true });
  const percent = popover(page).getByLabel('Opacity percent', { exact: true });
  await expect(slider).toHaveValue('100');
  await expect(percent).toHaveValue('100');

  await slider.fill('25');
  await expect(percent).toHaveValue('25');

  await percent.fill('80');
  await expect(slider).toHaveValue('80');

  await percent.fill('250');
  await expect(slider).toHaveValue('100');
});

test('thickness and line style update the pending values and the swatch preview', async ({ page }) => {
  await trigger(page).click();
  await popover(page).getByRole('button', { name: '4 px', exact: true }).click();
  await popover(page).getByRole('button', { name: 'Dashed', exact: true }).click();

  await expect(popover(page).getByRole('button', { name: '4 px', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(popover(page).getByRole('button', { name: 'Dashed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(trigger(page).locator('line')).toHaveAttribute('stroke-width', '4');
  await expect(trigger(page).locator('line')).toHaveAttribute('stroke-dasharray', '6 4');
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await ok(page).click();
  expect(await savedValues(page)).toEqual([
    { ...defaultToolStyleValues([POC_LINE, HISTOGRAM_BOX]), 'poc.width': 4, 'poc.style': 'dashed' },
  ]);
});

test('a line offers four thicknesses and three line styles', async ({ page }) => {
  await trigger(page).click();

  await expect(popover(page).getByRole('group', { name: 'Thickness' }).getByRole('button')).toHaveCount(4);
  await expect(popover(page).getByRole('group', { name: 'Line style' }).getByRole('button')).toHaveCount(3);
});

test('a plain colour offers neither thickness nor line style', async ({ page }) => {
  await page.getByLabel('Histogram Box', { exact: true }).click();
  const colorPopover = page.getByRole('dialog', { name: 'Histogram Box options' });

  await expect(colorPopover.getByLabel('Opacity', { exact: true })).toBeVisible();
  await expect(colorPopover.getByRole('group', { name: 'Thickness' })).toHaveCount(0);
  await expect(colorPopover.getByRole('group', { name: 'Line style' })).toHaveCount(0);
});

test('a custom colour is added, applied and still there after a reload', async ({ page }) => {
  await trigger(page).click();
  await popover(page).getByLabel('Custom colour', { exact: true }).fill('#123456');

  await expect(swatch(page, '#123456')).toHaveAttribute('aria-pressed', 'true');
  expect(await savedPocColor(page)).toBe('#123456');

  await mountSettingsForm(page, { styles: [POC_LINE] });
  await trigger(page).click();
  await expect(
    popover(page).getByRole('group', { name: 'Custom colours' }).getByRole('button').first(),
  ).toHaveAttribute('aria-label', '#123456');
});

test('custom colours are kept newest first, without repeats, up to ten', async ({ page }) => {
  await trigger(page).click();
  const input = popover(page).getByLabel('Custom colour', { exact: true });
  const added = Array.from({ length: MAX_CUSTOM_COLORS + 2 }, (_, index) => `#00${(index + 16).toString(16)}00`);
  for (const color of added) {
    await input.fill(color);
  }
  // Adding an older colour again moves it to the front instead of listing it twice.
  await input.fill(added[5]);

  const savedColors = popover(page).getByRole('group', { name: 'Custom colours' }).getByRole('button', { name: /^#/ });
  await expect(savedColors).toHaveCount(MAX_CUSTOM_COLORS);
  await expect(savedColors.first()).toHaveAttribute('aria-label', added[5]);
  await expect(savedColors.last()).toHaveAttribute('aria-label', added[2]);
});

test('Escape closes the popover and returns focus to the swatch button', async ({ page }) => {
  await trigger(page).click();
  await expect(popover(page)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(popover(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
});

test('a click outside closes the popover', async ({ page }) => {
  await trigger(page).click();
  await page.getByRole('tablist').click();

  await expect(popover(page)).toHaveCount(0);
});

test('focus opens inside the popover and Tab wraps around it both ways', async ({ page }) => {
  await trigger(page).click();
  await expect(popover(page).getByRole('button', { name: GREYSCALE_ROW[0], exact: true })).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(popover(page).getByRole('button', { name: 'Dotted', exact: true })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(popover(page).getByRole('button', { name: GREYSCALE_ROW[0], exact: true })).toBeFocused();
});

test('Cancel discards the colour, thickness and line style picked in the popover', async ({ page }) => {
  await trigger(page).click();
  await swatch(page, GREEN).click();
  await popover(page).getByRole('button', { name: '3 px', exact: true }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  expect(await cancelCount(page)).toBe(1);
  expect(await savedValues(page)).toEqual([]);
});

test('a disabled line row cannot open its picker', async ({ page }) => {
  await mountSettingsForm(page, { styles: [POC_LINE] }, { 'poc.visible': false });

  await expect(trigger(page)).toBeDisabled();
});
