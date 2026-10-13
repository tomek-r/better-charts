import { expect, test } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

test('the generic modal traps Tab and Shift+Tab, dismisses on Escape and restores focus', async ({ page }) => {
  await gotoWithStub(page);
  await page.evaluate(async () => {
    const harnessPath = '/e2e/helpers/modalDialogHarness.tsx';
    const harness = await import(/* @vite-ignore */ harnessPath);
    harness.mountModalDialogHarness();
  });

  const opener = page.getByTestId('open-modal');
  await opener.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Generic modal' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  await expect(page.locator('[data-modal-dialog]')).toHaveCount(1);
  await expect(cancel).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
