import { expect, test, type Locator, type Page } from '@playwright/test';
import { bidAskDrawingModeOf, bidAskDrawingsOf } from '../src/features/chart/scalesAndLinesMenu/bidAskDrawingMode';
import { palette } from '../src/shared/theme/palette';
import { OBJECT_SETTINGS_ICON_PATHS } from '../src/shared/ui/icons/objectSettingsIcon';
import { openScalesAndLinesMenu } from './helpers/chartMenu';
import { chartScalesState } from './helpers/chartScalesState';
import { chartSettingsDialog } from './helpers/chartSettingsDialog';
import { libraryPriceScale } from './helpers/libraryPriceScale';
import { openChart } from './helpers/openChart';
import { savedOverrides } from './helpers/savedOverrides';
import { chartScopeKey, expectNoErrors, gotoWithStub, stubChartSettingOverrides } from './helpers/tauriStub';
import { focusScratchTextField } from './helpers/textFieldFocus';

/**
 * The Scales and lines menu the gear in the chart's bottom-right corner opens: the scale's view commands, the
 * shape it saves, the submenus of what the price labels and lines draw, and the way into the dialog. Every row
 * is read back both as the chart draws it (through the DEV test hook) and as the backend stored it.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** `PriceScaleMode.Logarithmic`, as the library's own options report it. */
const LOGARITHMIC_MODE = 1;
/** The auto scale's row, whose label is too long to repeat at every lookup. */
const AUTO_ROW_LABEL = 'Auto (fits data to screen)';
/** The room the anchored panel keeps between the menu and the chart frame's edges. */
const PANEL_EDGE_MARGIN = 8;
/** The label of every row of one level: the menu's rows and a submenu's are the level's own children. */
const ROW_LABELS = ':scope > .scales-and-lines-menu-row > .chart-context-menu-label';
/** The menu's rows as the chart opens it, the reset command included: the scale is not fitted to the data yet. */
const MENU_ROW_LABELS = [
  'Reset price scale',
  AUTO_ROW_LABEL,
  'Invert scale',
  'Regular',
  'Logarithmic',
  'Labels',
  'Lines',
  'More settings',
];
/** The rows each submenu draws, in the order they are drawn. */
const SUBMENU_ROW_LABELS: Readonly<Record<'Labels' | 'Lines', readonly string[]>> = {
  Labels: ['Symbol name label', 'Bid and ask labels', 'Countdown to bar close'],
  Lines: ['Bid and ask lines'],
};

/** The gear the engine draws in the corner where the price axis meets the time axis. */
const gear = (page: Page) => page.getByRole('button', { name: 'Chart settings', exact: true });

/** The auto scale as the scale holds it, which the chart opens with off. */
async function autoScale(page: Page): Promise<boolean> {
  return (await libraryPriceScale(page)).autoScale;
}

/** Moves the pointer onto the right price axis, which reveals the A and L toggles. */
async function hoverPriceAxis(page: Page): Promise<void> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.move(host.x + host.width - 20, host.y + host.height / 2);
}

/** Fits the scale to the data through the A toggle on the price axis, which the chart opens with that off. */
async function turnAutoScaleOn(page: Page): Promise<void> {
  await hoverPriceAxis(page);
  await page.getByRole('button', { name: /^Auto scale/ }).click();
  await expect.poll(() => autoScale(page)).toBe(true);
}

/** The box of an element on the page, which every geometry check below reads. */
async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await locator.boundingBox())!;
}

/** Opens the menu and the Labels submenu hanging beside it, and returns that submenu. */
async function openLabelsSubmenu(page: Page): Promise<Locator> {
  const menu = await openScalesAndLinesMenu(page);
  await menu.getByRole('menuitem', { name: 'Labels' }).click();
  const submenu = page.getByRole('menu', { name: 'Labels', exact: true });
  await expect(submenu).toBeVisible();
  return submenu;
}

/** How many line boxes a label's text covers: one line unless the row wrapped it onto a second. */
function textLineCount(label: Locator): Promise<number> {
  return label.evaluate((element) => {
    const textRange = document.createRange();
    textRange.selectNodeContents(element);
    return textRange.getClientRects().length;
  });
}

/** Every row of the level draws the expected label, and no label runs onto a second line. */
async function expectRowsOnOneLine(level: Locator, labels: readonly string[]): Promise<void> {
  const rowLabels = level.locator(ROW_LABELS);
  await expect(rowLabels).toHaveText([...labels]);
  for (const rowLabel of await rowLabels.all()) {
    expect(await textLineCount(rowLabel)).toBe(1);
  }
}

