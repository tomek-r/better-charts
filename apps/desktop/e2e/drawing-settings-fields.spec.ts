import { expect, test, type Page } from '@playwright/test';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';
import { timeframeLabel } from '../src/shared/bridge/timeframes';
import { chooseOption, mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import { STUB_M5_INTERVAL_MS, STUB_NOW } from './helpers/tauriStub';

/**
 * The drawing settings form on its own: one field per input kind, each edited and handed back with the
 * type its kind stores, grouped inputs as fieldsets, and OK disabled while a value is out of range.
 */

/** Every title the form labels a control with, one per kind. */
const FIELD_TITLES = [
  'Bars',
  'Ratio',
  'Level',
  'Filled',
  'Mode',
  'Note',
  'Tint',
  'Basis',
  'Window',
  'Target',
  'Session',
  'Since',
  'Method',
];

/** A stub-clock instant on a whole minute, so the time field shows it back to the minute. */
const SINCE_MS = STUB_NOW - 2 * STUB_M5_INTERVAL_MS;
/** The text a `datetime-local` field shows for that instant, in UTC. */
const SINCE_TEXT = new Date(SINCE_MS).toISOString().slice(0, 16);

/** Mounts the form holding one input of every kind. */
function mountForm(page: Page, overrides: ToolInputValues = {}): Promise<void> {
  return mountSettingsForm(page, undefined, overrides);
}

/** Types into one field by its label, as a user typing into it would. */
async function editField(page: Page, title: string, value: string): Promise<void> {
  await page.getByLabel(title, { exact: true }).fill(value);
}

test('every kind of input renders a field with its own label', async ({ page }) => {
  await mountForm(page);
  for (const title of FIELD_TITLES) {
    await expect(page.getByLabel(title, { exact: true })).toBeVisible();
  }
});

test('every edited field is saved with the type its kind stores', async ({ page }) => {
  await mountForm(page);
  await editField(page, 'Bars', '42');
  await editField(page, 'Ratio', '4.5');
  await editField(page, 'Level', '1.75');
  await page.getByLabel('Filled', { exact: true }).check();
  await chooseOption(page, 'Mode', 'trades');
  await editField(page, 'Note', 'opening range note');
  await editField(page, 'Tint', '#ff0000');
  await chooseOption(page, 'Basis', 'hlc3');
  await chooseOption(page, 'Window', timeframeLabel('H1'));
  await editField(page, 'Target', 'GBPUSD');
  await editField(page, 'Session', '0800-1200');
  await editField(page, 'Since', SINCE_TEXT);
  await chooseOption(page, 'Method', 'Smooth');

  await page.getByRole('button', { name: 'OK', exact: true }).click();

  expect(await savedValues(page)).toEqual([
    {
      bars: 42,
      ratio: 4.5,
      level: 1.75,
      filled: true,
      mode: 'trades',
      note: 'opening range note',
      tint: '#ff0000',
      basis: 'hlc3',
      window: 'H1',
      target: 'GBPUSD',
      session: '0800-1200',
      since: SINCE_MS,
      method: 'smooth',
    },
  ]);
});

test('a colour keeps the alpha suffix it was stored with', async ({ page }) => {
  await mountForm(page, { tint: '#3366ff80' });

  await editField(page, 'Tint', '#00ff00');
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  expect((await savedValues(page))[0].tint).toBe('#00ff0080');
});

test('an out-of-range integer keeps OK disabled until the value fits again', async ({ page }) => {
  await mountForm(page);
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  await expect(ok).toBeEnabled();

  await editField(page, 'Bars', '500');
  await expect(ok).toBeDisabled();

  await editField(page, 'Bars', '50');
  await expect(ok).toBeEnabled();
});

test('grouped inputs render as fieldsets with their legends', async ({ page }) => {
  await mountForm(page);

  await expect(page.getByRole('group', { name: 'Range' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Display' })).toBeVisible();
  await expect(page.locator('fieldset')).toHaveCount(2);
  // An input no group claims stands outside every fieldset.
  expect(await page.getByLabel('Level', { exact: true }).evaluate((element) => element.closest('fieldset'))).toBeNull();
});
