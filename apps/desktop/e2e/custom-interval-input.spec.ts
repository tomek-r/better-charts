import { expect, test, type Page } from '@playwright/test';
import {
  INTERVAL_NOT_SERVED_MESSAGE,
  INTERVAL_OUT_OF_RANGE_MESSAGE,
  INTERVAL_UNREADABLE_MESSAGE,
} from '../src/shared/bridge/chartIntervalModel';
import { intervalOrderKey, intervalSection } from '../src/shared/bridge/chartIntervals';
import {
  customIntervalsKey,
  loadCustomIntervals,
  withCustomInterval,
  withoutCustomInterval,
} from '../src/features/chart/timeframes/customIntervals';
import { openChart } from './helpers/openChart';
import { readStoredJson, seedStoredValue } from './helpers/pageStorage';
import { expectNoErrors, gotoWithStub, stubInvocations } from './helpers/tauriStub';

/**
 * The interval input of the timeframe menu: the text it reads into an interval, the section the
 * interval is remembered under, its star and its remove button.
 */

const chevron = (page: Page) => page.getByRole('button', { name: 'More timeframes' });
const intervalMenu = (page: Page) => page.getByRole('dialog', { name: 'Timeframes' });
const intervalInput = (page: Page) => page.getByRole('textbox', { name: 'Custom interval' });
const headerButton = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button', { name: label, exact: true });

/** One collapsible section of the open menu, found by the heading it shows. */
const menuSection = (page: Page, title: string) =>
  intervalMenu(page)
    .locator('.timeframe-menu-section')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });

/** The history reads the app has asked the bridge for. */
async function historyReads(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history');
}

/** Loads the app on the stub, seeds stored custom intervals when a case needs them, and opens the menu. */
async function openCustomIntervalMenu(
  page: Page,
  storedIntervals?: readonly string[],
  options?: Parameters<typeof gotoWithStub>[1],
) {
  if (storedIntervals !== undefined) {
    await seedStoredValue(page, customIntervalsKey, JSON.stringify(storedIntervals));
  }
  const collected = await gotoWithStub(page, options);
  await openChart(page);
  await chevron(page).click();
  await expect(intervalMenu(page)).toBeVisible();
  return collected;
}

/** Storage as `loadCustomIntervals` reads it, holding `raw`. */
const storageOf = (raw: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => raw });

test.describe('the custom intervals the user typed', () => {
  test('a stored list keeps only the intervals the menu can hold as custom', () => {
    const stored = JSON.stringify(['M7', 'M5', 'T10', 'BOGUS', 7, null, 'M7', 'S5', 'T37', 'MN4']);

    expect(loadCustomIntervals(storageOf(stored))).toEqual(['M7', 'S5', 'T37', 'MN4']);
  });

  test('storage it cannot read leaves the menu with no custom interval', () => {
    expect(loadCustomIntervals(storageOf(null))).toEqual([]);
    expect(loadCustomIntervals(storageOf('{"not":"a list"}'))).toEqual([]);
    expect(loadCustomIntervals(storageOf('{definitely not json'))).toEqual([]);
  });

  test('adding keeps a code once, and only when the menu does not list it already', () => {
    expect(withCustomInterval([], 'M7')).toEqual(['M7']);
    expect(withCustomInterval(['M7'], 'M7')).toEqual(['M7']);
    expect(withCustomInterval([], 'M5')).toEqual([]);
    expect(withCustomInterval([], 'T10')).toEqual([]);
    expect(withCustomInterval([], 'BOGUS')).toEqual([]);
    expect(withoutCustomInterval(['M7', 'S5'], 'M7')).toEqual(['S5']);
  });
});

test.describe('where an interval sits in the menu', () => {
  test('a seconds interval has a section of its own, beside the ticks and the time units', () => {
    expect(intervalSection('S5')).toBe('seconds');
    expect(intervalSection('T37')).toBe('ticks');
    expect(intervalSection('M7')).toBe('minutes');
    expect(intervalSection('MN4')).toBe('days');
  });

  test('tick intervals sort first by their count, then every other interval by its length', () => {
    const sorted = ['MN4', 'M7', 'T37', 'S5', 'M1', 'T1'].sort(
      (first, second) => intervalOrderKey(first) - intervalOrderKey(second),
    );

    expect(sorted).toEqual(['T1', 'T37', 'S5', 'M1', 'M7', 'MN4']);
  });
});

