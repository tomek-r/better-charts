import { expect, type Locator, type Page } from '@playwright/test';
import { attachedIndicators, attachSma } from './indicatorsDialog';

const INDICATOR_LEGEND_LABEL = 'Indicator legend';
const ROW_SELECTOR = '.chart-indicator-legend-row';
const SETTINGS_BUTTON_LABEL = 'Indicator settings';
const SMA_SETTINGS_DIALOG = 'Moving Average Simple settings';
const LENGTH_LABEL = 'Length';

/** The price legend's one row, the one the attached moving average writes. */
export function indicatorLegendRow(page: Page): Locator {
  return page.getByLabel(INDICATOR_LEGEND_LABEL, { exact: true }).locator(ROW_SELECTOR).first();
}

/** Opens the settings of the moving average already attached, from its legend row. */
export async function reopenSmaSettings(page: Page): Promise<Locator> {
  const row = indicatorLegendRow(page);
  await row.hover();
  await row.getByRole('button', { name: SETTINGS_BUTTON_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: SMA_SETTINGS_DIALOG });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Attaches the moving average, then opens its settings from the legend row. */
export async function openSmaSettings(page: Page): Promise<Locator> {
  await attachSma(page);
  return reopenSmaSettings(page);
}

/** The Length the engine resolved for the attached moving average, or undefined while none is attached. */
export async function attachedLength(page: Page): Promise<unknown> {
  const [indicator] = await attachedIndicators(page);
  return indicator?.settings.length;
}

/** The Length field of `dialog`, whichever of the two field roles its int editor maps to. */
export function lengthField(dialog: Locator): Locator {
  const named = { name: LENGTH_LABEL, exact: true };
  return dialog.getByRole('spinbutton', named).or(dialog.getByRole('textbox', named));
}

/** Types a new Length into the open dialog and waits for the chart to show it. */
export async function previewLength(page: Page, dialog: Locator, length: number): Promise<void> {
  await lengthField(dialog).fill(String(length));
  await expect.poll(() => attachedLength(page)).toBe(length);
}
