import { expect, type Page } from '@playwright/test';
import type { DrawingTimeframeVisibility } from '../../src/features/chart/engine/drawings/timeframeVisibility';
import { chartDrawings, TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL } from './drawingToolbarPage';
import { savedProfile } from './savedProfile';
import { chartDrawingScopeKey, gotoWithStub } from './tauriStub';

/** The id of the one profile these steps seed. */
export const SEEDED_PROFILE_ID = 'seeded';

/** Boots the app with one saved fixed range volume profile, optionally restricted to some timeframes. */
export async function gotoWithSavedProfile(page: Page, timeframeVisibility?: DrawingTimeframeVisibility) {
  const scopeKey = chartDrawingScopeKey(TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL);
  const seeded = savedProfile(SEEDED_PROFILE_ID, { locked: false, visible: true, timeframeVisibility });
  await gotoWithStub(page, { chartDrawings: { [scopeKey]: [seeded] } });
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(1);
}

/** Boots the app with one saved profile and opens its settings from the object tree, on the named tab. */
export async function openSavedProfileSettings(
  page: Page,
  tabName: string,
  timeframeVisibility?: DrawingTimeframeVisibility,
): Promise<void> {
  await gotoWithSavedProfile(page, timeframeVisibility);
  await page.getByRole('button', { name: 'Object tree', exact: true }).click();
  await page
    .getByRole('list', { name: 'Drawings' })
    .getByRole('button', { name: 'Fixed range volume profile', exact: true })
    .dblclick();
  await page.getByRole('tab', { name: tabName, exact: true }).click();
}