test('the gear opens the menu above itself, in the price scale order', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  // With the scale fitted to its data there is nothing to reset, so the menu opens on its own first command.
  await turnAutoScaleOn(page);

  const menu = await openScalesAndLinesMenu(page);
  const menuBox = await box(menu);
  const gearBox = await box(gear(page));
  const frameBox = await box(page.locator('.chart-frame'));
  // Hung above the gear, wholly inside the chart frame.
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(gearBox.y);
  expect(menuBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(menuBox.y).toBeGreaterThanOrEqual(frameBox.y);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height);
  // Its right edge on the gear's, as far as the panel's own margin from the frame's edge allows: the gear
  // touches that edge, and the panel keeps its box PANEL_EDGE_MARGIN inside it.
  const insetFromGearRight = gearBox.x + gearBox.width - (menuBox.x + menuBox.width);
  expect(insetFromGearRight).toBeGreaterThanOrEqual(0);
  expect(insetFromGearRight).toBeLessThanOrEqual(PANEL_EDGE_MARGIN + 1);

  const labels = menu.locator(ROW_LABELS);
  await expect(labels).toHaveText([
    AUTO_ROW_LABEL,
    'Invert scale',
    'Regular',
    'Logarithmic',
    'Labels',
    'Lines',
    'More settings',
  ]);
  const autoRow = menu.getByRole('menuitemcheckbox', { name: AUTO_ROW_LABEL });
  const invertRow = menu.getByRole('menuitemcheckbox', { name: /^Invert scale/ });
  const regularRow = menu.getByRole('menuitemradio', { name: 'Regular' });
  const logarithmicRow = menu.getByRole('menuitemradio', { name: /^Logarithmic/ });
  await expect(autoRow).toHaveAttribute('aria-checked', 'true');
  await expect(invertRow).toHaveAttribute('aria-checked', 'false');
  await expect(regularRow).toHaveAttribute('aria-checked', 'true');
  await expect(logarithmicRow).toHaveAttribute('aria-checked', 'false');
  await expect(menu.getByRole('menuitem', { name: 'Labels' })).toHaveAttribute('aria-haspopup', 'menu');
  await expect(menu.getByRole('menuitem', { name: 'Lines' })).toHaveAttribute('aria-haspopup', 'menu');
  await expect(menu.getByRole('separator')).toHaveCount(3);
  expectNoErrors(collected);
});

test('the gear draws the settings icon the drawing toolbar and the Object tree draw', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const drawn = await gear(page)
    .locator('svg path')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('d')));

  // Both hexagon subpaths in one `d`, exactly the outline the shared settings icon holds.
  expect(drawn).toEqual([OBJECT_SETTINGS_ICON_PATHS.join(' ')]);
  expectNoErrors(collected);
});

test('every row of the menu and of both submenus keeps its label on one line', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  await expectRowsOnOneLine(menu, MENU_ROW_LABELS);

  for (const [name, labels] of Object.entries(SUBMENU_ROW_LABELS)) {
    await menu.getByRole('menuitem', { name }).click();
    const submenu = page.getByRole('menu', { name, exact: true });
    await expect(submenu).toBeVisible();
    await expectRowsOnOneLine(submenu, labels);
    // Escape closes the submenu alone, back onto the row that opened it, and leaves the menu to be walked on.
    await page.keyboard.press('Escape');
  }
  expectNoErrors(collected);
});

test('the reset row appears once auto scale is off, and fits the data again', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await turnAutoScaleOn(page);
  const autoButton = page.getByRole('button', { name: /^Auto scale/ });
  await expect(autoButton).toHaveAttribute('aria-pressed', 'true');

  await autoButton.click();
  await expect.poll(() => autoScale(page)).toBe(false);

  const menu = await openScalesAndLinesMenu(page);
  const reset = menu.getByRole('menuitem', { name: /^Reset price scale/ });
  await expect(reset).toContainText('Ctrl+R');

  await reset.click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => autoScale(page)).toBe(true);
  expectNoErrors(collected);
});

