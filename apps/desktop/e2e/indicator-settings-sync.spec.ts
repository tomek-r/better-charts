import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SavedIndicator } from '../src/features/chart/chartSettings/savedIndicators';
import { indicatorSettingsSchema } from '../src/features/chart/engine/indicators/indicatorDisplaySettings';
import type { AttachedIndicatorState } from '../src/features/chart/engine/indicators/indicatorRuntime';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { rsiPlugin } from '../src/features/indicators/rsi/rsiPlugin';
import { syncIndicators } from '../src/features/indicators/syncIndicators';
import { drawnIndicators } from './helpers/indicatorFrames';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openWithSavedIndicators } from './helpers/savedIndicators';

/**
 * Editing an indicator's settings is an edit of that instance, not a fresh attach: the chart reloads it where it
 * is, so it keeps its own pane, the pane keeps the choices made on it, and the indicators below keep their place.
 * Cancel puts the stored settings back the same way. The unit cases below pin the sync down to those two calls.
 */

/** The instance and the definition of the RSI these cases edit, and of the MACD below it. */
const RSI_INSTANCE_ID = 'rsi-1';
const RSI_DEFINITION_ID = 'rsi';
const MACD_INSTANCE_ID = 'macd-1';
const MACD_DEFINITION_ID = 'macd';

/** The panes the two saved indicators open in: the RSI first, then the MACD under it. */
const RSI_PANE = 1;
const MACD_PANE = 2;

/** The default Length the RSI starts on, and the one the cases type over it. */
const STORED_LENGTH = 14;
const EDITED_LENGTH = 22;

/** The names the RSI settings dialog and its Length field go by. */
const RSI_SHORT_TITLE = 'RSI';
const RSI_DIALOG_NAME = 'Relative Strength Index settings';
const INPUTS_TAB_LABEL = 'Inputs';
const LENGTH_LABEL = 'Length';
/** The key the RSI stores its Length under, which the resolved settings carry too. */
const LENGTH_SETTING_ID = 'length';

/** The legend an own-pane indicator writes its row in, and the button that opens that row's settings. */
const PANE_LEGEND_LABEL = 'Indicator pane legend';
const LEGEND_ROW_SELECTOR = '.chart-indicator-legend-row';
const SETTINGS_BUTTON_LABEL = 'Indicator settings';

/** The first indicator pane's own `A` row and the auto scale button it offers. */
const INDICATOR_PANE_ROW = 'Indicator price scale';
const PANE_AUTO_LABEL = 'Auto scale — fit this pane';
const REVEALED_ROW_CLASS = /price-scale-controls-revealed/;

/** Deep inside the axis column, which a scale showing labels is wider than. */
const AXIS_INSET = 4;
/** A little below the price pane's own bottom, which is the top of the first indicator pane. */
const FIRST_PANE_INSET = 12;

const OK_LABEL = 'OK';
const CANCEL_LABEL = 'Cancel';

/** The two indicators the page cases boot with, both on their stored defaults. */
const SAVED_RSI: SavedIndicator = { instanceId: RSI_INSTANCE_ID, definitionId: RSI_DEFINITION_ID, settings: {} };
const SAVED_MACD: SavedIndicator = { instanceId: MACD_INSTANCE_ID, definitionId: MACD_DEFINITION_ID, settings: {} };

/** The pane the display layer draws indicator `instanceId` in. */
async function paneIndexOf(page: Page, instanceId: string): Promise<number | undefined> {
  const drawn = await drawnIndicators(page);
  return drawn.find((indicator) => indicator.id === instanceId)?.paneIndex;
}

/** Whether pane `paneIndex` fits its data itself, which is what its own `A` button switches. */
async function paneAutoScale(page: Page, paneIndex: number): Promise<boolean | undefined> {
  const scale = await page.evaluate((index) => window.__chartTest!.paneScale(index), paneIndex);
  return scale?.autoScale;
}

