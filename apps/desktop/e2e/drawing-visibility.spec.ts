import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  TIMEFRAME_COUNTS,
  type DrawingTimeframeVisibility,
} from '../src/features/chart/engine/drawings/timeframeVisibility';
import { chartDrawings, clickChartPoint, savedDrawings, selectedDrawing } from './helpers/drawingToolbarPage';
import { ready } from './helpers/fixedRangeProfilePage';
import { gotoWithSavedProfile, openSavedProfileSettings, SEEDED_PROFILE_ID } from './helpers/savedProfileSettings';

/**
 * The Visibility tab of a saved fixed range volume profile on the real app: the rows it shows, the setting
 * OK saves, and a drawing the current timeframe hides, which stays listed but cannot be hit.
 */

/** The highest minute count the restricted setting keeps; the stub chart starts on M5, which stays inside. */
const LAST_SHOWN_MINUTES = 15;

/** Minutes up to 15 only and no hours: hidden on the one-hour chart, shown on the five-minute chart. */
const SHORT_MINUTES_NO_HOURS: DrawingTimeframeVisibility = {
  ...DEFAULT_TIMEFRAME_VISIBILITY,
  minutes: { ...DEFAULT_TIMEFRAME_VISIBILITY.minutes, to: LAST_SHOWN_MINUTES },
  hours: { ...DEFAULT_TIMEFRAME_VISIBILITY.hours, shown: false },
};

/** Boots the app with one saved profile and opens its settings on the Visibility tab. */
async function openVisibilityTab(page: Page) {
  await openSavedProfileSettings(page, 'Visibility');
}

test('the tab starts with every timeframe ticked and the full ranges the config allows', async ({ page }) => {
  await openVisibilityTab(page);
  const { minutes, hours } = TIMEFRAME_COUNTS;

  for (const name of ['Minutes', 'Hours', 'Days', 'Weeks', 'Months']) {
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
  }
  await expect(page.getByLabel('Minutes from', { exact: true })).toHaveValue(String(minutes[0]));
  await expect(page.getByLabel('Minutes to', { exact: true })).toHaveValue(String(minutes.at(-1)));
  await expect(page.getByLabel('Hours from', { exact: true })).toHaveValue(String(hours[0]));
  await expect(page.getByLabel('Hours to', { exact: true })).toHaveValue(String(hours.at(-1)));
});

test('a count typed between two allowed ones snaps to the nearest, and unticking a row disables its controls', async ({
  page,
}) => {
  await openVisibilityTab(page);
  const minutesTo = page.getByLabel('Minutes to', { exact: true });

  await minutesTo.fill('13');
  await minutesTo.blur();
  await expect(minutesTo).toHaveValue('12');
  await expect(page.getByLabel('Minutes range maximum', { exact: true })).toHaveValue(
    String(TIMEFRAME_COUNTS.minutes.indexOf(12)),
  );

  await page.getByRole('checkbox', { name: 'Hours', exact: true }).uncheck();
  await expect(page.getByLabel('Hours from', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Hours range minimum', { exact: true })).toBeDisabled();
});

test('the thumbs of a range slider never cross', async ({ page }) => {
  await openVisibilityTab(page);
  const maximum = page.getByLabel('Hours range maximum', { exact: true });

  await page.getByLabel('Hours range minimum', { exact: true }).fill(String(TIMEFRAME_COUNTS.hours.length - 1));
  await maximum.fill('0');

  await expect(page.getByLabel('Hours from', { exact: true })).toHaveValue(String(TIMEFRAME_COUNTS.hours.at(-1)));
  await expect(page.getByLabel('Hours to', { exact: true })).toHaveValue(String(TIMEFRAME_COUNTS.hours.at(-1)));
});

test('OK saves the setting with the record: minutes up to fifteen and no hours', async ({ page }) => {
  await openVisibilityTab(page);

  const minutesTo = page.getByLabel('Minutes to', { exact: true });
  await minutesTo.fill(String(LAST_SHOWN_MINUTES));
  await minutesTo.blur();
  await page.getByRole('checkbox', { name: 'Hours', exact: true }).uncheck();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(async () => (await savedDrawings(page)).map((record) => record.timeframeVisibility))
    .toEqual([SHORT_MINUTES_NO_HOURS]);
  expect((await chartDrawings(page)).map((record) => record.timeframeVisibility)).toEqual([SHORT_MINUTES_NO_HOURS]);
});

/** Clicks inside the seeded range and answers which drawing that selected, or null when it selected none. */
async function drawingIdAfterClick(page: Page): Promise<string | null> {
  await clickChartPoint(page, 4);
  return (await selectedDrawing(page))?.drawingId ?? null;
}

test('a drawing the timeframe hides stays listed but a click on it selects nothing', async ({ page }) => {
  await gotoWithSavedProfile(page, SHORT_MINUTES_NO_HOURS);
  await ready(page);
  const timeframes = page.getByRole('group', { name: 'Chart timeframe' });

  await expect.poll(() => drawingIdAfterClick(page)).toBe(SEEDED_PROFILE_ID);

  await timeframes.getByRole('button', { name: '1H', exact: true }).click();
  await expect.poll(async () => selectedDrawing(page)).toBeNull();

  await clickChartPoint(page, 4);
  expect(await selectedDrawing(page)).toBeNull();
  expect((await chartDrawings(page)).map((record) => record.id)).toEqual([SEEDED_PROFILE_ID]);

  await timeframes.getByRole('button', { name: '5m', exact: true }).click();
  await expect.poll(() => drawingIdAfterClick(page)).toBe(SEEDED_PROFILE_ID);
});
