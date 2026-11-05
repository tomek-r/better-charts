import { expect, test, type Locator, type Page } from '@playwright/test';
import { chartDrawings, savedDrawings, shownDrawingSettings } from './helpers/drawingToolbarPage';
import { failOnPageNoise } from './helpers/pageNoise';
import { openSavedProfileSettings, reopenSavedProfileSettings } from './helpers/savedProfileSettings';
import { chartDrawingSaveCount } from './helpers/tauriStub';

/**
 * A drawing's settings dialog shows its Inputs and Style edits on the drawing after a short pause,
 * without saving them: OK saves them, and Cancel, Escape, the close button and a backdrop click put
 * the stored settings back. The stored records keep their values through every preview.
 */

/** The Inputs field these steps edit: a resolved input, so a draft previews it on the drawing. */
const VALUE_AREA_FIELD = 'Value Area Volume %';
const DEFAULT_VALUE_AREA = 70;
const EDITED_VALUE_AREA = 50;
/** Above the field's own bound of 100, so the draft is invalid and previews nothing. */
const INVALID_VALUE_AREA = 101;
/** A point 10 px in from the viewport's top-left corner: on the modal's full-window backdrop, clear of its panel. */
const BACKDROP_POINT = 10;
/** Long enough for a resting draft, and the save behind it, to land before a missing save is believed. */
const SETTLE_MS = 400;
const OK_BUTTON = 'OK';
const CANCEL_BUTTON = 'Cancel';
const CLOSE_BUTTON = 'Close drawing settings';

/** The Value Area Volume % control of an open settings dialog. */
function valueAreaField(dialog: Locator): Locator {
  return dialog.getByLabel(VALUE_AREA_FIELD, { exact: true });
}

/** The Value Area Volume % the drawing on the chart is shown with, a dialog's preview included. */
async function shownValueArea(page: Page): Promise<unknown> {
  const [shown] = await shownDrawingSettings(page);
  return shown?.settings.valueAreaPercent;
}

/** The Value Area Volume % the chart's exported record holds, which a preview must never change. */
async function exportedValueArea(page: Page): Promise<unknown> {
  const [record] = await chartDrawings(page);
  return record?.settings.valueAreaPercent;
}

/** The Value Area Volume % the stub's backend stored for the drawing, undefined while it stored none. */
async function savedValueArea(page: Page): Promise<unknown> {
  const [record] = await savedDrawings(page);
  const settings = record?.settings as Record<string, unknown> | undefined;
  return settings?.valueAreaPercent;
}

/** Every drawing's settings as the stub's backend holds them, which a preview must never reach. */
async function storedSettings(page: Page): Promise<unknown[]> {
  return (await savedDrawings(page)).map((record) => record.settings);
}

/** Types the edited value into the open dialog and waits for the drawing on the chart to show it. */
async function previewValueArea(page: Page, dialog: Locator): Promise<void> {
  await valueAreaField(dialog).fill(String(EDITED_VALUE_AREA));
  await expect.poll(() => shownValueArea(page)).toBe(EDITED_VALUE_AREA);
}

test.describe('drawing settings preview', () => {
  failOnPageNoise();

  test('typing a Value Area shows on the drawing before OK and saves nothing', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');
    const savesBefore = await chartDrawingSaveCount(page);

    await previewValueArea(page, dialog);
    await page.waitForTimeout(SETTLE_MS);

    expect(await chartDrawingSaveCount(page)).toBe(savesBefore);
    expect(await storedSettings(page)).toEqual([{}]);
    expect(await exportedValueArea(page)).toBe(DEFAULT_VALUE_AREA);
  });

  test('Cancel puts the stored Value Area back on the drawing and saves nothing', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');
    const savesBefore = await chartDrawingSaveCount(page);
    await previewValueArea(page, dialog);

    await dialog.getByRole('button', { name: CANCEL_BUTTON, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => shownValueArea(page)).toBe(DEFAULT_VALUE_AREA);
    expect(await chartDrawingSaveCount(page)).toBe(savesBefore);
    expect(await storedSettings(page)).toEqual([{}]);
  });

  test('Escape closes the dialog and puts the stored Value Area back', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');
    await previewValueArea(page, dialog);

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect.poll(() => shownValueArea(page)).toBe(DEFAULT_VALUE_AREA);
  });

  test('the close button puts the stored Value Area back', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');
    await previewValueArea(page, dialog);

    await dialog.getByRole('button', { name: CLOSE_BUTTON, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => shownValueArea(page)).toBe(DEFAULT_VALUE_AREA);
  });

  test('a backdrop click puts the stored Value Area back', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');
    await previewValueArea(page, dialog);

    await page.mouse.click(BACKDROP_POINT, BACKDROP_POINT);

    await expect(dialog).toBeHidden();
    await expect.poll(() => shownValueArea(page)).toBe(DEFAULT_VALUE_AREA);
  });

  test('OK saves the previewed Value Area, which the reopened dialog shows', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');
    await previewValueArea(page, dialog);

    await dialog.getByRole('button', { name: OK_BUTTON, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => savedValueArea(page)).toBe(EDITED_VALUE_AREA);
    await expect.poll(() => shownValueArea(page)).toBe(EDITED_VALUE_AREA);
    await expect.poll(() => exportedValueArea(page)).toBe(EDITED_VALUE_AREA);
    const reopened = await reopenSavedProfileSettings(page, 'Inputs');
    expect(await valueAreaField(reopened).inputValue()).toBe(String(EDITED_VALUE_AREA));
  });

  test('an invalid Value Area previews nothing and keeps OK disabled', async ({ page }) => {
    const dialog = await openSavedProfileSettings(page, 'Inputs');

    await valueAreaField(dialog).fill(String(INVALID_VALUE_AREA));

    await expect(dialog.getByRole('button', { name: OK_BUTTON, exact: true })).toBeDisabled();
    await page.waitForTimeout(SETTLE_MS);
    expect(await shownValueArea(page)).toBe(DEFAULT_VALUE_AREA);
  });
});
