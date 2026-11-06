import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AttachedIndicatorState } from '../../src/features/chart/engine/indicators/indicatorRuntime';

export const DIALOG_NAME = 'Indicators';
export const BUTTON_NAME = 'Indicators';

const SEARCH_NAME = 'Search indicators';
const LIST_NAME = 'Indicators';
const SMA_SEARCH = 'sma';

export type AttachedIndicator = AttachedIndicatorState;

export function indicatorsButton(page: Page) {
  return page.getByRole('button', { name: BUTTON_NAME, exact: true });
}

export function indicatorsDialog(page: Page) {
  return page.getByRole('dialog', { name: DIALOG_NAME });
}

export function indicatorsList(page: Page) {
  return indicatorsDialog(page).getByRole('list', { name: LIST_NAME });
}

export function searchField(page: Page) {
  return page.getByRole('searchbox', { name: SEARCH_NAME });
}

export function listRows(page: Page) {
  return indicatorsList(page).getByRole('button');
}

export async function openIndicators(page: Page) {
  await indicatorsButton(page).click();
  await expect(indicatorsDialog(page)).toBeVisible();
  return searchField(page);
}

export async function attachedIndicators(page: Page): Promise<AttachedIndicator[]> {
  const attached = await page.evaluate(() => window.__chartTest!.attachedIndicators());
  return Array.from(attached);
}

export async function attachedDefinitions(page: Page): Promise<string[]> {
  const attached = await attachedIndicators(page);
  return attached.map((indicator) => indicator.definitionId);
}

/** Chooses the simple moving average through the dialog, as a user attaches an indicator. */
export async function attachSma(page: Page): Promise<void> {
  const search = await openIndicators(page);
  await search.fill(SMA_SEARCH);
  await listRows(page).first().click();
  await expect(indicatorsDialog(page)).toBeHidden();
}
