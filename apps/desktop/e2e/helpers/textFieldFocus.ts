import type { Page } from '@playwright/test';

/** Focuses a text field outside the app's own rows, of the kind a shortcut has to stand aside for. */
export async function focusScratchTextField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Scratch field');
    document.body.append(field);
    field.focus();
  });
}
