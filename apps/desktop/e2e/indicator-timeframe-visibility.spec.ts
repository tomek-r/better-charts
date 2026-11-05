import { expect, test, type Page } from '@playwright/test';
import { readSavedIndicators, type SavedIndicator } from '../src/features/chart/chartSettings/savedIndicators';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../src/features/chart/engine/drawings/timeframeVisibility';
import { SMA_9_CLOSE, indicatorRows, openObjectTree, openSmaSettingsDialog } from './helpers/indicatorObjectTree';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';

failOnPageNoise();

/**
 * The Visibility tab of an indicator's settings dialog: the stub chart opens on M5, so an indicator limited
 * away from minute timeframes is not attached there, and comes back on a timeframe it shows on.
 */

/** A visibility that keeps an indicator off every minute timeframe, which the stub chart opens on (M5). */
const NO_MINUTES: DrawingTimeframeVisibility = {
  ...DEFAULT_TIMEFRAME_VISIBILITY,
  minutes: { shown: false, from: 1, to: 30 },
};

/** The instance and the definition of the one indicator these cases seed. */
const SMA_INSTANCE_ID = 'sma-1';
const SMA_DEFINITION_ID = 'sma';

/** The saved indicator these cases start from: a moving average on default settings, shown everywhere. */
const SAVED_SMA_9: SavedIndicator = { instanceId: SMA_INSTANCE_ID, definitionId: SMA_DEFINITION_ID, settings: {} };

/** The dialog's Visibility tab, and the minutes switch it holds. */
const VISIBILITY_TAB = 'Visibility';
const MINUTES_SWITCH = 'Minutes';

/** The minutes switch the latest save stored for the seeded indicator, if it stored one at all. */
async function savedMinutesShown(page: Page): Promise<boolean | undefined> {
  const saved = readSavedIndicators(await latestSavedIndicators(page)) ?? [];
  return saved.find((entry) => entry.instanceId === SMA_INSTANCE_ID)?.timeframeVisibility?.minutes.shown;
}

/** Boots the app with one saved moving average and opens the object tree drawer. */
async function openTreeWithSavedSma(page: Page, saved: SavedIndicator = SAVED_SMA_9): Promise<void> {
  await openWithSavedIndicators(page, [saved]);
  await openObjectTree(page);
}

test('a saved indicator hidden on minute timeframes is not attached on M5, and the object tree still lists it', async ({
  page,
}) => {
  await openTreeWithSavedSma(page, { ...SAVED_SMA_9, timeframeVisibility: NO_MINUTES });

  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(0);
  await expect(page.getByLabel('Indicator legend', { exact: true })).toBeHidden();
  await expect(indicatorRows(page)).toContainText(SMA_9_CLOSE);
});

test('unchecking Minutes in the Visibility tab detaches the indicator on M5 and saves the setting', async ({
  page,
}) => {
  await openTreeWithSavedSma(page);
  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
  const dialog = await openSmaSettingsDialog(page);

  await dialog.getByRole('tab', { name: VISIBILITY_TAB, exact: true }).click();
  const minutesGroup = dialog.getByRole('group', { name: MINUTES_SWITCH });
  await minutesGroup.getByRole('checkbox', { name: MINUTES_SWITCH }).uncheck();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(0);
  await expect.poll(async () => savedMinutesShown(page)).toBe(false);
});

test('the dialog of an indicator offers Inputs, Style and Visibility tabs', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const dialog = await openSmaSettingsDialog(page);

  await expect(dialog.getByRole('tab')).toHaveText(['Inputs', 'Style', VISIBILITY_TAB]);
});
