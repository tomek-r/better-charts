import { expect, test, type Page } from '@playwright/test';
import {
  chartDrawingScopeKey,
  expectNoErrors,
  gotoWithStub,
  stubChartTimeZones,
  stubInvocations,
} from './helpers/tauriStub';

/**
 * The chart's time zone picker: the live clock under the chart, the menu that opens from it, and
 * the zone each chart (one account and one symbol) remembers. A chosen zone re-labels the time
 * axis and the pointer's time label, and it never moves a bar: the labels are formatted, the data
 * is not shifted.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys a saved zone. */
const EURUSD_CHART = chartDrawingScopeKey(ACCOUNT_KEY, 'EURUSD');
const GBPUSD_CHART = chartDrawingScopeKey(ACCOUNT_KEY, 'GBPUSD');
/** The broker offset the stub reports, in minutes. */
const BROKER_OFFSET_MINUTES = 180;
const BROKER_CLOCK = /^\d{2}:\d{2}:\d{2} UTC\+3$/;
const UTC_CLOCK = /^\d{2}:\d{2}:\d{2} UTC$/;
const TOKYO_CLOCK = /^\d{2}:\d{2}:\d{2} UTC\+9$/;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
/** A pointer position inside the pane, so two reads at it resolve the same bar. */
const POINTER_X = 460;
const POINTER_Y = 150;
const NOTIFICATION_ALERTS = '.notification-region [role=alert]';

interface PointerTime {
  /** The bar time under the pointer, in Unix seconds. */
  readonly seconds: number;
  /** The readout's text for that bar, in the chart's zone. */
  readonly label: string;
}

const timeZoneButton = (page: Page) => page.getByRole('button', { name: 'Time zone', exact: true });

const menuRows = (page: Page) => page.getByRole('menuitemradio');

/** Waits for the stub's ten bars and pins the visible range, so a pointer x reads one fixed bar. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(10);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
}

async function openTimeZoneMenu(page: Page): Promise<void> {
  await timeZoneButton(page).click();
  await expect(menuRows(page).first()).toBeVisible();
}

/** The pointer readout with the pointer resting on one fixed pane point. */
async function pointerTime(page: Page): Promise<PointerTime> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.move(host.x + POINTER_X, host.y + POINTER_Y);
  await expect.poll(() => page.evaluate(() => Boolean(window.__chartTest?.pointerReadout()))).toBe(true);
  return page.evaluate(() => {
    const readout = window.__chartTest!.pointerReadout()!;
    return { seconds: readout.timeSeconds!, label: readout.timeLabel! };
  });
}

/** Minutes of the day of a pointer label's trailing `HH:mm`. */
function clockMinutes(label: string): number {
  return Number(label.slice(-5, -3)) * MINUTES_PER_HOUR + Number(label.slice(-2));
}

/** The last save the app sent for a chart's zone. */
async function lastSavedZoneArgs(page: Page): Promise<Record<string, unknown> | undefined> {
  const saves = (await stubInvocations(page)).filter((entry) => entry.cmd === 'save_chart_time_zone');
  return saves.at(-1)?.args;
}

test('the clock under the chart reads the exchange time until another zone is picked', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);

  await openTimeZoneMenu(page);
  await expect(menuRows(page).nth(1)).toHaveText('Exchange');
  await expect(menuRows(page).nth(1)).toHaveAttribute('aria-checked', 'true');
  expectNoErrors(collected);
});

test('the menu lists UTC, the exchange, then the cities under their current offsets', async ({ page }) => {
  await gotoWithStub(page);
  await openChart(page);
  await openTimeZoneMenu(page);

  await expect(menuRows(page).first()).toHaveText('UTC');
  await expect(menuRows(page).nth(1)).toHaveText('Exchange');
  // The label carries the offset in force today, so the day of the run decides it.
  await expect(menuRows(page).filter({ hasText: 'New York' })).toHaveText(/^\(UTC-[45]\) New York$/);
  await expect(menuRows(page).filter({ hasText: 'Honolulu' })).toHaveText(/^\(UTC-10\) Honolulu$/);
});

test('picking UTC relabels the pointer three hours earlier and saves the zone for this chart', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const before = await pointerTime(page);

  await openTimeZoneMenu(page);
  await menuRows(page).filter({ hasText: /^UTC$/ }).click();

  await expect(timeZoneButton(page)).toHaveText(UTC_CLOCK);
  // Broker time is the bar read as wall clock; UTC is the same bar three hours earlier.
  await expect
    .poll(async () => clockMinutes((await pointerTime(page)).label))
    .toBe((clockMinutes(before.label) - BROKER_OFFSET_MINUTES + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  expect((await pointerTime(page)).seconds).toBe(before.seconds);

  await expect.poll(() => stubChartTimeZones(page)).toEqual({ [EURUSD_CHART]: 'UTC' });
  expect(await lastSavedZoneArgs(page)).toEqual({ accountKey: ACCOUNT_KEY, symbol: 'EURUSD', timeZone: 'UTC' });
  expectNoErrors(collected);
});

test('a reload opens the chart in the zone it was left in', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await openTimeZoneMenu(page);
  await menuRows(page).filter({ hasText: /^UTC$/ }).click();
  await expect(timeZoneButton(page)).toHaveText(UTC_CLOCK);
  await expect.poll(() => stubChartTimeZones(page)).toEqual({ [EURUSD_CHART]: 'UTC' });

  await page.reload();

  await openChart(page);
  await expect(timeZoneButton(page)).toHaveText(UTC_CLOCK);
  await openTimeZoneMenu(page);
  await expect(menuRows(page).first()).toHaveAttribute('aria-checked', 'true');
  expectNoErrors(collected);
});

test('a zone saved for another symbol leaves this chart on the exchange', async ({ page }) => {
  await gotoWithStub(page, { chartTimeZones: { [GBPUSD_CHART]: 'Asia/Tokyo' } });
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);
});

test('a chart whose symbol has a saved zone opens in it', async ({ page }) => {
  await gotoWithStub(page, { chartTimeZones: { [EURUSD_CHART]: 'Asia/Tokyo' } });
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(TOKYO_CLOCK);
  await openTimeZoneMenu(page);
  await expect(menuRows(page).filter({ hasText: 'Tokyo' })).toHaveAttribute('aria-checked', 'true');
});

test('a stored zone this build no longer offers opens on the exchange without a notice', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartTimeZones: { [EURUSD_CHART]: 'Mars/Olympus' } });
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);
  await expect(page.locator(NOTIFICATION_ALERTS)).toHaveCount(0);
  expectNoErrors(collected);
});

test('a saved zone the backend cannot read is reported and the chart stays on the exchange', async ({ page }) => {
  const refusal = "The chart's saved time zone could not be read";
  await gotoWithStub(page, { failures: { load_chart_time_zone: refusal } });

  await expect(page.locator(NOTIFICATION_ALERTS).filter({ hasText: refusal })).toBeVisible();
  await openChart(page);
  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);
});

test('the menu opens on the checked row, moves with the arrow keys and returns focus on Escape', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await openTimeZoneMenu(page);

  await expect(menuRows(page).nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuRows(page).nth(2)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menuRows(page).nth(1)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menuRows(page)).toHaveCount(0);
  await expect(timeZoneButton(page)).toBeFocused();
  expectNoErrors(collected);
});
