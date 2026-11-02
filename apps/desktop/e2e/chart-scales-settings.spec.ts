import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PointerReadout } from '../src/features/chart/engine/legend/pointerReadoutPrimitive';
import type {
  ChartBidAskAppearance,
  ChartScalesState,
} from '../src/features/chart/engine/surface/chartScalesAppearance';
import { palette } from '../src/shared/theme/palette';
import { chartScopeKey, expectNoErrors, gotoWithStub } from './helpers/tauriStub';

/**
 * The chart the Scales and lines tab's settings draw: how the A/L row reaches the screen, the bar
 * countdown tag, the Bid/Ask lines and tags, and the labels of the time axis, the pointer and the
 * footer clock. Every one of them is one of the chart's settings, so it is the template's until this
 * chart overrides it for the account and symbol it shows.
 */

/** The account key the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, so the backend keys its settings that way. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** Where the pointer rests in the pane, as fractions of it: over the bars, clear of both axes. */
const PANE_POINTER_X = 0.45;
const PANE_POINTER_Y = 0.4;
/** A bid and an ask colour no default could be mistaken for. */
const BID_COLOR = '#112233';
const ASK_COLOR = '#445566';

/** What the chart draws of the Scales and lines tab right now, read back through the DEV test hook. */
async function scales(page: Page): Promise<ChartScalesState> {
  return page.evaluate(() => window.__chartTest!.scales());
}

/** The pointer's time/price labels as they stand; null while no pointer is over the pane. */
async function readout(page: Page): Promise<PointerReadout | null> {
  return page.evaluate(() => window.__chartTest!.pointerReadout());
}

/** Waits for the stub's ten bars and shows them, so a pointer at the pane's middle is over data. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: 0, to: 14 }));
}

/**
 * Opens the chart with `bidAsk` stored as its quote setting and waits for its bars, returning the
 * errors the page collected so the test can still assert it stayed clean.
 */
async function openChartWithQuotes(
  page: Page,
  bidAsk: ChartBidAskAppearance,
): Promise<{ pageErrors: string[]; consoleErrors: string[] }> {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { bidAsk } } },
  });
  await openChart(page);
  return collected;
}

/** The A/L row, which the Scale modes setting reveals, keeps on screen or hides. */
function priceScaleRow(page: Page): Locator {
  return page.getByRole('group', { name: 'Price scale' });
}

/** How opaque the row is drawn: the CSS fades it in, so this is polled rather than read once. */
async function rowOpacity(page: Page): Promise<string> {
  return priceScaleRow(page).evaluate((row) => getComputedStyle(row).opacity);
}

/** Moves the pointer onto the right price scale, where the A/L row is revealed by default. */
async function hoverPriceAxis(page: Page): Promise<void> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.move(host.x + host.width - 20, host.y + host.height / 2);
}

/** The pointer's time label once the pointer rests on the bars. */
async function timeLabel(page: Page): Promise<string> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.move(host.x + host.width * PANE_POINTER_X, host.y + host.height * PANE_POINTER_Y);
  await expect.poll(async () => (await readout(page))?.timeLabel ?? null).not.toBeNull();
  return (await readout(page))?.timeLabel ?? '';
}

test('a default chart keeps the scale modes, the countdown, the quote and the labels it has always had', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  await expect
    .poll(() => scales(page))
    .toEqual({
      scaleModeButtons: 'mouseOver',
      countdownVisible: true,
      bidAsk: { linesVisible: true, labelsVisible: true, bid: palette.sell, ask: palette.buy },
      timeLabels: { dayOfWeek: true, dateFormat: 'dayMonthYear', hourFormat: 'h24' },
    });
  expectNoErrors(collected);
});

test('a default chart reveals the A and L row only while the pointer is over the price axis', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  await expect.poll(() => rowOpacity(page)).toBe('0');
  await hoverPriceAxis(page);
  await expect.poll(() => rowOpacity(page)).toBe('1');
  expectNoErrors(collected);
});

test('a chart whose scale modes are kept on screen shows the A and L row with no pointer on the axis', async ({
  page,
}) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { scaleModeButtons: 'always' } } },
  });
  await openChart(page);

  await expect.poll(() => rowOpacity(page)).toBe('1');
  expectNoErrors(collected);
});

test('a chart whose scale modes are hidden shows no A and L row, even over the price axis', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { scaleModeButtons: 'hidden' } } },
  });
  await openChart(page);

  await expect(priceScaleRow(page)).toBeHidden();
  await hoverPriceAxis(page);
  await expect(priceScaleRow(page)).toBeHidden();
  expectNoErrors(collected);
});

test('a chart whose countdown is off draws no bar countdown tag', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { countdown: false } } },
  });
  await openChart(page);

  await expect.poll(async () => (await scales(page)).countdownVisible).toBe(false);
  expectNoErrors(collected);
});

test('a chart whose Bid and ask are hidden draws neither quote line nor quote tag', async ({ page }) => {
  const collected = await openChartWithQuotes(page, { mode: 'hidden', bid: palette.sell, ask: palette.buy });

  await expect
    .poll(async () => (await scales(page)).bidAsk)
    .toEqual({
      linesVisible: false,
      labelsVisible: false,
      bid: palette.sell,
      ask: palette.buy,
    });
  expectNoErrors(collected);
});

test('a chart whose Bid and ask are tags only keeps both tags, in the colours it was given', async ({ page }) => {
  const collected = await openChartWithQuotes(page, { mode: 'label', bid: BID_COLOR, ask: ASK_COLOR });

  await expect
    .poll(async () => (await scales(page)).bidAsk)
    .toEqual({
      linesVisible: false,
      labelsVisible: true,
      bid: BID_COLOR,
      ask: ASK_COLOR,
    });
  expectNoErrors(collected);
});

test('a chart whose hours are 12-hour writes the footer clock and the pointer label that way', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { hourFormat: 'h12' } } },
  });
  await openChart(page);

  await expect(page.getByRole('button', { name: 'Time zone' })).toHaveText(/\d{1,2}:\d{2}:\d{2} (AM|PM) UTC\+3$/);
  expect(await timeLabel(page)).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} '\d{2} {2}\d{1,2}:\d{2} (AM|PM)$/);
  expectNoErrors(collected);
});

test('a chart whose dates are ISO writes the pointer label year first', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { dateFormat: 'iso' } } },
  });
  await openChart(page);

  await expect
    .poll(async () => (await scales(page)).timeLabels)
    .toEqual({
      dayOfWeek: true,
      dateFormat: 'iso',
      hourFormat: 'h24',
    });
  expect(await timeLabel(page)).toMatch(/^[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} {2}\d{2}:\d{2}$/);
  expectNoErrors(collected);
});
