import { expect, type Locator, type Page } from '@playwright/test';
import { openChartMenu } from './chartMenu';

/** The name of the chart's settings dialog, which the chart menu's row and the Scales and lines menu both open. */
const SETTINGS_DIALOG_NAME = 'Settings';
/** The chart menu's row that opens the dialog, matched exactly so the view command is not taken for it. */
const SETTINGS_MENU_ITEM_NAME = 'Settings';

/** The chart's settings dialog, as the page exposes it once it is open. */
export function chartSettingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: SETTINGS_DIALOG_NAME });
}

/** Opens the dialog from the chart menu's settings row and returns it once it is visible. */
export async function openChartSettingsDialog(page: Page): Promise<Locator> {
  const menu = await openChartMenu(page);
  await menu.getByRole('menuitem', { name: SETTINGS_MENU_ITEM_NAME, exact: true }).click();
  const dialog = chartSettingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Opens the dialog from the chart menu and switches it to the named tab, which is then asserted to be
 * the selected one. Returns the dialog, with that tab's settings showing.
 */
export async function openChartSettingsTab(page: Page, tab: string): Promise<Locator> {
  const dialog = await openChartSettingsDialog(page);
  const tabButton = dialog.getByRole('tab', { name: tab });
  await tabButton.click();
  await expect(tabButton).toHaveAttribute('aria-selected', 'true');
  return dialog;
}
