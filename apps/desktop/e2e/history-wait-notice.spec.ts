import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch, openTradePanel } from './helpers/panel';
import { brokerSymbolFixture, gotoCollectingErrors, gotoWithStub, pushEvent, windowCandles } from './helpers/tauriStub';

/** The EA's synchronization deadline is 10 s; the notice shows for the last 5 s of it. */
const NEVER_ANSWERED_MS = 600_000;
const waitingText = (seconds: number) =>
  `Loading is taking longer than usual. Waiting ${seconds} s. If no data arrives, switch to another symbol.`;
const unavailableText = (symbol: string, timeframeLabel: string) =>
  `No data received for ${symbol} ${timeframeLabel}. Switch to another symbol or try again later.`;

const notice = (page: Page) => page.locator('.chart-wait-notice');

/** A fake clock that only moves when the test advances it, with a history request that is never answered. */
async function startWithUnansweredHistory(page: Page) {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T12:01:00Z'));
  await gotoWithStub(page, { historyDelayMs: NEVER_ANSWERED_MS });
  await page.clock.runFor(100);
}

test('stays silent for five seconds, then counts down 5 to 1 toward the deadline', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(4_650);
  await expect(notice(page)).toHaveText('');
  // Sampled a quarter second into each second so the assertion never sits on a tick boundary.
  await page.clock.runFor(600);
  await expect(notice(page)).toHaveText(waitingText(5));
  for (const seconds of [4, 3, 2, 1]) {
    await page.clock.runFor(1_000);
    await expect(notice(page)).toHaveText(waitingText(seconds));
  }
});

test('the notice is an accessible polite live region that leaves the top bar usable', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(5_250);
  await expect(notice(page)).toHaveAttribute('role', 'status');
  await expect(notice(page)).toHaveAttribute('aria-live', 'polite');
  await expect(notice(page)).toHaveText(waitingText(5));
  await openSymbolSearch(page);
  await expect(page.getByRole('dialog', { name: 'Search symbols' })).toBeVisible();
});

const CENTER_TOLERANCE_PX = 2;
const loadingMessage = (page: Page) => page.locator('.loading-message');

/** Offset of the targets' joint bounding box center from the window center, in px. */
async function offsetFromWindowCenter(page: Page, ...targets: Locator[]) {
  const boxes = await Promise.all(targets.map((target) => target.boundingBox()));
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const present = boxes.flatMap((box) => (box ? [box] : []));
  expect(present).toHaveLength(targets.length);
  const left = Math.min(...present.map((box) => box.x));
  const right = Math.max(...present.map((box) => box.x + box.width));
  const top = Math.min(...present.map((box) => box.y));
  const bottom = Math.max(...present.map((box) => box.y + box.height));
  return {
    x: Math.abs((left + right) / 2 - (viewport?.width ?? 0) / 2),
    y: Math.abs((top + bottom) / 2 - (viewport?.height ?? 0) / 2),
  };
}

for (const panelOpen of [false, true]) {
  const panelState = panelOpen ? 'open' : 'closed';

  test(`the startup loading message is centered on the window with the trade panel ${panelState}`, async ({ page }) => {
    await gotoCollectingErrors(page);
    if (panelOpen) {
      await openTradePanel(page);
    }
    const offset = await offsetFromWindowCenter(page, loadingMessage(page));
    expect(offset.x).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
    expect(offset.y).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
  });

  test(`the history notice is centered on the window with the trade panel ${panelState}`, async ({ page }) => {
    await startWithUnansweredHistory(page);
    if (panelOpen) {
      await openTradePanel(page);
    }
    await page.clock.runFor(5_250);
    await expect(notice(page)).toHaveText(waitingText(5));
    const offset = await offsetFromWindowCenter(page, notice(page));
    expect(offset.x).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
    expect(offset.y).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
  });
}

test('the top bar, symbol search and timeframe buttons stay clickable while the notice is shown', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(5_250);
  await expect(notice(page)).toHaveText(waitingText(5));
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await openSymbolSearch(page);
  await expect(page.getByRole('dialog', { name: 'Search symbols' })).toBeVisible();
});

test('a snapshot clears the countdown', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(6_250);
  await expect(notice(page)).toHaveText(waitingText(4));
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: windowCandles(10),
  });
  await expect(notice(page)).toHaveText('');
  await page.clock.runFor(2_000);
  await expect(notice(page)).toHaveText('');
});

test('history-unavailable replaces the countdown with the no-data message', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(9_250);
  await expect(notice(page)).toHaveText(waitingText(1));
  await pushEvent(page, 'history-unavailable', { symbol: 'EURUSD', timeframe: 'M5' });
  await expect(notice(page)).toHaveText(unavailableText('EURUSD', '5m'));
  await page.clock.runFor(3_000);
  await expect(notice(page)).toHaveText(unavailableText('EURUSD', '5m'));
});

test('history-unavailable for another selection is ignored', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(6_250);
  await pushEvent(page, 'history-unavailable', { symbol: 'GBPUSD', timeframe: 'M5' });
  await expect(notice(page)).toHaveText(waitingText(4));
});

test('a timeframe change clears the no-data message', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await page.clock.runFor(1_000);
  await pushEvent(page, 'history-unavailable', { symbol: 'EURUSD', timeframe: 'M5' });
  await expect(notice(page)).toHaveText(unavailableText('EURUSD', '5m'));
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await page.clock.runFor(100);
  await expect(notice(page)).toHaveText('');
});

test('a symbol change clears the no-data message until the new selection reports its own', async ({ page }) => {
  // Real timers: the bridge answers each request after 2 s, long enough to observe the cleared state.
  await gotoWithStub(page, { historyUnavailable: true, historyDelayMs: 2_000 });
  await expect(notice(page)).toHaveText(unavailableText('EURUSD', '5m'));
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'NAS100 description')]);
  await chooseSearchResult(dialog, 'NAS100');
  await expect(notice(page)).toHaveText('');
  await expect(notice(page)).toHaveText(unavailableText('NAS100', '5m'));
});

test('a session reset clears the no-data message', async ({ page }) => {
  await startWithUnansweredHistory(page);
  await pushEvent(page, 'history-unavailable', { symbol: 'EURUSD', timeframe: 'M5' });
  await expect(notice(page)).toHaveText(unavailableText('EURUSD', '5m'));
  await pushEvent(page, 'bridge-status', { state: 'disconnected' });
  await expect(notice(page)).toHaveText('');
});

test('an unsynchronized series reported by the bridge shows the no-data message', async ({ page }) => {
  await gotoWithStub(page, { historyUnavailable: true });
  await expect(notice(page)).toHaveText(unavailableText('EURUSD', '5m'));
});
