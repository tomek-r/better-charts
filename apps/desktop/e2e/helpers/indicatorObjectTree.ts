import { expect, type Locator, type Page } from '@playwright/test';

/** The names the seeded moving average goes by: its legend name, which its object tree row shows, and its dialog. */
export const SMA_9_CLOSE = 'SMA 9 close';
export const SMA_DIALOG_NAME = 'Moving Average Simple settings';

/** The indicator list, which sits under the drawings and leaves the tree once it holds no row. */
export function indicatorList(page: Page): Locator {
  return page.getByRole('list', { name: 'Indicators' });
}

/** Every row of the indicator list. */
export function indicatorRows(page: Page): Locator {
  return indicatorList(page).getByRole('listitem');
}

/** The settings dialog of the seeded moving average. */
export function smaSettingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: SMA_DIALOG_NAME });
}

/** Opens the object tree drawer, whose indicator rows these cases read. */
export async function openObjectTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Object tree', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Object tree' })).toBeVisible();
}

/** Opens the settings dialog of the seeded moving average by double clicking its row name. */
export async function openSmaSettingsDialog(page: Page): Promise<Locator> {
  await indicatorRows(page).getByRole('button', { name: SMA_9_CLOSE, exact: true }).dblclick();
  const dialog = smaSettingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}
