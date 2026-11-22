import { expect, test, type Page } from '@playwright/test';
import type { SettingInputDefinition } from '../src/features/chart/engine/settings/settingInputs';
import { mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';
import { PLACEMENT } from './helpers/toolStyleFixtures';

/**
 * The app's drop-down (shared/ui/select/Select) as the drawing settings dialog uses it: an ARIA listbox opened from a
 * button, driven by mouse and keyboard, and used in place of the native select for the Inputs tab's string
 * options and the Style tab's choices.
 */

const MODE_INPUT = {
  kind: 'string',
  id: 'mode',
  title: 'Mode',
  defaultValue: 'volume',
  options: ['volume', 'trades', 'delta'],
} satisfies SettingInputDefinition;

const LENGTH_INPUT = {
  kind: 'int',
  id: 'length',
  title: 'Length',
  defaultValue: 20,
} satisfies SettingInputDefinition;

/** A choice the settings cannot calculate yet, and the reason it says so with. */
const DISABLED_REASON = 'Needs tick data — coming next';
const TIMEFRAME_INPUT = {
  kind: 'enum',
  id: 'timeframe',
  title: 'Timeframe',
  defaultValue: 'chart',
  options: [
    { value: 'chart', title: 'Chart' },
    { value: 'tick1', title: '1 tick', disabledReason: DISABLED_REASON },
    { value: 'm5', title: '5m' },
  ],
} satisfies SettingInputDefinition;

/** The Mode choices, in the order the list shows them. */
const MODE_OPTION_NAMES = ['volume', 'trades', 'delta'] as const;

/** The box the mounted form sits in, trimmed to hide whatever it overflows. */
const CLIPPING_BOX_CLASS = 'select-spec-clipping-box';
/** How far the box reaches below its first drop-down's button, so the open list must cross the box's edge. */
const CLIPPING_BOX_BELOW_BUTTON_PX = 8;
/** Room below the box for the list that opens under the button, without it having to flip above. */
const CLIPPED_LIST_VIEWPORT = { width: 600, height: 600 } as const;

const modeButton = (page: Page) => page.getByLabel('Mode', { exact: true });
const timeframeButton = (page: Page) => page.getByLabel('Timeframe', { exact: true });
const listbox = (page: Page) => page.getByRole('listbox');
const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });
const highlightedOption = (page: Page) => page.locator('.select-option[data-active="true"]');
const clippingBox = (page: Page) => page.locator(`.${CLIPPING_BOX_CLASS}`);

/** Trims the form's own box to just below its first drop-down, hiding everything that overflows it. */
async function clipFormBelowModeButton(page: Page): Promise<void> {
  await page.setViewportSize(CLIPPED_LIST_VIEWPORT);
  await page.evaluate(
    ({ boxClass, belowButtonPx }) => {
      const form = document.querySelector<HTMLElement>('.drawing-settings')!;
      const box = form.parentElement!;
      const button = form.querySelector<HTMLElement>('[aria-haspopup="listbox"]')!;
      const buttonBottom = button.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
      box.classList.add(boxClass);
      box.style.height = `${buttonBottom + belowButtonPx}px`;
      box.style.overflow = 'hidden';
    },
    { boxClass: CLIPPING_BOX_CLASS, belowButtonPx: CLIPPING_BOX_BELOW_BUTTON_PX },
  );
}

/** Whether a press at an option's centre lands on that option, which a clipped or covered one would miss. */
function optionIsHitAtCentre(page: Page, name: string): Promise<boolean> {
  return option(page, name).evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return hit !== null && element.contains(hit);
  });
}

test.beforeEach(async ({ page }) => {
  await mountSettingsForm(page, { inputs: [MODE_INPUT, LENGTH_INPUT], styles: [PLACEMENT] });
});

test('the Inputs options and the Style choices are custom drop-downs, never a native select', async ({ page }) => {
  await expect(modeButton(page)).toHaveAttribute('aria-haspopup', 'listbox');
  await page.getByRole('tab', { name: 'Style' }).click();
  await expect(page.getByLabel('Placement', { exact: true })).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(page.locator('select')).toHaveCount(0);
});

test('drawing settings drop-downs read at 14px, closed and open', async ({ page }) => {
  const settingsFontSize = '14px';
  await modeButton(page).click();
  await expect(listbox(page)).toHaveCSS('font-size', settingsFontSize);
  await expect(modeButton(page)).toHaveCSS('font-size', settingsFontSize);
});

test('a field writes its value at the size and weight of its label', async ({ page }) => {
  const label = page.locator('.drawing-settings-label').first();
  const labelFont = await label.evaluate((element) => {
    const { fontSize, fontWeight } = getComputedStyle(element);
    return { fontSize, fontWeight };
  });

  for (const field of [modeButton(page), page.getByLabel('Length', { exact: true })]) {
    await expect(field).toHaveCSS('font-size', labelFont.fontSize);
    await expect(field).toHaveCSS('font-weight', labelFont.fontWeight);
  }
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

test('a list in a box that hides its overflow floats over it, every option in the window and reachable', async ({
  page,
}) => {
  await clipFormBelowModeButton(page);
  await modeButton(page).click();

  const clippingBoxBounds = (await clippingBox(page).boundingBox())!;
  const listBounds = (await listbox(page).boundingBox())!;
  // The list hangs out of the box, so a clipped one would lose everything below the box's edge.
  expect(listBounds.y + listBounds.height).toBeGreaterThan(clippingBoxBounds.y + clippingBoxBounds.height);

  for (const name of MODE_OPTION_NAMES) {
    const optionBox = (await option(page, name).boundingBox())!;
    expect(optionBox.x).toBeGreaterThanOrEqual(0);
    expect(optionBox.y).toBeGreaterThanOrEqual(0);
    expect(optionBox.x + optionBox.width).toBeLessThanOrEqual(CLIPPED_LIST_VIEWPORT.width);
    expect(optionBox.y + optionBox.height).toBeLessThanOrEqual(CLIPPED_LIST_VIEWPORT.height);
    expect(await optionIsHitAtCentre(page, name)).toBe(true);
  }
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

test('a disabled option is listed with its reason and nothing selects it', async ({ page }) => {
  await mountSettingsForm(page, { inputs: [TIMEFRAME_INPUT] });
  await timeframeButton(page).click();

  const blocked = option(page, '1 tick');
  await expect(blocked).toHaveAttribute('aria-disabled', 'true');
  await expect(blocked).toHaveAttribute('title', DISABLED_REASON);
  await expect(timeframeButton(page)).toHaveText('Chart');

  // Home lands on the first open option and the arrow steps over the disabled one.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(highlightedOption(page)).toHaveText(/^5m/);

  // Typing the first letter of a disabled option leaves the highlight where it is.
  await page.keyboard.press('Home');
  await page.keyboard.press('1');
  await expect(highlightedOption(page)).toHaveText(/^Chart/);

  // Playwright refuses to click an aria-disabled option, so the press is forced to reach the list.
  await blocked.click({ force: true });
  await expect(listbox(page)).toBeVisible();
  await expect(timeframeButton(page)).toHaveText('Chart');
});
