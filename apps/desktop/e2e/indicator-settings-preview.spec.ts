import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  attachedLength,
  indicatorLegendRow,
  lengthField,
  openSmaSettings,
  previewLength,
  reopenSmaSettings,
} from './helpers/indicatorSettingsDialog';
import { attachedIndicators, attachSma } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * An indicator's settings dialog shows its Inputs and Style edits on the chart after a short pause,
 * without storing them: OK stores them, and Cancel, the close button and Escape put the stored
 * settings back on the chart.
 */

const TITLE_SELECTOR = '.chart-indicator-legend-title';
const OK_BUTTON_LABEL = 'OK';
const CANCEL_BUTTON_LABEL = 'Cancel';
const CLOSE_BUTTON_LABEL = 'Close indicator settings';
const DEFAULT_LENGTH = 9;
const EDITED_LENGTH = 20;
const EMPTY_LENGTH = '';
const DEFAULT_TITLE = 'SMA 9 close';
const EDITED_TITLE = 'SMA 20 close';
/** The pause the settings form waits after an edit before it previews the draft (see useDebouncedPreview). */
const PREVIEW_DELAY_MS = 250;
/** Two pauses: long enough for a preview an untouched dialog should never send to have landed. */
const SETTLE_MS = 2 * PREVIEW_DELAY_MS;

/** The words of the legend row the attached moving average writes. */
function legendTitle(page: Page): Locator {
  return indicatorLegendRow(page).locator(TITLE_SELECTOR);
}

test.describe('indicator settings preview', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
  });

  test('typing a Length shows on the chart before OK is pressed', async ({ page }) => {
    const dialog = await openSmaSettings(page);

    await previewLength(page, dialog, EDITED_LENGTH);

    await expect(legendTitle(page)).toHaveText(EDITED_TITLE);
  });

  test('Cancel puts the stored Length back on the chart', async ({ page }) => {
    const dialog = await openSmaSettings(page);
    await previewLength(page, dialog, EDITED_LENGTH);

    await dialog.getByRole('button', { name: CANCEL_BUTTON_LABEL, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => attachedLength(page)).toBe(DEFAULT_LENGTH);
    await expect(legendTitle(page)).toHaveText(DEFAULT_TITLE);
  });

  test('Escape closes the dialog and puts the stored Length back on the chart', async ({ page }) => {
    const dialog = await openSmaSettings(page);
    await previewLength(page, dialog, EDITED_LENGTH);

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect.poll(() => attachedLength(page)).toBe(DEFAULT_LENGTH);
  });

  test('the close button puts the stored Length back on the chart', async ({ page }) => {
    const dialog = await openSmaSettings(page);
    await previewLength(page, dialog, EDITED_LENGTH);

    await dialog.getByRole('button', { name: CLOSE_BUTTON_LABEL, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => attachedLength(page)).toBe(DEFAULT_LENGTH);
  });

  test('OK stores the previewed Length, which the reopened dialog shows', async ({ page }) => {
    const dialog = await openSmaSettings(page);
    await previewLength(page, dialog, EDITED_LENGTH);

    await dialog.getByRole('button', { name: OK_BUTTON_LABEL, exact: true }).click();

    await expect(dialog).toBeHidden();
    const reopened = await reopenSmaSettings(page);
    expect(await lengthField(reopened).inputValue()).toBe(String(EDITED_LENGTH));
    await expect.poll(() => attachedLength(page)).toBe(EDITED_LENGTH);
  });

  test('an invalid draft previews nothing and keeps OK disabled', async ({ page }) => {
    const dialog = await openSmaSettings(page);

    await lengthField(dialog).fill(EMPTY_LENGTH);

    await expect(dialog.getByRole('button', { name: OK_BUTTON_LABEL, exact: true })).toBeDisabled();
    await expect.poll(() => attachedLength(page)).toBe(DEFAULT_LENGTH);
  });

  test('an untouched dialog waits out the preview pause and previews nothing', async ({ page }) => {
    await attachSma(page);
    const attached = await attachedIndicators(page);
    // The dialog's pause runs under the test's clock, so it is installed before the form opens.
    await page.clock.install();
    const dialog = await reopenSmaSettings(page);

    await page.clock.runFor(SETTLE_MS);

    expect(await attachedIndicators(page)).toEqual(attached);
    expect(await lengthField(dialog).inputValue()).toBe(String(DEFAULT_LENGTH));
  });
});
