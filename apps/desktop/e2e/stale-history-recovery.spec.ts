import { expect, test, type Page } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch } from './helpers/panel';
import {
  brokerSymbolFixture,
  gotoWithStub,
  pushEvent,
  STUB_NOW,
  stubInvocations,
  windowCandles,
} from './helpers/tauriStub';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DETACHED_BAR_TIME_MS = Math.floor(STUB_NOW / 300_000) * 300_000 + TWO_HOURS_MS;
const REFRESH_INTERVAL_MS = 2000;
const LOADER_DELAY_MS = 4000;
const detachedBar = {
  timeMs: DETACHED_BAR_TIME_MS,
  open: '1.0900',
  high: '1.0910',
  low: '1.0890',
  close: '1.0905',
  tickVolume: 5,
  spread: 2,
  realVolume: 0,
};

const loader = (page: Page) => page.getByRole('status').filter({ hasText: 'Downloading history…' });

const pushSnapshot = (page: Page, candles: unknown[]) =>
  pushEvent(page, 'market-snapshot', { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles });
const pushStaleSnapshot = (page: Page) => pushSnapshot(page, windowCandles(10));
const pushFreshSnapshot = (page: Page) => pushSnapshot(page, [...windowCandles(10), detachedBar]);

const chartBarCount = (page: Page) => page.evaluate(() => window.__chartTest!.data().length);

/** The first history of a symbol, answered before MT5 synchronized the series: it ends hours ago. */
async function loadStaleHistory(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T12:01:00Z'));
  await gotoWithStub(page, { responses: { request_history: null } });
  await page.clock.runFor(100);
  // The startup request must have left before the snapshot answers it.
  await expect.poll(() => historyRequestCount(page)).toBe(1);
  await pushStaleSnapshot(page);
  await expect.poll(() => chartBarCount(page)).toBe(10);
}

async function historyRequestCount(page: Page): Promise<number> {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').length;
}

const pushDetachedBar = (page: Page) =>
  pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle: detachedBar });

test('a live bar far past the newest history bar is withheld and the latest history is re-requested', async ({
  page,
}) => {
  await loadStaleHistory(page);
  const requestsBefore = await historyRequestCount(page);

  await pushDetachedBar(page);
  await page.clock.runFor(REFRESH_INTERVAL_MS);

  await expect.poll(() => historyRequestCount(page)).toBe(requestsBefore + 1);
  expect(await chartBarCount(page)).toBe(10);

  await pushFreshSnapshot(page);

  await expect.poll(() => chartBarCount(page)).toBe(11);
  expect(await page.evaluate(() => window.__chartTest!.data().at(-1)?.time)).toBe(DETACHED_BAR_TIME_MS / 1000);
});

test('the loader appears only after 4 seconds without fresh history', async ({ page }) => {
  await loadStaleHistory(page);
  await pushDetachedBar(page);

  await page.clock.runFor(LOADER_DELAY_MS - 100);
  await expect(loader(page)).toHaveCount(0);
  expect(await chartBarCount(page)).toBe(10);

  await page.clock.runFor(200);
  await expect(loader(page)).toBeVisible();
  await expect(loader(page)).toContainText('EURUSD');
  expect(await chartBarCount(page)).toBe(10);
  // The loader must leave the top bar, panel toggle and timeframe buttons usable.
  await expect(page.getByRole('button', { name: '1H', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '1H', exact: true }).click({ trial: true });
});

test('fresh history that lands before 4 seconds never shows the loader', async ({ page }) => {
  await loadStaleHistory(page);
  const requestsBefore = await historyRequestCount(page);
  await pushDetachedBar(page);
  await page.clock.runFor(1000);

  await pushFreshSnapshot(page);
  await expect.poll(() => chartBarCount(page)).toBe(11);
  await page.clock.runFor(LOADER_DELAY_MS * 2);

  await expect(loader(page)).toHaveCount(0);
  expect(await historyRequestCount(page)).toBe(requestsBefore);
});

test('a stale answer keeps the loader and the refresh going every 2 seconds without drawing the detached bar', async ({
  page,
}) => {
  await loadStaleHistory(page);
  const requestsBefore = await historyRequestCount(page);
  await pushDetachedBar(page);

  const attempts = 7;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.clock.runFor(REFRESH_INTERVAL_MS);
    await expect.poll(() => historyRequestCount(page)).toBe(requestsBefore + attempt);
    await pushStaleSnapshot(page);
    expect(await chartBarCount(page)).toBe(10);
  }
  await expect(loader(page)).toBeVisible();

  await pushFreshSnapshot(page);
  await expect.poll(() => chartBarCount(page)).toBe(11);
  await expect(loader(page)).toHaveCount(0);
  await page.clock.runFor(REFRESH_INTERVAL_MS * 3);
  expect(await historyRequestCount(page)).toBe(requestsBefore + attempts);
});

test('switching symbol cancels the refresh and hides the loader', async ({ page }) => {
  await loadStaleHistory(page);
  await pushDetachedBar(page);
  await page.clock.runFor(LOADER_DELAY_MS + 100);
  await expect(loader(page)).toBeVisible();

  const { dialog, input } = await openSymbolSearch(page);
  // The search debounces on the paused clock, so let it elapse before the stub is asked to answer.
  await input.fill('GBPUSD');
  await page.clock.runFor(1000);
  await answerSymbolSearch(page, input, 'GBPUSD', [brokerSymbolFixture('GBPUSD', 'Pound / Dollar')], 1);
  await chooseSearchResult(dialog, 'GBPUSD');
  await expect(loader(page)).toHaveCount(0);
  const requestsAfterSwitch = await historyRequestCount(page);
  await pushEvent(page, 'market-snapshot', {
    symbol: 'GBPUSD',
    timeframe: 'M5',
    complete: true,
    candles: windowCandles(10),
  });
  await expect(page.locator('.chart-heading h1')).toHaveText('GBPUSD');

  await page.clock.runFor(REFRESH_INTERVAL_MS * 5);
  await expect(loader(page)).toHaveCount(0);
  expect(await historyRequestCount(page)).toBe(requestsAfterSwitch);
});
