import { expect, type Locator } from '@playwright/test';

/** Opens an app drop-down (shared/ui/select/Select) and clicks the option with the given label. */
export async function chooseOption(select: Locator, label: string): Promise<void> {
  await select.click();
  await select.page().getByRole('option', { name: label, exact: true }).click();
  await expect(select).toHaveText(label);
}

/** Opens an app drop-down, checks its option labels in order, and closes it again with Escape. */
export async function expectOptionLabels(select: Locator, labels: readonly string[]): Promise<void> {
  await select.click();
  // Each option also holds a hidden check mark, so only the label span is compared.
  await expect(select.page().getByRole('option').locator('span:not(.select-check)')).toHaveText([...labels]);
  await select.page().keyboard.press('Escape');
}

/** Opens an app drop-down, presses Escape, and checks that only the list closed and the button has focus back. */
export async function escapeOpenList(select: Locator): Promise<void> {
  const page = select.page();
  await select.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(select).toBeFocused();
}
