import { expect, test, type Page } from '@playwright/test';
import type { SettingInputDefinition } from '../src/features/chart/engine/settings/settingInputs';
import { mountSettingsForm, savedValues } from './helpers/drawingSettingsPage';

/**
 * The Inputs tab's look: a quiet uppercase caption per group, checkbox-first bool rows, labels in the text
 * colour, controls left-aligned in a narrow control column, the (i) mark that shows an input's tooltip, and
 * the Defaults menu that rebuilds the draft from the declared defaults without saving it.
 */

const GROUP_NAME = 'Swings';
const DEPTH_TITLE = 'Depth';
const DEPTH_DEFAULT = 10;
const EDITED_DEPTH = 42;
const DEPTH_TOOLTIP = 'Bars on each side a swing must beat.';
const SHOW_SWINGS_TITLE = 'Show Swings';
const SWINGS_TOOLTIP = 'Marks a swing at every reversal of the given depth.';
const INFO_MARK_LABEL = 'Info';
const DEFAULTS_LABEL = 'Defaults';
const RESET_ROW_LABEL = 'Reset settings';
const OK_LABEL = 'OK';

/** The Inputs tab's own measures, and the pixel of slack a rendered layout is allowed. */
const ROW_GAP_PX = 16;
const CONTROL_COLUMN_WIDTH_PX = 160;
const LAYOUT_SLACK_PX = 1;
/** 'Show Swings' is far wider than this, so a title still fits between the checkbox and the mark. */
const MIN_TITLE_WIDTH_PX = 20;
/** A point of the window no control occupies, where a hover ends. */
const AWAY_FROM_FORM = { x: 2, y: 2 };

const DEPTH_INPUT = {
  kind: 'int',
  id: 'depth',
  title: DEPTH_TITLE,
  defaultValue: DEPTH_DEFAULT,
  tooltip: DEPTH_TOOLTIP,
} satisfies SettingInputDefinition;

const SHOW_SWINGS_INPUT = {
  kind: 'bool',
  id: 'showSwings',
  title: SHOW_SWINGS_TITLE,
  defaultValue: false,
  tooltip: SWINGS_TOOLTIP,
  group: GROUP_NAME,
} satisfies SettingInputDefinition;

/** One group holding a bool above a number: the two rows the layout cases measure. */
const GROUP_INPUTS = [SHOW_SWINGS_INPUT, { ...DEPTH_INPUT, group: GROUP_NAME }];

/** The colour a palette token resolves to, painted on a probe so the browser answers in its own notation. */
function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const { color } = getComputedStyle(probe);
    probe.remove();
    return color;
  }, token);
}

test('a group caption is uppercase, muted and not bold', async ({ page }) => {
  await mountSettingsForm(page, { inputs: GROUP_INPUTS });
  const caption = page.getByRole('group', { name: GROUP_NAME, exact: true }).locator('legend');
  await expect(caption).toHaveText(GROUP_NAME);

  const captionStyle = await caption.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { transform: computed.textTransform, weight: computed.fontWeight, colour: computed.color };
  });

  expect(captionStyle.transform).toBe('uppercase');
  expect(captionStyle.weight).toBe('400');
  expect(captionStyle.colour).toBe(await tokenColour(page, '--color-muted-strong'));
});

test('labels wear the text colour and controls stay in the narrow control column', async ({ page }) => {
  await mountSettingsForm(page, { inputs: GROUP_INPUTS });
  const label = page.locator('label.drawing-settings-label', { hasText: DEPTH_TITLE });
  await expect(label).toHaveCount(1);

  const labelColour = await label.evaluate((element) => getComputedStyle(element).color);
  expect(labelColour).toBe(await tokenColour(page, '--color-text'));

  const cell = await page.locator('.drawing-settings-control-cell').first().boundingBox();
  const boolRow = await page.locator('.drawing-settings-bool-row').first().boundingBox();
  if (cell === null || boolRow === null) {
    throw new Error('the group is missing its control column or its bool row');
  }
  expect(cell.width).toBeCloseTo(CONTROL_COLUMN_WIDTH_PX, 0);

  const rowGap = cell.y - (boolRow.y + boolRow.height);
  expect(rowGap).toBeGreaterThanOrEqual(ROW_GAP_PX - LAYOUT_SLACK_PX);
  expect(rowGap).toBeLessThanOrEqual(ROW_GAP_PX + LAYOUT_SLACK_PX);
});

test('a bool row puts the checkbox before its title, then its info mark', async ({ page }) => {
  await mountSettingsForm(page, { inputs: [SHOW_SWINGS_INPUT] });
  const row = page.locator('.drawing-settings-bool-row');
  const checkbox = row.getByRole('checkbox', { name: SHOW_SWINGS_TITLE, exact: true });
  const mark = row.getByRole('button', { name: INFO_MARK_LABEL, exact: true });

  const rowBox = await row.boundingBox();
  const checkboxBox = await checkbox.boundingBox();
  const markBox = await mark.boundingBox();
  if (rowBox === null || checkboxBox === null || markBox === null) {
    throw new Error('the bool row is missing its box, its checkbox or its info mark');
  }

  // The checkbox opens the row, and the title it names sits between the checkbox and the mark.
  expect(checkboxBox.x - rowBox.x).toBeLessThanOrEqual(LAYOUT_SLACK_PX);
  expect(markBox.x - (checkboxBox.x + checkboxBox.width)).toBeGreaterThan(MIN_TITLE_WIDTH_PX);
});

test('the info mark shows the tooltip on hover and on focus, and hides it again', async ({ page }) => {
  await mountSettingsForm(page, { inputs: [DEPTH_INPUT] });
  const mark = page.getByRole('button', { name: INFO_MARK_LABEL, exact: true });
  const bubble = page.locator('.drawing-settings-tooltip-bubble');
  await expect(bubble).toHaveCount(0);

  await mark.hover();
  await expect(bubble).toHaveText(DEPTH_TOOLTIP);
  await expect(bubble).toBeVisible();
  const markBox = await mark.boundingBox();
  const bubbleBox = await bubble.boundingBox();
  if (markBox === null || bubbleBox === null) {
    throw new Error('the tooltip or its mark has no box');
  }
  // The bubble floats above the mark, clear of it.
  expect(bubbleBox.y + bubbleBox.height).toBeLessThanOrEqual(markBox.y);

  await page.mouse.move(AWAY_FROM_FORM.x, AWAY_FROM_FORM.y);
  await expect(bubble).toHaveCount(0);

  await page.getByLabel(DEPTH_TITLE, { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(mark).toBeFocused();
  await expect(bubble).toHaveText(DEPTH_TOOLTIP);

  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);
});

test('Defaults resets the draft to the declared default, which OK then saves', async ({ page }) => {
  await mountSettingsForm(page, { inputs: [DEPTH_INPUT] });
  const depth = page.getByLabel(DEPTH_TITLE, { exact: true });
  await depth.fill(String(EDITED_DEPTH));

  await page.getByRole('button', { name: DEFAULTS_LABEL, exact: true }).click();
  await page.getByRole('menuitem', { name: RESET_ROW_LABEL, exact: true }).click();

  await expect(depth).toHaveValue(String(DEPTH_DEFAULT));

  await page.getByRole('button', { name: OK_LABEL, exact: true }).click();
  expect(await savedValues(page)).toEqual([{ depth: DEPTH_DEFAULT }]);
});
