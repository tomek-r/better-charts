import { expect, test, type Page } from '@playwright/test';
import { parseHexColor } from '../src/shared/theme/hexColor';
import { palette } from '../src/shared/theme/palette';
import { chooseOption, mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import {
  FIXED_RANGE_PROFILE_INPUTS,
  FIXED_RANGE_PROFILE_STYLES,
} from '../src/features/tools/fixedRangeProfile/settings';

/** The fixed range volume profile's declarations as the settings dialog shows them, over the real form. */

const label = (page: Page, title: string) => page.getByLabel(title, { exact: true });

/** The computed `background-color` of an opaque `#rrggbb` colour. */
function rgbText(hex: string): string {
  const { red, green, blue } = parseHexColor(hex)!;
  return `rgb(${red}, ${green}, ${blue})`;
}

test.beforeEach(async ({ page }) => {
  await mountSettingsForm(page, { inputs: FIXED_RANGE_PROFILE_INPUTS, styles: FIXED_RANGE_PROFILE_STYLES });
});

test('the dialog offers an Inputs tab and a Style tab', async ({ page }) => {
  await expect(page.getByRole('tab')).toHaveText(['Inputs', 'Style']);
});

test('the Inputs tab lists the rows, volume, value area and extend right settings', async ({ page }) => {
  for (const title of ['Rows Layout', 'Row Size', 'Ticks Per Row', 'Volume', 'Value Area Volume %', 'Extend Right']) {
    await expect(label(page, title)).toBeVisible();
  }
  await expect(label(page, 'Rows Layout')).toHaveText('Number Of Rows');
  await expect(label(page, 'Row Size')).toHaveValue('128');
  await expect(label(page, 'Volume')).toHaveText('Up/Down');
  await expect(label(page, 'Value Area Volume %')).toHaveValue('70');
  await expect(label(page, 'Extend Right')).toBeChecked();
});

test('only the row field of the chosen layout is editable, and the other keeps its value', async ({ page }) => {
  await expect(label(page, 'Row Size')).toBeEnabled();
  await expect(label(page, 'Ticks Per Row')).toBeDisabled();

  await label(page, 'Row Size').fill('64');
  await chooseOption(page, 'Rows Layout', 'Ticks Per Row');
  await expect(label(page, 'Row Size')).toBeDisabled();
  await expect(label(page, 'Row Size')).toHaveValue('64');
  await expect(label(page, 'Ticks Per Row')).toBeEnabled();
});

test('row size and ticks per row each keep their own bounds', async ({ page }) => {
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  await label(page, 'Row Size').fill('129');
  await expect(ok).toBeDisabled();
  await label(page, 'Row Size').fill('128');
  await expect(ok).toBeEnabled();

  await chooseOption(page, 'Rows Layout', 'Ticks Per Row');
  await label(page, 'Ticks Per Row').fill('1000');
  await expect(ok).toBeEnabled();
  await label(page, 'Ticks Per Row').fill('1001');
  await expect(ok).toBeDisabled();
});

test('the Style tab lists the colours, the three level lines, the width and the placement', async ({ page }) => {
  await page.getByRole('tab', { name: 'Style' }).click();
  for (const title of ['Up Volume', 'Down Volume', 'POC colour', 'VAH colour', 'VAL colour']) {
    await expect(label(page, title)).toBeVisible();
  }
  await expect(label(page, 'POC')).toBeChecked();
  await expect(label(page, 'Up Volume').locator('.color-face-fill')).toHaveCSS(
    'background-color',
    rgbText(palette.buy),
  );
  await expect(label(page, 'Down Volume').locator('.color-face-fill')).toHaveCSS(
    'background-color',
    rgbText(palette.sell),
  );
  await expect(label(page, 'Width (% of range)')).toHaveValue('20');
  await expect(label(page, 'Placement')).toHaveText('Left');
});

test('the Histogram Box row is last on the Style tab, a swatch with no checkbox, opening at 0 percent opacity', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Style' }).click();
  const box = label(page, 'Histogram Box');
  await expect(box).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Histogram Box' })).toHaveCount(0);
  const placement = await label(page, 'Placement').boundingBox();
  expect((await box.boundingBox())!.y).toBeGreaterThan(placement!.y);

  await box.click();
  const popover = page.getByRole('dialog', { name: 'Histogram Box options' });
  await expect(popover.getByLabel('Opacity percent', { exact: true })).toHaveValue('0');
  await popover.getByLabel('Opacity percent', { exact: true }).fill('50');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect((await savedValues(page))[0]['histogramBox.color']).toBe(`${palette.raised}80`);
});

test('the Values row has a checkbox, unchecked by default, and a colour swatch', async ({ page }) => {
  await page.getByRole('tab', { name: 'Style' }).click();
  await expect(page.getByRole('checkbox', { name: 'Values' })).not.toBeChecked();
  await expect(label(page, 'Values colour').locator('.color-face-fill')).toHaveCSS(
    'background-color',
    rgbText(palette.text),
  );
  await page.getByRole('checkbox', { name: 'Values' }).check();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect((await savedValues(page))[0]['values.visible']).toBe(true);
});

test('every input sits on its own row, its label on the left and its control on the right', async ({ page }) => {
  const titles = ['Rows Layout', 'Row Size', 'Ticks Per Row', 'Volume', 'Value Area Volume %', 'Extend Right'];
  const boxes = [];
  for (const title of titles) {
    const labelBox = await page.locator('label.drawing-settings-label', { hasText: title }).first().boundingBox();
    const controlBox = await label(page, title).boundingBox();
    expect(controlBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width - 1);
    boxes.push(controlBox!);
  }
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index].y).toBeGreaterThan(boxes[index - 1].y + boxes[index - 1].height - 1);
  }
});

test('a number field shows 128 and its spin buttons without clipping', async ({ page }) => {
  const rowSize = label(page, 'Row Size');
  await expect(rowSize).toHaveValue('128');
  const { scrollWidth, clientWidth } = await rowSize.evaluate((input) => ({
    scrollWidth: input.scrollWidth,
    clientWidth: input.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expect((await rowSize.boundingBox())!.width).toBeGreaterThanOrEqual(96);
});

test('saving without a change hands back the defaults that reproduce the current look', async ({ page }) => {
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await savedValues(page)).toEqual([
    {
      rowsLayout: 'Number Of Rows',
      rowCount: 128,
      ticksPerRow: 1,
      volume: 'Up/Down',
      valueAreaPercent: 70,
      extendRight: true,
      'upVolume.color': palette.buy,
      'downVolume.color': palette.sell,
      'values.visible': false,
      'values.color': palette.text,
      'poc.visible': true,
      'poc.color': palette.profilePoc,
      'poc.width': 1,
      'poc.style': 'solid',
      'vah.visible': true,
      'vah.color': palette.textBright,
      'vah.width': 1,
      'vah.style': 'dashed',
      'val.visible': true,
      'val.color': palette.textBright,
      'val.width': 1,
      'val.style': 'dashed',
      widthPercent: 20,
      placement: 'Left',
      'histogramBox.color': `${palette.raised}00`,
    },
  ]);
});
