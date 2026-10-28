import { expect, type Page } from '@playwright/test';
import { profileSelection } from './chartTest';
import { gotoWithStub, pushEvent, STUB_M5_INTERVAL_MS, STUB_NOW, stubInvocations } from './tauriStub';

/**
 * The Fixed Range Volume Profile page steps several specs share: they boot the stub app, wait for
 * its ten-bar window, place a range with real pointer events and answer the profile request it
 * sends. The window is the stub's own M5 EURUSD series, so `position` and the default range of
 * `select` name fixed slots of it.
 */

/** The render bars on the chart, as the dev hook reports them. */
export async function data(page: Page) {
  return page.evaluate(() => window.__chartTest?.data() ?? []);
}

/** The profile tool's selection once the chart has mounted, which every step here runs after. */
export async function profileState(page: Page) {
  return (await profileSelection(page))!;
}

/** Every `request_tick_profile` the app sent, oldest first. */
export async function requests(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_tick_profile');
}

/** A pane point over the window's bar slot `index`: 0 is the oldest of the ten, 9 the newest, higher reaches past it. */
export async function position(page: Page, index: number) {
  const x = await page.evaluate(
    (timeMs) => {
      const x = window.__chartTest?.timeToX(timeMs);
      if (x === undefined || Number.isNaN(x)) {
        throw new Error('Expected real candle coordinate');
      }
      return x;
    },
    STUB_NOW - (10 - index) * STUB_M5_INTERVAL_MS,
  );
  const host = (await page.locator('.chart-host').boundingBox())!;
  return { x: host.x + x, y: host.y + host.height * 0.3 };
}

/** Waits for the window and keeps every real candle visible for real pointer interactions. */
export async function ready(page: Page) {
  await expect.poll(async () => (await data(page)).length).toBe(10);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
}

/** Selects the profile tool and places a range from bar `first` to bar `second` with two clicks. */
export async function select(page: Page, first = 2, second = 6) {
  await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
  const from = await position(page, first);
  const to = await position(page, second);
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await expect(page.getByRole('button', { name: 'Pointer tools', exact: true })).toHaveClass(/active/);
}

/** Answers the `requestIndex`-th profile request with two rows, complete unless told otherwise. */
export async function respond(page: Page, requestIndex = 0, complete = true) {
  const request = (await requests(page))[requestIndex];
  await pushEvent(page, 'tick-profile', {
    source: 'ticks',
    barTimeframe: null,
    coveredFromMs: null,
    symbol: request.args.symbol,
    fromMs: request.args.fromMs,
    endMs: request.args.endMs,
    complete,
    rejectedTicks: 0,
    actualRows: 2,
    totalWeight: 4,
    poc: '1.0850',
    vah: '1.0855',
    val: '1.0845',
    bidLevels: null,
    askLevels: null,
    bins: [
      { low: '1.0845', high: '1.0850', total: '2', bid: '1', ask: '1' },
      { low: '1.0850', high: '1.0855', total: '2', bid: '1', ask: '1' },
    ],
  });
}

/**
 * Loads the app, draws the default fixed range volume profile range and waits until its profile
 * request left the app.
 */
export async function requestProfile(page: Page) {
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
}

/** As `requestProfile`, then answers it so the profile is committed. */
export async function commitProfile(page: Page) {
  await requestProfile(page);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
}
