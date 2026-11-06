import { expect, test, type Locator, type Page } from '@playwright/test';
import { GREYSCALE_ROW, HUE_ROW } from '../src/shared/ui/colorPicker/colorPalette';
import { MAX_CUSTOM_COLORS } from '../src/shared/ui/colorPicker/savedCustomColors';
import { cancelCount, mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import { defaultSettingStyleValues } from '../src/features/chart/engine/settings/settingStyles';
import { gotoWithStub } from './helpers/tauriStub';
import { openScalesAndLinesMenu } from './helpers/chartMenu';
import { HISTOGRAM_BOX, POC_LINE } from './helpers/toolStyleFixtures';
import { failOnPageNoise } from './helpers/pageNoise';

failOnPageNoise();

/**
 * The colour and line picker of the Style tab: a swatch button opening a popover with preset colours, the
 * user's own colours, opacity and, for a line, thickness and line style. Changes land in the dialog's pending
 * values, and Cancel discards them. The "+" of the custom row opens an in-app colour editor, which is what
 * stores a custom colour: the native colour panel added every shade of a drag on macOS.
 */

/** POC_LINE's own colour, an opaque red that is not one of the presets. */
const POC_DEFAULT = '#ff0000';
const GREEN = HUE_ROW[3];

const trigger = (page: Page) => page.getByLabel('POC colour', { exact: true });
const popover = (page: Page) => page.getByRole('dialog', { name: 'POC colour options' });
const swatch = (page: Page, hex: string) => popover(page).getByRole('button', { name: hex, exact: true });
const ok = (page: Page) => page.getByRole('button', { name: 'OK', exact: true });
const addCustomButton = (page: Page) => popover(page).getByRole('button', { name: 'Add custom colour', exact: true });
const hexField = (page: Page) => popover(page).getByLabel('Hex colour', { exact: true });
const addButton = (page: Page) => popover(page).getByRole('button', { name: 'Add', exact: true });
const preview = (page: Page) => popover(page).locator('.color-editor-preview');
const customSwatches = (page: Page) =>
  popover(page).getByRole('group', { name: 'Custom colours' }).getByRole('button', { name: /^#/ });

/** Opens the editor with "+", types `color` into its hex field and presses Add. */
async function addCustomColor(page: Page, color: string): Promise<void> {
  await addCustomButton(page).click();
  await hexField(page).fill(color);
  await addButton(page).click();
}

/** Where the control is on the page, which a drag or a click at a fraction of it needs. */
async function boxOf(control: Locator) {
  const box = await control.boundingBox();
  if (box === null) {
    throw new Error('the control is not on screen');
  }
  return box;
}

/** Closes the open popover (it would cover the footer), presses OK and reads the POC colour the form saved. */
async function savedPocColor(page: Page): Promise<unknown> {
  await page.keyboard.press('Escape');
  await ok(page).click();
  return (await savedValues(page))[0]['poc.color'];
}

/** A line of the chart's own canvas: the chart draws it one pixel wide, so its picker offers no thickness. */
const CANVAS_LINE_LABEL = 'Vertical grid lines colour';

/** The chart's own canvas settings: the picker its Crosshair row opens is the tallest of them. */
const CROSSHAIR_LABEL = 'Crosshair';

/** The window the desktop app is built for, which Chromium opens at when a test does not size it. */
const DEFAULT_WINDOW = { width: 1280, height: 720 };

/** Leaves the drawing settings form for the app and opens the chart's Settings dialog on its Canvas tab. */
async function openCanvasTab(page: Page): Promise<void> {
  await gotoWithStub(page);
  const menu = await openScalesAndLinesMenu(page);
  await menu.getByRole('menuitem', { name: 'More settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Canvas' }).click();
}

/** Opens that Canvas line's picker: the Canvas tab and the line's swatch. Returns the popover. */
async function openCanvasLinePicker(page: Page): Promise<Locator> {
  await openCanvasTab(page);
  await page.getByRole('button', { name: CANVAS_LINE_LABEL, exact: true }).click();
  return page.getByRole('dialog', { name: `${CANVAS_LINE_LABEL} options` });
}

/** How far each side of the popover's box reaches past the window, so an all-zero answer is a box fully inside. */
async function overflowFromWindow(popover: Locator): Promise<Record<'left' | 'top' | 'right' | 'bottom', number>> {
  return popover.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: Math.max(0, -box.left),
      top: Math.max(0, -box.top),
      right: Math.max(0, box.right - window.innerWidth),
      bottom: Math.max(0, box.bottom - window.innerHeight),
    };
  });
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
  await expect(trigger(page).locator('line')).toHaveAttribute('stroke-dasharray', '3 3');
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await ok(page).click();
  expect(await savedValues(page)).toEqual([
    { ...defaultSettingStyleValues([POC_LINE, HISTOGRAM_BOX]), 'poc.width': 4, 'poc.style': 'dashed' },
  ]);
});

test('a line offers four thicknesses and three line styles', async ({ page }) => {
  await trigger(page).click();

  await expect(popover(page).getByRole('group', { name: 'Thickness' }).getByRole('button')).toHaveCount(4);
  await expect(popover(page).getByRole('group', { name: 'Line style' }).getByRole('button')).toHaveCount(3);
});

test('a line picker without thickness offers the three line styles and no Thickness section', async ({ page }) => {
  const canvasLine = await openCanvasLinePicker(page);

  await expect(canvasLine.getByRole('group', { name: 'Line style' }).getByRole('button')).toHaveCount(3);
  await expect(canvasLine.getByRole('group', { name: 'Thickness' })).toHaveCount(0);
  // With no thickness to set, the swatch previews the line at the width the chart draws it.
  const lineSwatch = page.getByRole('button', { name: CANVAS_LINE_LABEL, exact: true });
  await expect(lineSwatch.locator('line')).toHaveAttribute('stroke-width', '1');
});

