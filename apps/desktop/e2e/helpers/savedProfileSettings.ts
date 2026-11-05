import { expect, type Locator, type Page } from '@playwright/test';
import type { DrawingTimeframeVisibility } from '../../src/features/chart/engine/drawings/timeframeVisibility';
import { chartDrawings, TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL } from './drawingToolbarPage';
import { savedProfile } from './savedProfile';
import { chartScopeKey, gotoWithStub } from './tauriStub';

/** The id of the one profile these steps seed. */
export const SEEDED_PROFILE_ID = 'seeded';

/** The name the object tree and the dialog give the seeded drawing's tool. */
export const SEEDED_PROFILE_LABEL = 'Fixed range volume profile';

/** Boots the app with one saved fixed range volume profile, optionally restricted to some timeframes. */
export async function gotoWithSavedProfile(page: Page, timeframeVisibility?: DrawingTimeframeVisibility) {
  const scopeKey = chartScopeKey(TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL);
  const seeded = savedProfile(SEEDED_PROFILE_ID, { locked: false, visible: true, timeframeVisibility });
  await gotoWithStub(page, { chartDrawings: { [scopeKey]: [seeded] } });
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(1);
}

/** The object tree's button, pressed while the drawer holding the seeded profile is open. */
function objectTreeButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Object tree', exact: true });
}

/**
 * Opens the seeded profile's settings from the object tree on the named tab, leaving a drawer that is
 * already open as it is; answers the dialog it opened.
 */
export async function reopenSavedProfileSettings(page: Page, tabName: string): Promise<Locator> {
  if ((await objectTreeButton(page).getAttribute('aria-pressed')) !== 'true') {
    await objectTreeButton(page).click();
  }
  await page
    .getByRole('list', { name: 'Drawings' })
    .getByRole('button', { name: SEEDED_PROFILE_LABEL, exact: true })
    .dblclick();
  await page.getByRole('tab', { name: tabName, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${SEEDED_PROFILE_LABEL} settings` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Boots the app with one saved profile and opens its settings from the object tree, on the named tab. */
export async function openSavedProfileSettings(
  page: Page,
  tabName: string,
  timeframeVisibility?: DrawingTimeframeVisibility,
): Promise<Locator> {
  await gotoWithSavedProfile(page, timeframeVisibility);
  return reopenSavedProfileSettings(page, tabName);
}
