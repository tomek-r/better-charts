import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountSettingsForm } from './helpers/drawingSettingsPage';
import { openSymbolSearch } from './helpers/panel';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * Every form field shows exactly one focus indicator: its own border turning accent, with no outline
 * and no ring. The accent is resolved by the browser, so the check does not depend on the token's format.
 */

/** The accent token as the browser computes it for a border colour. */
async function accentBorderColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.borderColor = 'var(--color-accent)';
    probe.style.borderStyle = 'solid';
    document.body.append(probe);
    const color = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return color;
  });
}

async function expectSingleAccentBorder(page: Page, field: Locator): Promise<void> {
  await field.focus();
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS('outline-style', 'none');
  await expect(field).toHaveCSS('box-shadow', 'none');
  await expect(field).toHaveCSS('border-top-color', await accentBorderColor(page));
}

test('the app settings Address field shows only an accent border when focused', async ({ page }) => {
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await expectSingleAccentBorder(page, dialog.getByLabel('Address', { exact: true }));
});

test('a drawing settings number field shows only an accent border when focused', async ({ page }) => {
  await mountSettingsForm(page);
  await expectSingleAccentBorder(page, page.getByLabel('Bars', { exact: true }));
});

test('the symbol search input shows only an accent border when focused', async ({ page }) => {
  await gotoWithStub(page);
  const { input } = await openSymbolSearch(page);
  await expectSingleAccentBorder(page, input);
});
