import { expect, test, type Page } from '@playwright/test';
import { palette } from '../src/shared/theme/palette';
import { mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import {
  FIXED_RANGE_PROFILE_INPUTS,
  FIXED_RANGE_PROFILE_STYLES,
} from '../src/features/tools/fixedRangeProfile/settings';

/** The fixed range volume profile's declarations as the settings dialog shows them, over the real form. */

const label = (page: Page, title: string) => page.getByLabel(title, { exact: true });

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
  await expect(label(page, 'Rows Layout')).toHaveValue('Number Of Rows');
  await expect(label(page, 'Row Size')).toHaveValue('128');
  await expect(label(page, 'Volume')).toHaveValue('Up/Down');
  await expect(label(page, 'Value Area Volume %')).toHaveValue('70');
  await expect(label(page, 'Extend Right')).toBeChecked();
});

test('only the row field of the chosen layout is editable, and the other keeps its value', async ({ page }) => {
  await expect(label(page, 'Row Size')).toBeEnabled();
  await expect(label(page, 'Ticks Per Row')).toBeDisabled();

  await label(page, 'Row Size').fill('64');
  await label(page, 'Rows Layout').selectOption('Ticks Per Row');
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

  await label(page, 'Rows Layout').selectOption('Ticks Per Row');
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
  await expect(label(page, 'Up Volume')).toHaveValue(palette.buy);
  await expect(label(page, 'Down Volume')).toHaveValue(palette.sell);
  await expect(label(page, 'Width (% of pane)')).toHaveValue('20');
  await expect(label(page, 'Placement')).toHaveValue('Left');
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
    },
  ]);
});
