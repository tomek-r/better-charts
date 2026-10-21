import { test, expect } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

const SAVE_DELAY_MS = 1500;

test('the App settings dialog keeps its Save and Cancel buttons still while saving', async ({ page }) => {
  await gotoWithStub(page, { saveDelayMs: SAVE_DELAY_MS });
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(save).toBeEnabled();
  // Infinite animations (the demo-account marquee) never finish; only the dialog's own transitions settle.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished),
    ),
  );
  const [saveBefore, cancelBefore] = await Promise.all([save.boundingBox(), cancel.boundingBox()]);
  await save.click();
  const saving = dialog.getByRole('button', { name: 'Saving…', exact: true });
  await expect(saving).toBeVisible();
  const [savingBox, cancelDuring] = await Promise.all([saving.boundingBox(), cancel.boundingBox()]);
  expect(savingBox).toEqual(saveBefore);
  expect(cancelDuring).toEqual(cancelBefore);
});