test('the Crosshair picker stays inside the window, its custom colour editor included', async ({ page }) => {
  await page.setViewportSize(DEFAULT_WINDOW);
  await openCanvasTab(page);
  await page.getByRole('button', { name: CROSSHAIR_LABEL, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `${CROSSHAIR_LABEL} options` });

  // Opened from the Canvas tab's Crosshair row, the picker hangs below a trigger that sits low in the
  // window, so a picker that grew past the window's edge would put its own bottom rows out of reach.
  await expect.poll(() => overflowFromWindow(picker)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });

  await picker.getByRole('button', { name: 'Add custom colour', exact: true }).click();
  await expect(picker.getByLabel('Hex colour', { exact: true })).toBeVisible();

  // The editor makes the picker taller than the room under its trigger; it is re-placed as it grows.
  await expect.poll(() => overflowFromWindow(picker)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
});

test('a plain colour offers neither thickness nor line style', async ({ page }) => {
  await page.getByLabel('Histogram Box', { exact: true }).click();
  const colorPopover = page.getByRole('dialog', { name: 'Histogram Box options' });

  await expect(colorPopover.getByLabel('Opacity', { exact: true })).toBeVisible();
  await expect(colorPopover.getByRole('group', { name: 'Thickness' })).toHaveCount(0);
  await expect(colorPopover.getByRole('group', { name: 'Line style' })).toHaveCount(0);
});

test('"+" opens the in-app editor instead of the native colour panel', async ({ page }) => {
  await trigger(page).click();
  await addCustomButton(page).click();

  await expect(addCustomButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(hexField(page)).toBeVisible();
  await expect(popover(page).locator('input[type="color"]')).toHaveCount(0);
});

test('a typed hex colour is added once, selected, and closes the editor', async ({ page }) => {
  await trigger(page).click();
  await addCustomButton(page).click();
  await hexField(page).fill('#4CAF50');
  await addButton(page).click();

  await expect(customSwatches(page)).toHaveCount(1);
  await expect(customSwatches(page).first()).toHaveAttribute('aria-label', '#4caf50');
  await expect(customSwatches(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(hexField(page)).toHaveCount(0);
  await expect(addCustomButton(page)).toHaveAttribute('aria-expanded', 'false');
});

test('dragging the square previews a colour and adds nothing until Add', async ({ page }) => {
  await trigger(page).click();
  await addCustomButton(page).click();
  const square = popover(page).getByRole('slider', { name: 'Saturation and brightness', exact: true });
  const box = await boxOf(square);

  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 4 });
  await page.mouse.up();

  await expect(preview(page)).not.toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await expect(hexField(page)).toHaveValue(/^#[0-9a-f]{6}$/);
  await expect(customSwatches(page)).toHaveCount(0);
  const dragged = await hexField(page).inputValue();

  await addButton(page).click();

  await expect(customSwatches(page)).toHaveCount(1);
  await expect(customSwatches(page).first()).toHaveAttribute('aria-label', dragged);
});

test('the hue bar moves the colour with the arrow keys', async ({ page }) => {
  await trigger(page).click();
  await addCustomButton(page).click();
  await expect(hexField(page)).toHaveValue(POC_DEFAULT);
  const hueBar = popover(page).getByRole('slider', { name: 'Hue', exact: true });

  await hueBar.focus();
  await page.keyboard.press('ArrowUp');

  await expect(hueBar).toHaveAttribute('aria-valuenow', '1');
  await expect(hexField(page)).toHaveValue('#ff0400');

  await page.keyboard.press('Shift+ArrowUp');
  await expect(hueBar).toHaveAttribute('aria-valuenow', '11');
});

test('a hex text that is no colour disables Add', async ({ page }) => {
  await trigger(page).click();
  await addCustomButton(page).click();

  await hexField(page).fill('#12');
  await expect(hexField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(addButton(page)).toBeDisabled();

  await hexField(page).fill('#4caf50');
  await expect(hexField(page)).toHaveAttribute('aria-invalid', 'false');
  await expect(addButton(page)).toBeEnabled();
});

test('Escape closes the editor but keeps the popover open', async ({ page }) => {
  await trigger(page).click();
  await addCustomButton(page).click();
  await expect(hexField(page)).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(hexField(page)).toHaveCount(0);
  await expect(popover(page)).toBeVisible();
  await expect(addCustomButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(addCustomButton(page)).toBeFocused();
});

test('ten colours added with the Enter key fill the row and no more', async ({ page }) => {
  await trigger(page).click();
  const added = Array.from({ length: MAX_CUSTOM_COLORS + 1 }, (_, index) => `#${(index + 16).toString(16)}0ff0`);
  for (const color of added) {
    await addCustomButton(page).click();
    await hexField(page).fill(color);
    await hexField(page).press('Enter');
  }

  await expect(customSwatches(page)).toHaveCount(MAX_CUSTOM_COLORS);
});

test('a custom colour is added, applied and still there after a reload', async ({ page }) => {
  await trigger(page).click();
  await addCustomColor(page, '#123456');

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
  const added = Array.from({ length: MAX_CUSTOM_COLORS + 2 }, (_, index) => `#00${(index + 16).toString(16)}00`);
  for (const color of [...added, added[5]]) {
    await addCustomColor(page, color);
  }

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
