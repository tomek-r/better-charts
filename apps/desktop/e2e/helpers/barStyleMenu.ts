import { expect, type Locator, type Page } from '@playwright/test';

/** The button beside the timeframes that names and opens the bar type menu. */
export const barTypeTrigger = (page: Page) => page.getByRole('button', { name: 'Bar type', exact: true });

/** The menu the trigger opens. */
export const barStyleMenu = (page: Page) => page.getByRole('menu', { name: 'Bar type' });

/** One row of the menu, found by the name it shows. */
export const barStyleRow = (menu: Locator, label: string) =>
  menu.getByRole('menuitemradio', { name: label, exact: true });

/** Opens the bar type menu and returns it. */
export async function openBarStyleMenu(page: Page): Promise<Locator> {
  await barTypeTrigger(page).click();
  const menu = barStyleMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** Picks the bar type `label` names from the menu, which closes on the choice. */
export async function chooseBarStyle(page: Page, label: string): Promise<void> {
  const menu = await openBarStyleMenu(page);
  await barStyleRow(menu, label).click();
  await expect(menu).toHaveCount(0);
}