test('typing 7 and pressing Enter opens 7 minutes and remembers it in the menu', async ({ page }) => {
  const collected = await openCustomIntervalMenu(page);
  const input = intervalInput(page);
  await input.fill('7');

  await input.press('Enter');

  await expect(intervalMenu(page)).toHaveCount(0);
  await expect(headerButton(page, '7m')).toHaveAttribute('aria-pressed', 'true');
  // Seven minutes is aggregated from the minute candles the bridge serves, never a timeframe of its own.
  await expect.poll(async () => (await historyReads(page)).at(-1)?.args).toMatchObject({ timeframe: 'M1' });
  expect((await historyReads(page)).filter((entry) => entry.args.timeframe === 'M7')).toEqual([]);
  expect(await readStoredJson(page, customIntervalsKey)).toEqual(['M7']);

  await chevron(page).click();

  await expect(menuSection(page, 'Minutes').getByRole('button', { name: '7 minutes', exact: true })).toBeVisible();
  await intervalMenu(page).getByRole('button', { name: 'Add 7m to favorites' }).click();
  await page.reload();

  // The typed interval and its star both outlive the reload.
  await expect(headerButton(page, '7m')).toBeVisible();
  expectNoErrors(collected);
});

test('an unreadable or out-of-range text explains itself inline and keeps the menu open', async ({ page }) => {
  const collected = await openCustomIntervalMenu(page);
  const input = intervalInput(page);
  const alert = intervalMenu(page).getByRole('alert');
  const readsBefore = (await historyReads(page)).length;
  await input.fill('abc');

  await input.press('Enter');

  await expect(alert).toHaveText(INTERVAL_UNREADABLE_MESSAGE);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  // The input points at the message on show, so a screen reader reads the reason with it.
  const errorId = (await alert.getAttribute('id')) ?? '';
  await expect(input).toHaveAttribute('aria-describedby', errorId);
  await expect(intervalMenu(page)).toBeVisible();
  expect((await historyReads(page)).length).toBe(readsBefore);

  await input.fill('200000T');

  await expect(alert).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await input.press('Enter');
  await expect(alert).toHaveText(INTERVAL_OUT_OF_RANGE_MESSAGE);
  expect((await historyReads(page)).length).toBe(readsBefore);
  expectNoErrors(collected);
});

test('an interval the bridge cannot draw is refused inline, not requested', async ({ page }) => {
  const collected = await openCustomIntervalMenu(page, undefined, {
    responses: { get_bridge_status: { state: 'connected', supportedTimeframes: ['M5', 'H1'] } },
  });
  const input = intervalInput(page);
  const alert = intervalMenu(page).getByRole('alert');
  const readsBefore = (await historyReads(page)).length;

  await input.fill('7');

  await input.press('Enter');

  // Seven minutes is aggregated from minute candles, and this handshake advertises none.
  await expect(alert).toHaveText(INTERVAL_NOT_SERVED_MESSAGE);
  await expect(intervalMenu(page)).toBeVisible();
  expect((await historyReads(page)).length).toBe(readsBefore);

  await input.fill('H8');

  await input.press('Enter');

  // Eight hours is a native code the handshake does not advertise, so neither it nor the M1 that
  // seven minutes would need was ever asked for: a refused interval adds no history read.
  await expect(alert).toHaveText(INTERVAL_NOT_SERVED_MESSAGE);
  await expect(intervalMenu(page)).toBeVisible();
  expect((await historyReads(page)).length).toBe(readsBefore);

  await input.fill('1h');

  await input.press('Enter');

  await expect(intervalMenu(page)).toHaveCount(0);
  await expect.poll(async () => (await historyReads(page)).at(-1)?.args).toMatchObject({ timeframe: 'H1' });
  expectNoErrors(collected);
});

test('a stored seconds interval gets its own section, and its remove button takes the row away', async ({ page }) => {
  const collected = await openCustomIntervalMenu(page, ['S5']);
  await expect(menuSection(page, 'Seconds').getByRole('button', { name: '5 seconds', exact: true })).toBeVisible();

  await menuSection(page, 'Seconds').getByRole('button', { name: 'Remove 5s from the menu' }).click();

  await expect(menuSection(page, 'Seconds').getByRole('button', { name: '5 seconds', exact: true })).toHaveCount(0);
  await expect.poll(async () => readStoredJson(page, customIntervalsKey)).toEqual([]);
  expectNoErrors(collected);
});