test('the auto row toggles the fitting of the scale', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  const autoRow = menu.getByRole('menuitemcheckbox', { name: AUTO_ROW_LABEL });
  await expect(autoRow).toHaveAttribute('aria-checked', 'false');

  await autoRow.click();

  await expect(menu).toHaveCount(0);
  await expect.poll(() => autoScale(page)).toBe(true);
  const reopened = await openScalesAndLinesMenu(page);
  const reopenedAutoRow = reopened.getByRole('menuitemcheckbox', { name: AUTO_ROW_LABEL });
  await expect(reopenedAutoRow).toHaveAttribute('aria-checked', 'true');
  // Fitting the scale is a view of the chart, not one of its saved settings.
  expect(await savedOverrides(page)).toEqual([]);
  expectNoErrors(collected);
});

test('the invert row saves the flag and turns the scale over', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  const overrides = { scales: { invertScale: true } };

  await menu.getByRole('menuitemcheckbox', { name: /^Invert scale/ }).click();

  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await libraryPriceScale(page)).invertScale).toBe(true);
  expect((await chartScalesState(page)).invertScale).toBe(true);
  expect(await savedOverrides(page)).toEqual([overrides]);
  expect(await stubChartSettingOverrides(page)).toEqual({ [EURUSD_CHART]: overrides });
  expectNoErrors(collected);
});

test('the logarithmic row saves the mode the L toggle then shows', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);

  await menu.getByRole('menuitemradio', { name: /^Logarithmic/ }).click();

  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await libraryPriceScale(page)).mode).toBe(LOGARITHMIC_MODE);
  expect(await savedOverrides(page)).toEqual([{ scales: { priceScaleMode: 'logarithmic' } }]);
  await hoverPriceAxis(page);
  const logButton = page.getByRole('button', { name: /^Logarithmic/ });
  await expect(logButton).toHaveAttribute('aria-pressed', 'true');
  expectNoErrors(collected);
});

test('the Labels submenu opens to the left of the menu', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const menu = await openScalesAndLinesMenu(page);
  const labelsRow = menu.getByRole('menuitem', { name: 'Labels' });
  await labelsRow.click();
  const submenu = page.getByRole('menu', { name: 'Labels', exact: true });
  await expect(submenu).toBeVisible();
  const menuBox = await box(menu);
  const submenuBox = await box(submenu);
  const rowBox = await box(labelsRow);
  const frameBox = await box(page.locator('.chart-frame'));
  // The gear sits against the frame's right edge, so the submenu has no room there and opens to the left.
  expect(submenuBox.x + submenuBox.width).toBeLessThanOrEqual(menuBox.x + 1);
  expect(Math.abs(submenuBox.y - rowBox.y)).toBeLessThanOrEqual(1);
  expect(submenuBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(submenuBox.y + submenuBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height);
  expectNoErrors(collected);
});

test('hovering another row closes the open submenu, and the other submenu row takes over', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  const labelsRow = menu.getByRole('menuitem', { name: 'Labels' });
  const linesRow = menu.getByRole('menuitem', { name: 'Lines' });
  const labelsSubmenu = page.getByRole('menu', { name: 'Labels', exact: true });
  const linesSubmenu = page.getByRole('menu', { name: 'Lines', exact: true });

  await labelsRow.hover();
  await expect(labelsSubmenu).toBeVisible();
  await expect(labelsRow).toHaveAttribute('aria-expanded', 'true');

  // A row that carries no submenu closes the open one at once, without closing the menu around it.
  await menu.getByRole('menuitemcheckbox', { name: /^Invert scale/ }).hover();
  await expect(labelsSubmenu).toHaveCount(0);
  await expect(labelsRow).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeVisible();

  // The other row that carries a submenu takes over, and the first one takes over again.
  await linesRow.hover();
  await expect(linesSubmenu).toBeVisible();
  await expect(labelsSubmenu).toHaveCount(0);
  await expect(linesRow).toHaveAttribute('aria-expanded', 'true');
  await expect(labelsRow).toHaveAttribute('aria-expanded', 'false');

  await labelsRow.hover();
  await expect(labelsSubmenu).toBeVisible();
  await expect(linesSubmenu).toHaveCount(0);
  await expect(labelsRow).toHaveAttribute('aria-expanded', 'true');
  await expect(linesRow).toHaveAttribute('aria-expanded', 'false');
  expectNoErrors(collected);
});

