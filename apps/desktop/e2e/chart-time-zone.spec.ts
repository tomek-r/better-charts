import { expect, test, type Page } from '@playwright/test';
import { expectUtcZoneSaved, lastSavedOverridesArgs, timeZoneButton, UTC_CLOCK } from './helpers/chartTimeZonePage';
import {
  chartScopeKey,
  expectNoErrors,
  gotoWithStub,
  STUB_CHART_ID,
  stubChartSettingOverrides,
} from './helpers/tauriStub';

/**
 * The chart's time zone picker: the live clock under the chart, the menu that opens from it, and the
 * zone this chart draws in. The zone is one of the chart's settings, so it is the template's zone —
 * the exchange by default — unless this chart overrides it for the account and symbol it shows. A
 * chosen zone re-labels the time axis and the pointer's time label, and it never moves a bar: the
 * labels are formatted, the data is not shifted.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
const GBPUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'GBPUSD');
/** The broker offset the stub reports, in minutes. */
const BROKER_OFFSET_MINUTES = 180;
const BROKER_CLOCK = /^\d{2}:\d{2}:\d{2} UTC\+3$/;
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

/** Picks UTC from the menu and waits until the clock and the stored override both show it. */
async function saveUtcZone(page: Page): Promise<void> {
  await openTimeZoneMenu(page);
  await menuRows(page).filter({ hasText: /^UTC$/ }).click();
  await expect(timeZoneButton(page)).toHaveText(UTC_CLOCK);
  await expect.poll(() => stubChartSettingOverrides(page)).toEqual({ [EURUSD_CHART]: { timeZone: 'UTC' } });
}

/** The clock reads UTC and the menu's first row, UTC, is the checked one. */
async function expectChartInUtc(page: Page): Promise<void> {
  await expect(timeZoneButton(page)).toHaveText(UTC_CLOCK);
  await openTimeZoneMenu(page);
  await expect(menuRows(page).first()).toHaveAttribute('aria-checked', 'true');
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

test('picking UTC relabels the pointer three hours earlier and saves the zone as a chart setting', async ({ page }) => {
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

  await expectUtcZoneSaved(page);
  expectNoErrors(collected);
});

test('picking Exchange after UTC stores no override, so the chart is back on its template', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await saveUtcZone(page);

  await openTimeZoneMenu(page);
  await menuRows(page).nth(1).click();

  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);
  await expect.poll(() => stubChartSettingOverrides(page)).toEqual({});
  expect(await lastSavedOverridesArgs(page)).toEqual({
    chartId: STUB_CHART_ID,
    accountKey: ACCOUNT_KEY,
    symbol: 'EURUSD',
    overrides: {},
  });
  expectNoErrors(collected);
});

test('the zone of the template is the one the chart opens in until this chart overrides it', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartTemplateSettings: { timeZone: 'UTC' } });
  await openChart(page);

  await expectChartInUtc(page);
  // The template's zone is the chart's own, so nothing is stored against the account and symbol.
  expect(await stubChartSettingOverrides(page)).toEqual({});
  expectNoErrors(collected);
});

test('a reload opens the chart in the zone it was left in', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await saveUtcZone(page);

  await page.reload();

  await openChart(page);
  await expectChartInUtc(page);
  expectNoErrors(collected);
});

test('a zone saved for another symbol leaves this chart on the exchange', async ({ page }) => {
  await gotoWithStub(page, { chartSettingOverrides: { [GBPUSD_CHART]: { timeZone: 'Asia/Tokyo' } } });
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);
});

test('a chart whose symbol has a saved zone opens in it', async ({ page }) => {
  await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { timeZone: 'Asia/Tokyo' } } });
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(TOKYO_CLOCK);
  await openTimeZoneMenu(page);
  await expect(menuRows(page).filter({ hasText: 'Tokyo' })).toHaveAttribute('aria-checked', 'true');
});

test('a stored zone this build no longer offers opens on the exchange without a notice', async ({ page }) => {
  const unavailableZone = { [EURUSD_CHART]: { timeZone: 'Mars/Olympus' } };
  const collected = await gotoWithStub(page, { chartSettingOverrides: unavailableZone });
  await openChart(page);

  await expect(timeZoneButton(page)).toHaveText(BROKER_CLOCK);
  await expect(page.locator(NOTIFICATION_ALERTS)).toHaveCount(0);
  expectNoErrors(collected);
});

test('saved settings the backend cannot read are reported and the chart stays on the exchange', async ({ page }) => {
  const refusal = 'Saved chart settings could not be read';
  await gotoWithStub(page, { failures: { load_chart_settings: refusal } });

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