/** The Length the runtime resolved for `instanceId`, which a preview already moves and a revert puts back. */
async function shownLength(page: Page, instanceId: string): Promise<unknown> {
  const attached = await attachedIndicators(page);
  return attached.find((indicator) => indicator.instanceId === instanceId)?.settings[LENGTH_SETTING_ID];
}

/** Boots the app with the saved RSI and MACD and waits for the two panes they open in. */
async function openWithTwoIndicators(page: Page): Promise<void> {
  await openWithSavedIndicators(page, [SAVED_RSI, SAVED_MACD]);
  await expect.poll(() => paneIndexOf(page, RSI_INSTANCE_ID)).toBe(RSI_PANE);
  await expect.poll(() => paneIndexOf(page, MACD_INSTANCE_ID)).toBe(MACD_PANE);
}

/** Opens the RSI settings from the row its pane's legend writes. */
async function openRsiSettings(page: Page): Promise<Locator> {
  const legendRow = page
    .getByLabel(PANE_LEGEND_LABEL, { exact: true })
    .filter({ hasText: RSI_SHORT_TITLE })
    .locator(LEGEND_ROW_SELECTOR);
  await legendRow.hover();
  await legendRow.getByRole('button', { name: SETTINGS_BUTTON_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: RSI_DIALOG_NAME });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Types `length` into the open dialog's Inputs tab and waits for the chart to show the draft. */
async function editLength(page: Page, dialog: Locator, length: number): Promise<void> {
  await dialog.getByRole('tab', { name: INPUTS_TAB_LABEL, exact: true }).click();
  await dialog.getByRole('spinbutton', { name: LENGTH_LABEL, exact: true }).fill(String(length));
  await expect.poll(() => shownLength(page, RSI_INSTANCE_ID)).toBe(length);
}

/** The point of the axis column that belongs to the first indicator pane. */
async function firstIndicatorAxisPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ axisInset, paneInset }) => {
      const host = document.querySelector('.chart-host');
      if (host === null) {
        throw new Error('the chart host is missing');
      }
      const box = host.getBoundingClientRect();
      const { paneHeight } = window.__chartTest!.priceScale();
      return { x: box.right - axisInset, y: box.top + paneHeight + paneInset };
    },
    { axisInset: AXIS_INSET, paneInset: FIRST_PANE_INSET },
  );
}

/** Presses the first indicator pane's `A`, and answers the auto scale that pane now has. */
async function choosePaneAutoScale(page: Page): Promise<boolean> {
  const point = await firstIndicatorAxisPoint(page);
  await page.mouse.move(point.x, point.y);
  // The first such row in DOM order is the one the chart placed on the first indicator pane.
  const row = page.getByRole('group', { name: INDICATOR_PANE_ROW, exact: true }).first();
  await expect(row).toHaveClass(REVEALED_ROW_CLASS);
  const chosen = !(await paneAutoScale(page, RSI_PANE));
  await row.getByRole('button', { name: PANE_AUTO_LABEL }).click();
  await expect.poll(() => paneAutoScale(page, RSI_PANE)).toBe(chosen);
  return chosen;
}

