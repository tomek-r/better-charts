import { expect, test, type Page } from '@playwright/test';
import type { ToolInputDefinition } from '../src/features/chart/engine/drawings/toolInputs';
import { mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import { PLACEMENT } from './helpers/toolStyleFixtures';

/**
 * The app's drop-down (shared/ui/Select) as the drawing settings dialog uses it: an ARIA listbox opened from a
 * button, driven by mouse and keyboard, and used in place of the native select for the Inputs tab's string
 * options and the Style tab's choices.
 */

const MODE_INPUT = {
  kind: 'string',
  id: 'mode',
  title: 'Mode',
  defaultValue: 'volume',
  options: ['volume', 'trades', 'delta'],
} satisfies ToolInputDefinition;

const modeButton = (page: Page) => page.getByLabel('Mode', { exact: true });
const listbox = (page: Page) => page.getByRole('listbox');
const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await mountSettingsForm(page, { inputs: [MODE_INPUT], styles: [PLACEMENT] });
});

test('the Inputs options and the Style choices are custom drop-downs, never a native select', async ({ page }) => {
  await expect(modeButton(page)).toHaveAttribute('aria-haspopup', 'listbox');
  await page.getByRole('tab', { name: 'Style' }).click();
  await expect(page.getByLabel('Placement', { exact: true })).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(page.locator('select')).toHaveCount(0);
});

test('drawing settings drop-downs read at 15px, closed and open', async ({ page }) => {
  const settingsFontSize = '15px';
  await modeButton(page).click();
  await expect(listbox(page)).toHaveCSS('font-size', settingsFontSize);
  await expect(modeButton(page)).toHaveCSS('font-size', settingsFontSize);
});

test('a click opens the list under the button with the chosen option marked', async ({ page }) => {
  const button = modeButton(page);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(listbox(page)).toHaveCount(0);

  await button.click();

  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(listbox(page)).toBeVisible();
  await expect(option(page, 'volume')).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'trades')).toHaveAttribute('aria-selected', 'false');
  await expect(option(page, 'volume').locator('.select-check')).toBeVisible();
  await expect(option(page, 'trades').locator('.select-check')).toBeHidden();
  const buttonBox = (await button.boundingBox())!;
  const listBox = (await listbox(page).boundingBox())!;
  expect(listBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
  expect(listBox.width).toBeGreaterThanOrEqual(buttonBox.width - 1);
});

for (const key of ['Enter', 'Space', 'ArrowDown', 'ArrowUp']) {
  test(`${key} opens the list from the keyboard`, async ({ page }) => {
    await modeButton(page).focus();
    await page.keyboard.press(key);
    await expect(listbox(page)).toBeVisible();
    await expect(listbox(page)).toBeFocused();
  });
}

test('arrows move the highlight and Enter selects it, returning focus to the button', async ({ page }) => {
  await modeButton(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', /option-1$/);
  await page.keyboard.press('Enter');

  await expect(listbox(page)).toHaveCount(0);
  await expect(modeButton(page)).toBeFocused();
  await expect(modeButton(page)).toHaveText('trades');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect((await savedValues(page))[0].mode).toBe('trades');
});

test('Home and End jump to the first and last option, and the ends do not wrap', async ({ page }) => {
  await modeButton(page).click();
  await page.keyboard.press('End');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', /option-2$/);
  await page.keyboard.press('ArrowDown');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', /option-2$/);
  await page.keyboard.press('Home');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', /option-0$/);
});

test('Space selects the highlighted option without reopening the list', async ({ page }) => {
  await modeButton(page).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');

  await expect(listbox(page)).toHaveCount(0);
  await expect(modeButton(page)).toHaveText('trades');
});

test('Escape closes the list without changing the value and returns focus to the button', async ({ page }) => {
  await modeButton(page).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');

  await expect(listbox(page)).toHaveCount(0);
  await expect(modeButton(page)).toBeFocused();
  await expect(modeButton(page)).toHaveText('volume');
});

test('typing the first letter of an option highlights it', async ({ page }) => {
  await modeButton(page).click();
  await page.keyboard.press('d');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', /option-2$/);
  await page.keyboard.press('t');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', /option-1$/);
  await page.keyboard.press('Enter');
  await expect(modeButton(page)).toHaveText('trades');
});

test('a click on an option selects it', async ({ page }) => {
  await modeButton(page).click();
  await option(page, 'delta').click();

  await expect(listbox(page)).toHaveCount(0);
  await expect(modeButton(page)).toHaveText('delta');
});

test('a press outside the list closes it and Tab closes it too', async ({ page }) => {
  await modeButton(page).click();
  await page.getByRole('tablist').click();
  await expect(listbox(page)).toHaveCount(0);
  await expect(modeButton(page)).toHaveText('volume');

  await modeButton(page).click();
  await page.keyboard.press('Tab');
  await expect(listbox(page)).toHaveCount(0);
});

test('with no room below the list opens above the button', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 420 });
  await page.evaluate(() => {
    const form = document.querySelector<HTMLElement>('.drawing-settings');
    form!.style.marginTop = '300px';
  });
  await modeButton(page).click();

  const buttonBox = (await modeButton(page).boundingBox())!;
  const listBox = (await listbox(page).boundingBox())!;
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(buttonBox.y);
});

test('a select its activeWhen condition locks is disabled and does not open', async ({ page }) => {
  await mountSettingsForm(page, {
    inputs: [
      { kind: 'bool', id: 'custom', title: 'Custom', defaultValue: false },
      { ...MODE_INPUT, activeWhen: { inputId: 'custom', equals: true } },
    ],
  });
  await expect(modeButton(page)).toBeDisabled();

  await modeButton(page).click({ force: true });
  await expect(listbox(page)).toHaveCount(0);

  await page.getByLabel('Custom', { exact: true }).check();
  await expect(modeButton(page)).toBeEnabled();
});