test('the submenu stays open while the pointer is over it', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  const submenu = page.getByRole('menu', { name: 'Labels', exact: true });

  await menu.getByRole('menuitem', { name: 'Labels' }).hover();
  await expect(submenu).toBeVisible();

  // The submenu hangs beside its row, so the pointer into one of its rows is over neither the menu nor a
  // row of it, and both stay as they are.
  await submenu.getByRole('menuitemcheckbox', { name: 'Countdown to bar close' }).hover();
  await expect(submenu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Labels' })).toHaveAttribute('aria-expanded', 'true');

  // Back onto the row the submenu hangs from, which keeps it open too.
  await menu.getByRole('menuitem', { name: 'Labels' }).hover();
  await expect(submenu).toBeVisible();
  await expect(menu).toBeVisible();
  expectNoErrors(collected);
});

test('a hover opens the submenu without moving the focus into it', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  // The scale is not fitted to the data yet, so the menu opens on its reset row.
  const firstRow = menu.getByRole('menuitem', { name: /^Reset price scale/ });

  await menu.getByRole('menuitem', { name: 'Labels' }).hover();

  const submenu = page.getByRole('menu', { name: 'Labels', exact: true });
  await expect(submenu).toBeVisible();
  // The hover leaves the focus on the row the menu opened with, so no row of the submenu is focused and no
  // focus ring is drawn on one the user never reached with the keys.
  await expect(firstRow).toBeFocused();
  expect(await submenu.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  expectNoErrors(collected);
});

test('the Labels submenu boxes save the labels, the quote and the countdown', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const symbolName = await openLabelsSubmenu(page);
  await symbolName.getByRole('menuitemcheckbox', { name: 'Symbol name label' }).click();
  await expect.poll(async () => (await chartScalesState(page)).symbolNameLabelVisible).toBe(true);

  const quoteLabels = await openLabelsSubmenu(page);
  const symbolBox = quoteLabels.getByRole('menuitemcheckbox', { name: 'Symbol name label' });
  await expect(symbolBox).toHaveAttribute('aria-checked', 'true');
  // Turning the labels off keeps the lines the quote draws.
  await quoteLabels.getByRole('menuitemcheckbox', { name: 'Bid and ask labels' }).click();
  await expect.poll(async () => (await chartScalesState(page)).bidAsk.labelsVisible).toBe(false);

  const countdown = await openLabelsSubmenu(page);
  await countdown.getByRole('menuitemcheckbox', { name: 'Countdown to bar close' }).click();
  await expect.poll(async () => (await chartScalesState(page)).countdownVisible).toBe(false);

  const labelLines = { mode: 'line', bid: palette.sell, ask: palette.buy } as const;
  expect(await savedOverrides(page)).toEqual([
    { scales: { symbolNameLabel: true } },
    { scales: { symbolNameLabel: true, bidAsk: labelLines } },
    { scales: { symbolNameLabel: true, bidAsk: labelLines, countdown: false } },
  ]);
  expectNoErrors(collected);
});

test('the Lines submenu saves the labels-only quote', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);
  await menu.getByRole('menuitem', { name: 'Lines' }).click();
  const submenu = page.getByRole('menu', { name: 'Lines', exact: true });
  const linesBox = submenu.getByRole('menuitemcheckbox', { name: 'Bid and ask lines' });
  await expect(linesBox).toHaveAttribute('aria-checked', 'true');

  await linesBox.click();

  await expect(submenu).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await chartScalesState(page)).bidAsk.linesVisible).toBe(false);
  const bidAsk = { mode: 'label', bid: palette.sell, ask: palette.buy };
  expect(await savedOverrides(page)).toEqual([{ scales: { bidAsk } }]);
  expectNoErrors(collected);
});

test('the settings row opens the dialog on the Scales and lines tab', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const menu = await openScalesAndLinesMenu(page);

  await menu.getByRole('menuitem', { name: 'More settings' }).click();

  await expect(menu).toHaveCount(0);
  const dialog = chartSettingsDialog(page);
  await expect(dialog).toBeVisible();
  const scalesTab = dialog.getByRole('tab', { name: 'Scales and lines' });
  await expect(scalesTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Price scale', exact: true })).toBeVisible();
  expectNoErrors(collected);
});

