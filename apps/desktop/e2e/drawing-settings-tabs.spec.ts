import { expect, test } from '@playwright/test';
import type { ToolInputDefinition } from '../src/features/chart/engine/drawings/toolInputs';
import { defaultToolStyleValues } from '../src/features/chart/engine/drawings/toolStyles';
import { mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import { ALL_STYLES, POC_LINE } from './helpers/toolStyleFixtures';

/**
 * The tabbed settings form: tabs only for what the tool declares, arrow-key navigation, inputs laid out
 * inline or switched off by `activeWhen`, and the Style tab's field per kind saved as flat scalar keys.
 */

const BARS_INPUT = { kind: 'int', id: 'bars', title: 'Bars', defaultValue: 20 } satisfies ToolInputDefinition;
const MODE_INPUT = {
  kind: 'string',
  id: 'mode',
  title: 'Mode',
  defaultValue: 'volume',
  options: ['volume', 'trades'],
} satisfies ToolInputDefinition;

test('a tool with inputs only gets the Inputs tab alone', async ({ page }) => {
  await mountSettingsForm(page, { inputs: [BARS_INPUT] });

  await expect(page.getByRole('tab')).toHaveText(['Inputs']);
});

test('a tool with styles only gets the Style tab alone', async ({ page }) => {
  await mountSettingsForm(page, { styles: ALL_STYLES });

  await expect(page.getByRole('tab')).toHaveText(['Style']);
  await expect(page.getByLabel('Volume profile', { exact: true })).toBeVisible();
});

test('a tool with no settings shows the empty message and no tabs', async ({ page }) => {
  await mountSettingsForm(page, {});

  await expect(page.getByText('This tool has no settings yet.')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});

test('arrow keys move between tabs, wrapping at both ends', async ({ page }) => {
  await mountSettingsForm(page, { inputs: [BARS_INPUT], styles: ALL_STYLES });
  const inputsTab = page.getByRole('tab', { name: 'Inputs' });
  const styleTab = page.getByRole('tab', { name: 'Style' });
  await expect(inputsTab).toHaveAttribute('aria-selected', 'true');

  await inputsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(styleTab).toBeFocused();
  await expect(styleTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Volume profile');

  await page.keyboard.press('ArrowRight');
  await expect(inputsTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(styleTab).toBeFocused();
});

test('inputs sharing an inline key sit side by side and others stay on their own row', async ({ page }) => {
  await mountSettingsForm(page, {
    inputs: [
      { ...BARS_INPUT, inline: 'range' },
      { ...MODE_INPUT, inline: 'range' },
      { kind: 'float', id: 'ratio', title: 'Ratio', defaultValue: 1 },
    ],
  });
  const bars = await page.getByLabel('Bars', { exact: true }).boundingBox();
  const mode = await page.getByLabel('Mode', { exact: true }).boundingBox();
  const ratio = await page.getByLabel('Ratio', { exact: true }).boundingBox();

  // An input and a select differ by a pixel or so in height, so the tops only agree within a few px.
  expect(Math.abs((bars?.y ?? Number.NaN) - (mode?.y ?? Number.NaN))).toBeLessThan(4);
  expect(mode?.x).toBeGreaterThan((bars?.x ?? 0) + (bars?.width ?? 0));
  expect(ratio?.y).toBeGreaterThan((bars?.y ?? 0) + (bars?.height ?? 0));
});

test('an input follows its activeWhen condition and keeps its value while disabled', async ({ page }) => {
  await mountSettingsForm(page, {
    inputs: [
      { kind: 'bool', id: 'useRange', title: 'Use range', defaultValue: false },
      { ...BARS_INPUT, activeWhen: { inputId: 'useRange', equals: true } },
    ],
  });
  const bars = page.getByLabel('Bars', { exact: true });
  const useRange = page.getByLabel('Use range', { exact: true });
  await expect(bars).toBeDisabled();

  await useRange.check();
  await expect(bars).toBeEnabled();
  await bars.fill('40');
  await useRange.uncheck();
  await expect(bars).toBeDisabled();
  await expect(bars).toHaveValue('40');

  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await savedValues(page)).toEqual([{ useRange: false, bars: 40 }]);
});

test('the Style tab renders a field for every style kind, children indented', async ({ page }) => {
  await mountSettingsForm(page, { styles: ALL_STYLES });

  for (const label of [
    'Volume profile',
    'POC',
    'POC colour',
    'POC line style',
    'Histogram Box',
    'Value Area Up',
    'Value Area Up colour',
    'Width (% of the box)',
    'Placement',
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  const parent = await page.getByLabel('Volume profile', { exact: true }).boundingBox();
  const child = await page.getByLabel('POC', { exact: true }).boundingBox();
  expect(child?.x).toBeGreaterThan(parent?.x ?? Number.NaN);
});

test('unchecking a parent disables its children and keeps their values', async ({ page }) => {
  await mountSettingsForm(page, { styles: ALL_STYLES });

  await page.getByLabel('Volume profile', { exact: true }).uncheck();

  await expect(page.getByLabel('POC', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('POC colour', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Histogram Box', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Placement', { exact: true })).toBeEnabled();
});

test('editing a line colour and a toggle then OK saves the flattened values', async ({ page }) => {
  await mountSettingsForm(page, { styles: ALL_STYLES });

  await page.getByLabel('POC colour', { exact: true }).fill('#0000ff');
  await page.getByLabel('Volume profile', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  expect(await savedValues(page)).toEqual([
    { ...defaultToolStyleValues(ALL_STYLES), 'poc.color': '#0000ff', 'profile.visible': false },
  ]);
});

test('the line picker saves the chosen width and dash pattern', async ({ page }) => {
  await mountSettingsForm(page, { styles: [POC_LINE] });

  await page.getByLabel('POC line style', { exact: true }).click();
  await page.getByLabel('POC width', { exact: true }).selectOption('3');
  await page.getByLabel('POC dash', { exact: true }).selectOption('dotted');
  // The open popover would cover the footer, so the user closes it the way they opened it.
  await page.getByLabel('POC line style', { exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  expect(await savedValues(page)).toEqual([
    { ...defaultToolStyleValues([POC_LINE]), 'poc.width': 3, 'poc.style': 'dotted' },
  ]);
});

test('a number style outside its bounds keeps OK disabled', async ({ page }) => {
  await mountSettingsForm(page, { styles: ALL_STYLES });
  const ok = page.getByRole('button', { name: 'OK', exact: true });

  await page.getByLabel('Width (% of the box)', { exact: true }).fill('500');
  await expect(ok).toBeDisabled();

  await page.getByLabel('Width (% of the box)', { exact: true }).fill('60');
  await expect(ok).toBeEnabled();
});
