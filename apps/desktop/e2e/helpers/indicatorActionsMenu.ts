import { expect, type Locator, type Page } from '@playwright/test';
import { INDICATOR_MORE_ACTIONS_LABEL } from '../../src/features/chart/engine/legend/indicatorLegendLabels';
import {
  INDICATOR_ACTION_LABELS,
  INDICATOR_ACTIONS_MENU_LABEL,
} from '../../src/features/indicators/indicatorActionsMenu/indicatorActionsMenuLabels';
import { legendRowNamed } from './indicatorObjectTree';

/** The indicator actions menu: the one the legend row's More button and an object tree row's right-press open. */
export function indicatorActionsMenu(page: Page): Locator {
  return page.getByRole('menu', { name: INDICATOR_ACTIONS_MENU_LABEL, exact: true });
}

/** One row of an open menu, by the words it shows. */
export function actionsMenuRow(menu: Locator, label: string): Locator {
  return menu.getByRole('menuitem', { name: label, exact: true });
}

/**
 * The Remove row, whose accessible name goes on with the shortcut it names at its far end: it starts with the
 * row's words, as the Scales and lines menu's shortcut rows do.
 */
export function removeRow(menu: Locator): Locator {
  return menu.getByRole('menuitem', { name: new RegExp(`^${INDICATOR_ACTION_LABELS.remove}\\b`) });
}

/** The paint-order submenu of an open menu, by the words of the row that opens it. */
export function visualOrderSubmenu(page: Page): Locator {
  return page.getByRole('menu', { name: INDICATOR_ACTION_LABELS.visualOrder, exact: true });
}

/** The More button a legend row offers while it is hovered, selected or holds the focus. */
export function legendMoreButton(row: Locator): Locator {
  return row.getByRole('button', { name: INDICATOR_MORE_ACTIONS_LABEL, exact: true });
}

/** Opens the actions menu from one legend row: a hover shows its buttons, and a press on More opens the menu. */
export async function openLegendActionsMenu(row: Locator): Promise<Locator> {
  await row.hover();
  await legendMoreButton(row).click();
  const menu = indicatorActionsMenu(row.page());
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the paint-order submenu from the row of an open menu that carries it. */
export async function openVisualOrderSubmenu(menu: Locator): Promise<Locator> {
  await actionsMenuRow(menu, INDICATOR_ACTION_LABELS.visualOrder).click();
  const submenu = visualOrderSubmenu(menu.page());
  await expect(submenu).toBeVisible();
  return submenu;
}

/** Picks the Visual order row `menuRowLabel` of the legend row titled `legendTitle`, moving its indicator. */
export async function pickVisualOrder(page: Page, legendTitle: string, menuRowLabel: string): Promise<void> {
  const menu = await openLegendActionsMenu(legendRowNamed(page, legendTitle));
  const submenu = await openVisualOrderSubmenu(menu);
  await actionsMenuRow(submenu, menuRowLabel).click();
}