test('the arrow keys walk the menu and Escape closes back to the gear', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await turnAutoScaleOn(page);
  const menu = await openScalesAndLinesMenu(page);
  const autoRow = menu.getByRole('menuitemcheckbox', { name: AUTO_ROW_LABEL });
  const invertRow = menu.getByRole('menuitemcheckbox', { name: /^Invert scale/ });
  const regularRow = menu.getByRole('menuitemradio', { name: 'Regular' });
  const logarithmicRow = menu.getByRole('menuitemradio', { name: /^Logarithmic/ });
  const labelsRow = menu.getByRole('menuitem', { name: 'Labels' });
  const settingsRow = menu.getByRole('menuitem', { name: 'More settings' });

  // The first row takes the focus, and the arrows walk the rows both ways, wrapping at the ends.
  await expect(autoRow).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(invertRow).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(autoRow).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(settingsRow).toBeFocused();
  await page.keyboard.press('Home');
  await expect(autoRow).toBeFocused();
  await page.keyboard.press('End');
  await expect(settingsRow).toBeFocused();

  await page.keyboard.press('Home');
  for (const row of [invertRow, regularRow, logarithmicRow, labelsRow]) {
    await page.keyboard.press('ArrowDown');
    await expect(row).toBeFocused();
  }

  // Right opens the submenu the row carries and moves into it; Escape closes it back onto its row.
  await page.keyboard.press('ArrowRight');
  const submenu = page.getByRole('menu', { name: 'Labels', exact: true });
  await expect(submenu).toBeVisible();
  const firstBox = submenu.getByRole('menuitemcheckbox').first();
  const secondBox = submenu.getByRole('menuitemcheckbox', { name: 'Bid and ask labels' });
  await expect(firstBox).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(secondBox).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(submenu).toHaveCount(0);
  await expect(labelsRow).toBeFocused();
  await expect(labelsRow).toHaveAttribute('aria-expanded', 'false');

  // The second Escape closes the menu and hands the focus back to the gear that opened it.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(gear(page)).toBeFocused();
  expectNoErrors(collected);
});

test('Alt+I and Alt+L save the scale, and stand aside for a text field', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const inverted = { scales: { invertScale: true } };
  const invertedAndLogarithmic = { scales: { invertScale: true, priceScaleMode: 'logarithmic' } };

  await page.keyboard.press('Alt+I');
  await expect.poll(async () => (await chartScalesState(page)).invertScale).toBe(true);
  await page.keyboard.press('Alt+L');
  await expect.poll(async () => (await libraryPriceScale(page)).mode).toBe(LOGARITHMIC_MODE);
  expect(await savedOverrides(page)).toEqual([inverted, invertedAndLogarithmic]);

  // A field the user types into keeps the keys to itself.
  await focusScratchTextField(page);
  await page.keyboard.press('Alt+I');
  await page.keyboard.press('Alt+L');

  expect(await savedOverrides(page)).toEqual([inverted, invertedAndLogarithmic]);
  expect((await chartScalesState(page)).invertScale).toBe(true);
  expect((await libraryPriceScale(page)).mode).toBe(LOGARITHMIC_MODE);
  expectNoErrors(collected);
});

for (const { platform, invert, logarithmic, reset } of [
  { platform: 'macos', invert: '⌥I', logarithmic: '⌥L', reset: '⌥R' },
  { platform: 'linux', invert: 'Alt+I', logarithmic: 'Alt+L', reset: 'Ctrl+R' },
] as const) {
  test.describe(`on ${platform}`, () => {
    test(`the rows name ${invert}, ${logarithmic} and ${reset}`, async ({ page }) => {
      const collected = await gotoWithStub(page, { platform });
      await openChart(page);
      // The reset row is offered while the scale is not fitted to the data, which is how the chart opens.
      await expect.poll(() => autoScale(page)).toBe(false);

      const menu = await openScalesAndLinesMenu(page);
      const resetRow = menu.getByRole('menuitem', { name: /^Reset price scale/ });
      const invertRow = menu.getByRole('menuitemcheckbox', { name: /^Invert scale/ });
      const logarithmicRow = menu.getByRole('menuitemradio', { name: /^Logarithmic/ });
      await expect(resetRow).toContainText(reset);
      await expect(invertRow).toContainText(invert);
      await expect(logarithmicRow).toContainText(logarithmic);
      expectNoErrors(collected);
    });
  });
}

test('the four line and label pairs are stored as the four quote drawings', () => {
  const pairs = [
    { drawings: { lines: true, labels: true }, mode: 'lineAndLabel' },
    { drawings: { lines: true, labels: false }, mode: 'line' },
    { drawings: { lines: false, labels: true }, mode: 'label' },
    { drawings: { lines: false, labels: false }, mode: 'hidden' },
  ] as const;

  for (const { drawings, mode } of pairs) {
    expect(bidAskDrawingModeOf(drawings)).toBe(mode);
    expect(bidAskDrawingsOf(mode)).toEqual(drawings);
  }
});