test.describe('editing a saved indicator', () => {
  failOnPageNoise();

  test('an edit saved with OK keeps both panes and the choice made on the RSI pane', async ({ page }) => {
    await openWithTwoIndicators(page);
    const autoScale = await choosePaneAutoScale(page);

    const dialog = await openRsiSettings(page);
    await editLength(page, dialog, EDITED_LENGTH);
    await dialog.getByRole('button', { name: OK_LABEL, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => shownLength(page, RSI_INSTANCE_ID)).toBe(EDITED_LENGTH);
    await expect.poll(() => paneIndexOf(page, RSI_INSTANCE_ID)).toBe(RSI_PANE);
    await expect.poll(() => paneIndexOf(page, MACD_INSTANCE_ID)).toBe(MACD_PANE);
    await expect.poll(() => paneAutoScale(page, RSI_PANE)).toBe(autoScale);
  });

  test('Cancel puts the stored length back and moves no pane', async ({ page }) => {
    await openWithTwoIndicators(page);

    const dialog = await openRsiSettings(page);
    await editLength(page, dialog, EDITED_LENGTH);
    await dialog.getByRole('button', { name: CANCEL_LABEL, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect.poll(() => shownLength(page, RSI_INSTANCE_ID)).toBe(STORED_LENGTH);
    await expect.poll(() => paneIndexOf(page, RSI_INSTANCE_ID)).toBe(RSI_PANE);
    await expect.poll(() => paneIndexOf(page, MACD_INSTANCE_ID)).toBe(MACD_PANE);
  });
});

/** What a fake runtime records of the sync: every call by name, and what each `setSettings` was given. */
interface FakeRuntime {
  readonly calls: string[];
  readonly storedPassed: unknown[];
  readonly runtime: Parameters<typeof syncIndicators>[0];
}

/** A runtime over the instances it reports as attached, recording what the sync asks of it. */
function fakeRuntime(attached: readonly AttachedIndicatorState[]): FakeRuntime {
  const calls: string[] = [];
  const storedPassed: unknown[] = [];
  const runtime: Parameters<typeof syncIndicators>[0] = {
    attachedState: () => [...attached],
    attach: (instanceId: string, definitionId: string) => {
      calls.push(`attach ${instanceId} ${definitionId}`);
      return true;
    },
    detach: (instanceId: string) => {
      calls.push(`detach ${instanceId}`);
    },
    setSettings: (instanceId: string, stored: unknown) => {
      calls.push(`setSettings ${instanceId}`);
      storedPassed.push(stored);
    },
    setHidden: (instanceId: string, hidden: boolean) => {
      calls.push(`setHidden ${instanceId} ${hidden}`);
    },
  };
  return { calls, storedPassed, runtime };
}

/** The RSI as the runtime reports it, with the settings the schema resolves `stored` to. */
function attachedRsi(stored: SettingValues): AttachedIndicatorState {
  const settings = resolveSettingValues(indicatorSettingsSchema(rsiPlugin), stored);
  return { instanceId: RSI_INSTANCE_ID, definitionId: RSI_DEFINITION_ID, settings, hidden: false };
}

test.describe('the indicator sync', () => {
  test('leaves an instance whose resolved settings are unchanged alone', () => {
    const fake = fakeRuntime([attachedRsi(SAVED_RSI.settings)]);

    syncIndicators(fake.runtime, [SAVED_RSI]);

    expect(fake.calls).toEqual([`setHidden ${RSI_INSTANCE_ID} false`]);
  });

  test('reloads an edited instance where it is, without attaching it again', () => {
    const edited: SavedIndicator = { ...SAVED_RSI, settings: { length: EDITED_LENGTH } };
    const fake = fakeRuntime([attachedRsi(SAVED_RSI.settings)]);

    syncIndicators(fake.runtime, [edited]);

    expect(fake.calls).toEqual([`setSettings ${RSI_INSTANCE_ID}`, `setHidden ${RSI_INSTANCE_ID} false`]);
    expect(fake.storedPassed).toEqual([edited.settings]);
  });

  test('attaches an instance the chart does not hold', () => {
    const fake = fakeRuntime([]);

    syncIndicators(fake.runtime, [SAVED_RSI]);

    expect(fake.calls).toEqual([
      `attach ${RSI_INSTANCE_ID} ${RSI_DEFINITION_ID}`,
      `setHidden ${RSI_INSTANCE_ID} false`,
    ]);
  });

  test('attaches again when the saved definition changed', () => {
    const other: SavedIndicator = { ...SAVED_RSI, definitionId: MACD_DEFINITION_ID };
    const fake = fakeRuntime([attachedRsi(SAVED_RSI.settings)]);

    syncIndicators(fake.runtime, [other]);

    expect(fake.calls).toEqual([
      `attach ${RSI_INSTANCE_ID} ${MACD_DEFINITION_ID}`,
      `setHidden ${RSI_INSTANCE_ID} false`,
    ]);
  });
});
