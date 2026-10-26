import { test, expect, type Page } from '@playwright/test';
import { profileBoundaries as boundaries, profileSelection } from './helpers/chartTest';
import { openTradePanel } from './helpers/panel';
import { SLOW_PROFILE_SPINNER_DELAY_MS } from '../src/features/tools/fixedRangeProfile/requester';
import { eurusdFormingBar, eurusdQuote, gotoWithStub, pushEvent, STUB_NOW, stubInvocations } from './helpers/tauriStub';
import type { Candle } from '../src/shared/bridge/types';
import { LOADING_WASH_ALPHA } from '../src/features/tools/fixedRangeProfile/overlay';
import { LOADER_MAX_WIDTH, LOADER_ROW_COUNT, LOADER_ROW_HEIGHT } from '../src/shared/canvas/loader';
import { palette } from '../src/shared/theme/palette';

const INTERVAL = 300_000;
/** The loader paints one red and one teal bar per row in every frame. */
const BARS_PER_LOADER = LOADER_ROW_COUNT * 2;
async function data(page: Page) {
  return page.evaluate(() => window.__chartTest?.data() ?? []);
}
async function profileState(page: Page) {
  return (await profileSelection(page))!;
}
async function requests(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_tick_profile');
}
async function position(page: Page, index: number) {
  const x = await page.evaluate(
    (timeMs) => {
      const x = window.__chartTest?.timeToX(timeMs);
      if (x === undefined || Number.isNaN(x)) {
        throw new Error('Expected real candle coordinate');
      }
      return x;
    },
    STUB_NOW - (10 - index) * INTERVAL,
  );
  const host = (await page.locator('.chart-host').boundingBox())!;
  return { x: host.x + x, y: host.y + host.height * 0.3 };
}
async function ready(page: Page) {
  await expect.poll(async () => (await data(page)).length).toBe(10);
  // Keep every real candle visible for real pointer interactions.
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
}
async function select(page: Page, first = 2, second = 6) {
  await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
  const from = await position(page, first);
  const to = await position(page, second);
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await expect(page.getByRole('button', { name: 'Pointer tools', exact: true })).toHaveClass(/active/);
}
async function respond(page: Page, requestIndex = 0, complete = true) {
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

/** Loads the app, draws the default FRVP range and waits until its profile request left the app. */
async function requestProfile(page: Page) {
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
}

/** As `requestProfile`, then answers it so the profile is committed. */
async function commitProfile(page: Page) {
  await requestProfile(page);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
}

for (const higher of [
  { wire: 'M5', label: '5m', intervalMs: 300_000 },
  { wire: 'M15', label: '15m', intervalMs: 900_000 },
  { wire: 'H1', label: '1H', intervalMs: 3_600_000 },
]) {
  test(`FRVP minute selection retains its time anchors on ${higher.wire}`, async ({ page }, testInfo) => {
    const candles = (intervalMs: number): Candle[] => {
      const lastOpen = Math.floor(STUB_NOW / intervalMs) * intervalMs;
      return Array.from({ length: 11 }, (_, index) => ({
        timeMs: lastOpen - (10 - index) * intervalMs,
        open: '1.0850',
        high: '1.0860',
        low: '1.0840',
        close: '1.0855',
        tickVolume: 120,
        spread: 2,
        realVolume: 120,
      }));
    };
    const minute = candles(60_000);
    const higherCandles = candles(higher.intervalMs);
    await gotoWithStub(page, {
      responses: { get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M1', complete: true, candles: minute } },
      historyByTimeframe: { M1: minute, [higher.wire]: higherCandles },
    });
    await expect.poll(async () => (await data(page)).length).toBe(11);
    await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 14 }));
    const host = (await page.locator('.chart-host').boundingBox())!;
    await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
    for (const index of [2, 6]) {
      const x = await page.evaluate(
        (timeMs) => window.__chartTest?.timeToX(timeMs) ?? Number.NaN,
        minute[index].timeMs,
      );
      await page.mouse.click(host.x + x!, host.y + host.height * 0.3);
    }
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await respond(page);
    await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
    const before = (await boundaries(page))!;
    await page.screenshot({ path: testInfo.outputPath('profile-minute.png') });
    await page.getByRole('button', { name: higher.label, exact: true }).click();
    await expect(page.locator('.timeframe-tabs button[aria-pressed="true"]')).toHaveText(higher.label);
    await expect.poll(async () => (await data(page)).at(-1)?.time).toBe(higherCandles.at(-1)!.timeMs / 1000);
    await page.screenshot({ path: testInfo.outputPath('profile-higher.png') });
    const after = (await boundaries(page))!;
    expect(after.range).toEqual(before.range);
    expect((await profileState(page)).hasProfile).toBe(true);
    expect(await requests(page)).toHaveLength(1);
    expect(after.toX).toBeGreaterThan(after.fromX);
    const mapping = await page.evaluate(
      ({ firstMs, nextMs, fromMs, lastMs, intervalMs }) => {
        const chart = window.__chartTest!;
        const firstX = chart.timeToX(firstMs)!;
        const spacing = chart.timeToX(nextMs)! - firstX;
        return {
          expectedFrom: firstX + ((fromMs - firstMs) / intervalMs) * spacing,
          expectedTo: firstX + ((lastMs - firstMs) / intervalMs) * spacing,
          beforeHistory: chart.timeToX(firstMs - intervalMs),
          firstX,
          rejectsInvalidTime: Number.isNaN(chart.timeToX(NaN)),
        };
      },
      {
        firstMs: higherCandles[0].timeMs,
        nextMs: higherCandles[1].timeMs,
        fromMs: before.range.fromMs,
        lastMs: before.range.endMs - 60_000,
        intervalMs: higher.intervalMs,
      },
    );
    expect(after.fromX).toBeCloseTo(mapping.expectedFrom, 6);
    expect(after.toX).toBeCloseTo(mapping.expectedTo, 6);
    expect(after.fromX).toBeGreaterThan(0);
    expect(after.toX).toBeLessThan(host.width);
    expect(mapping.beforeHistory).toBe(mapping.firstX);
    expect(mapping.rejectsInvalidTime).toBe(true);
  });
}

for (const reversed of [false, true]) {
  test(`FRVP two clicks commit one end-exclusive request (${reversed ? 'reversed' : 'forward'})`, async ({ page }) => {
    const collected = await gotoWithStub(page);
    await ready(page);
    await select(page, reversed ? 6 : 2, reversed ? 2 : 6);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    expect((await requests(page))[0].args).toMatchObject({
      symbol: 'EURUSD',
      fromMs: STUB_NOW - 8 * INTERVAL,
      endMs: STUB_NOW - 3 * INTERVAL,
      rows: 128,
    });
    expect(collected.pageErrors).toEqual([]);
    expect(collected.consoleErrors).toEqual([]);
  });
}

test('switching tools mid-gesture cancels the pending profile selection', async ({ page }) => {
  await gotoWithStub(page);
  await ready(page);
  // One click starts the two-click gesture, so the first boundary is pending.
  await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
  const first = await position(page, 2);
  await page.mouse.click(first.x, first.y);
  // Switching tools must cancel that pending gesture rather than leave it behind.
  await page.getByRole('button', { name: 'Pointer tools', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Arrow pointer' }).click();
  await expect(page.getByRole('button', { name: 'Pointer tools', exact: true })).toHaveClass(/active/);
  // A cancelled gesture starts over, so one further click cannot commit a range.
  // If the pending boundary had survived, this click would commit it and ask the
  // bridge for a profile.
  await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
  const second = await position(page, 6);
  await page.mouse.click(second.x, second.y);
  expect(await requests(page)).toHaveLength(0);
  expect(await boundaries(page)).toBeNull();
});

test('FRVP Escape cancels a new preview while preserving the previous committed profile', async ({ page }) => {
  await commitProfile(page);
  const committed = await profileState(page);
  await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
  const first = await position(page, 0);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Pointer tools', exact: true })).toHaveClass(/active/);
  expect(await profileState(page)).toEqual(committed);
  expect(await requests(page)).toHaveLength(1);
});

test('FRVP boundary click without movement keeps the committed profile visible', async ({ page }) => {
  await commitProfile(page);

  const edge = (await boundaries(page))!;
  const host = (await page.locator('.chart-host').boundingBox())!;
  const target = await position(page, 2);
  await page.mouse.move(host.x + edge.fromX, target.y);
  await page.mouse.down();
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
  await page.mouse.up();

  expect((await profileState(page)).hasProfile).toBe(true);
  expect(await requests(page)).toHaveLength(1);
});

for (const boundary of ['fromX', 'toX'] as const) {
  test(`FRVP ${boundary} drag requests only once after release and rejects the old result`, async ({ page }) => {
    await commitProfile(page);
    const before = (await boundaries(page))!;
    const host = (await page.locator('.chart-host').boundingBox())!;
    const target = await position(page, boundary === 'fromX' ? 1 : 8);
    await page.mouse.move(host.x + before[boundary], target.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    expect(await requests(page)).toHaveLength(1);
    await expect.poll(async () => (await profileState(page)).hasProfile).toBe(false);
    await page.mouse.up();
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    expect((await boundaries(page))!.range).not.toEqual(before.range);
    await respond(page, 0);
    expect((await profileState(page)).hasProfile).toBe(false);
    await respond(page, 1);
    await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
  });
}

test('FRVP cancelled drag restores range and result without requesting; Delete cancels the profile', async ({
  page,
}) => {
  await commitProfile(page);
  const before = await profileState(page);
  const edge = (await boundaries(page))!;
  const host = (await page.locator('.chart-host').boundingBox())!;
  const target = await position(page, 0);
  await page.mouse.move(host.x + edge.fromX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await profileState(page)).toEqual(before);
  expect(await requests(page)).toHaveLength(1);
  await page.locator('.chart-host').focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await profileState(page)).range).toBeNull();
  expect((await profileState(page)).hasProfile).toBe(false);
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'cancel_tick_profile').length)
    .toBeGreaterThan(0);
});

test('history and realtime use seconds, reject old or malformed bars, and mount one event listener', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await data(page)).length).toBe(10);
  const initial = await data(page);
  expect(initial.at(-1)?.time).toBe((STUB_NOW - INTERVAL) / 1000);
  const candle = {
    timeMs: STUB_NOW,
    open: '1.0850',
    high: '1.0856',
    low: '1.0845',
    close: '1.0854',
    tickVolume: 12,
    spread: 2,
    realVolume: 0,
  };
  await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
  await expect.poll(async () => (await data(page)).length).toBe(11);
  const accepted = await data(page);
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    candle: { ...candle, timeMs: STUB_NOW - 2 * INTERVAL },
  });
  await pushEvent(page, 'bar-update', {
    symbol: 'NAS100',
    timeframe: 'M5',
    candle: { ...candle, timeMs: STUB_NOW + INTERVAL },
  });
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M1',
    candle: { ...candle, timeMs: STUB_NOW + INTERVAL },
  });
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    candle: { ...candle, timeMs: STUB_NOW + INTERVAL, high: '1.0000' },
  });
  expect(await data(page)).toEqual(accepted);
  const listenerCounts = await page.evaluate(() => {
    const stub = (window as unknown as { __E2E_TAURI_STUB__: { listenerCount(event: string): number } })
      .__E2E_TAURI_STUB__;
    return ['market-snapshot', 'bar-update', 'quote-update'].map((event) => stub.listenerCount(event));
  });
  expect(listenerCounts).toEqual([1, 1, 1]);
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('late history from another timeframe is discarded after returning to the initial selection', async ({ page }) => {
  await gotoWithStub(page, { historyDelayMs: 500 });
  await expect.poll(async () => (await data(page)).length).toBe(10);
  const historyCount = async () =>
    (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').length;
  const before = await historyCount();
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(historyCount).toBe(before + 1);
  // Return to A while B's snapshot is still outstanding.
  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect(page.locator('.timeframe-tabs button[aria-pressed="true"]')).toHaveText('5m');
  await expect.poll(historyCount).toBe(before + 2);
  const accepted = await data(page);
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M1',
    complete: true,
    candles: [
      {
        timeMs: STUB_NOW,
        open: '1.1',
        high: '1.2',
        low: '1.0',
        close: '1.15',
        tickVolume: 5,
        spread: 2,
        realVolume: 0,
      },
    ],
  });
  expect(await data(page)).toEqual(accepted);
  await page.waitForTimeout(550);
  expect(await data(page)).toEqual(accepted);
  await expect(page.locator('.timeframe-tabs button[aria-pressed="true"]')).toHaveText('5m');
});

test('history timeout releases loading after ten seconds without retrying automatically', async ({ page }) => {
  await page.clock.install();
  await gotoWithStub(page, { responses: { request_history: null } });
  await expect.poll(async () => (await data(page)).length).toBe(10);
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await stubInvocations(page)).filter(
          (entry) => entry.cmd === 'request_history' && entry.args.timeframe === 'M1',
        ).length,
    )
    .toBe(1);
  await page.clock.fastForward(10_001);
  await expect(page.getByText('History request timed out.', { exact: true })).toBeVisible();
  expect(
    (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history' && entry.args.timeframe === 'M1'),
  ).toHaveLength(1);
});

test('editing ticket fields keeps the profile, while chart Backspace cancels an outstanding result', async ({
  page,
}) => {
  await requestProfile(page);
  const committed = (await profileState(page)).range;
  await openTradePanel(page);
  const input = page.getByLabel('Units', { exact: true });
  await input.fill('0.20');
  await input.press('Backspace');
  await input.press('Delete');
  expect((await profileState(page)).range).toEqual(committed);
  await page.locator('.chart-host').focus();
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await profileState(page)).range).toBeNull();
  await respond(page);
  expect((await profileState(page)).hasProfile).toBe(false);
});

test('reconnect preserves one listener and applies the new market snapshot once', async ({ page }) => {
  await gotoWithStub(page);
  await expect.poll(async () => (await data(page)).length).toBe(10);
  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'Stub disconnected' });
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'Stub reconnected' });
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: [
      {
        timeMs: STUB_NOW,
        open: '1.0850',
        high: '1.0855',
        low: '1.0845',
        close: '1.0853',
        tickVolume: 12,
        spread: 2,
        realVolume: 0,
      },
    ],
  });
  await expect.poll(async () => (await data(page)).length).toBe(1);
  expect((await data(page))[0]).toMatchObject({ time: STUB_NOW / 1000, close: 1.0853 });
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __E2E_TAURI_STUB__: { listenerCount(event: string): number } }
      ).__E2E_TAURI_STUB__.listenerCount('market-snapshot'),
    ),
  ).toBe(1);
});

test('drawer resize preserves a panned logical right edge and candle distance from the price axis', async ({
  page,
}) => {
  await gotoWithStub(page);
  await expect.poll(async () => (await data(page)).length).toBe(10);
  const original = await page.evaluate(() => {
    const range = window.__chartTest?.visibleRange();
    if (!range) {
      throw new Error('Chart has no visible range');
    }
    return range;
  });
  const parked = { from: original.from + 20, to: original.to + 20 };
  await page.evaluate((range) => window.__chartTest?.scrollToRange(range), parked);
  const view = async () =>
    page.evaluate((newestBarMs) => {
      const chart = window.__chartTest!;
      const host = document.querySelector('.chart-host')!.getBoundingClientRect();
      return {
        to: chart.visibleRange()!.to,
        width: host.width,
        candleFromRight: host.width - chart.timeToX(newestBarMs)!,
      };
    }, STUB_NOW - 300_000);
  await expect.poll(async () => (await view()).to).toBeCloseTo(parked.to, 5);
  const before = await view();
  await openTradePanel(page);
  let previousWidth = -1;
  await expect
    .poll(async () => {
      const current = (await view()).width;
      const settled = current === previousWidth && current < before.width - 300;
      previousWidth = current;
      return settled;
    })
    .toBe(true);
  const open = await view();
  expect(open.to).toBeCloseTo(before.to, 5);
  expect(open.candleFromRight).toBeCloseTo(before.candleFromRight, 0);
  await page.getByRole('button', { name: 'Toggle trade panel' }).click();
  await expect.poll(async () => (await view()).width).toBeCloseTo(before.width, 0);
  await expect.poll(async () => (await view()).to).toBeCloseTo(before.to, 5);
  await expect.poll(async () => (await view()).candleFromRight).toBeCloseTo(before.candleFromRight, 0);
});

for (const event of ['tick-profile-error', 'tick-profile-cancelled']) {
  test(`${event} invalidates the outstanding result while retaining its committed selection`, async ({ page }) => {
    await requestProfile(page);
    const request = (await requests(page))[0];
    const range = (await profileState(page)).range;
    await pushEvent(page, event, {
      symbol: request.args.symbol,
      fromMs: request.args.fromMs,
      endMs: request.args.endMs,
      message: 'Stub profile failure',
    });
    await respond(page);
    expect((await profileState(page)).range).toEqual(range);
    expect((await profileState(page)).hasProfile).toBe(false);
  });
}

test('a rejected request_tick_profile surfaces an error and leaves no profile pending', async ({ page }) => {
  await gotoWithStub(page, { failures: { request_tick_profile: 'Tick service unavailable' } });
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await expect(
    page
      .locator('.notification-region [role=alert]')
      .filter({ hasText: 'Volume profile request failed: Tick service unavailable' }),
  ).toBeVisible();
  const range = (await profileState(page)).range;
  expect(range).not.toBeNull();
  // The failed request was abandoned: a result arriving for it later is stale and is not painted.
  await respond(page);
  expect((await profileState(page)).range).toEqual(range);
  expect((await profileState(page)).hasProfile).toBe(false);
});

test('a profile request pending for 6 seconds shows an animated profile loader that disappears once the result arrives', async ({
  page,
}) => {
  // The loader is the only full-alpha red/teal fillRect of its row height and width range; record those draws.
  await page.addInitScript(
    ({ bidColor, askColor, rowHeight, maxWidth, washColor, washAlpha, barsPerLoader }) => {
      const probe = { bars: 0, washes: 0, washBeforeBars: true, bidWidths: [] as number[] };
      (window as unknown as { loaderProbe: typeof probe }).loaderProbe = probe;
      const fillRect = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<typeof fillRect>
      ) {
        // The wash is the only fillRect in the loading-wash colour and alpha.
        if (this.fillStyle === washColor && Math.abs(this.globalAlpha - washAlpha) < 1e-6) {
          probe.washes += 1;
        }
        const isLoaderBar =
          (this.fillStyle === bidColor || this.fillStyle === askColor) &&
          this.globalAlpha === 1 &&
          args[3] === rowHeight &&
          args[2] <= maxWidth;
        if (isLoaderBar) {
          probe.bars += 1;
          if (this.fillStyle === bidColor) {
            probe.bidWidths.push(args[2]);
          }
          // Each loader frame must follow a wash draw of that frame.
          probe.washBeforeBars &&= probe.washes * barsPerLoader >= probe.bars;
        }
        return fillRect.apply(this, args);
      };
    },
    {
      bidColor: palette.sell,
      askColor: palette.buy,
      rowHeight: LOADER_ROW_HEIGHT,
      maxWidth: LOADER_MAX_WIDTH,
      washColor: palette.raised,
      washAlpha: LOADING_WASH_ALPHA,
      barsPerLoader: BARS_PER_LOADER,
    },
  );
  const probe = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            loaderProbe: { bars: number; washes: number; washBeforeBars: boolean; bidWidths: number[] };
          }
        ).loaderProbe,
    );
  await page.clock.install();
  await requestProfile(page);
  await page.clock.runFor(SLOW_PROFILE_SPINNER_DELAY_MS - 1000);
  expect((await probe()).bars).toBe(0);
  expect((await probe()).washes).toBe(0);
  await page.clock.runFor(2000);
  const shown = await probe();
  expect(shown.bars).toBeGreaterThan(0);
  // The veil appears with the loader and is painted before it in every frame.
  expect(shown.washes * BARS_PER_LOADER).toBe(shown.bars);
  expect(shown.washBeforeBars).toBe(true);
  await page.clock.runFor(300);
  const animating = await probe();
  expect(animating.bars).toBeGreaterThan(shown.bars);
  // The bars grow and shrink: the widths drawn across frames are not all the same.
  expect(new Set(animating.bidWidths.map((width) => width.toFixed(3))).size).toBeGreaterThan(1);

  await respond(page);
  await page.clock.runFor(100);
  expect((await profileState(page)).hasProfile).toBe(true);
  const stopped = (await probe()).bars;
  const washesStopped = (await probe()).washes;
  await page.clock.runFor(1000);
  expect((await probe()).bars).toBe(stopped);
  expect((await probe()).washes).toBe(washesStopped);
});

test('the loading wash of a range ending in the empty area reaches the right handle, not the newest bar', async ({
  page,
}) => {
  await page.addInitScript(
    ({ washColor, washAlpha }) => {
      const washes: Array<{ x: number; width: number }> = [];
      (window as unknown as { lastWashes: typeof washes }).lastWashes = washes;
      const fillRect = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<typeof fillRect>
      ) {
        if (this.fillStyle === washColor && Math.abs(this.globalAlpha - washAlpha) < 1e-6) {
          washes.push({ x: args[0], width: args[2] });
        }
        return fillRect.apply(this, args);
      };
    },
    { washColor: palette.raised, washAlpha: LOADING_WASH_ALPHA },
  );
  await page.clock.install();
  await commitFutureRange(page);
  await page.clock.runFor(9000);
  const { washes, handles, newestBarX } = await page.evaluate((newestBarMs) => {
    const washes = (window as unknown as { lastWashes: Array<{ x: number; width: number }> }).lastWashes;
    return {
      washes: washes.slice(-1),
      handles: window.__chartTest!.tool('fixedRangeProfile')!.boundaries()!,
      newestBarX: window.__chartTest!.timeToX(newestBarMs),
    };
  }, NEWEST_BAR_MS);
  expect(washes).toHaveLength(1);
  expect(washes[0].x).toBeCloseTo(handles.fromX, 3);
  expect(washes[0].x + washes[0].width).toBeCloseTo(handles.toX, 3);
  expect(handles.toX).toBeGreaterThan(newestBarX + 20);
});

test('an incomplete-history profile result can still render its available bins', async ({ page }) => {
  await requestProfile(page);
  await respond(page, 0, false);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
});

test('the first realtime bar can seed an accepted empty history', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: [] },
      request_history: null,
    },
  });
  await expect.poll(async () => (await data(page)).length).toBe(0);
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    candle: {
      timeMs: STUB_NOW,
      open: '1.0850',
      high: '1.0855',
      low: '1.0845',
      close: '1.0853',
      tickVolume: 12,
      spread: 2,
      realVolume: 0,
    },
  });
  await expect.poll(async () => (await data(page)).length).toBe(1);
  expect((await data(page))[0]).toMatchObject({ time: STUB_NOW / 1000, close: 1.0853 });
});

/** Newest stub bar opens one interval before STUB_NOW; the stub quote is stamped STUB_NOW. */
const NEWEST_BAR_MS = STUB_NOW - INTERVAL;
const NEWEST_SLOT = 9;
const FUTURE_SLOT = 12;
/** Open time of the future slot, and the end-exclusive range end it produces. */
const FUTURE_LINE_MS = STUB_NOW + (FUTURE_SLOT - 10) * INTERVAL;
const FUTURE_END_MS = FUTURE_LINE_MS + INTERVAL;

/** Selects the tool and drags a range from bar 2 into empty space right of the newest bar. */
async function commitFutureRange(page: Page) {
  await gotoWithStub(page);
  await ready(page);
  await select(page, 2, FUTURE_SLOT);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
}

/** Pushes a quote at `quoteMs` and a bar update opening at `barMs`, as the bridge would. */
async function pushLiveTick(page: Page, quoteMs: number, barMs: number) {
  await pushEvent(page, 'quote-update', eurusdQuote(quoteMs));
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    candle: { ...eurusdFormingBar, timeMs: barMs },
  });
}

/** Distance between the end line and a time, both measured in the same frame (the pane may scroll on a new bar). */
async function endLineGap(page: Page, timeMs: number) {
  return page.evaluate((time) => {
    const tool = window.__chartTest!.tool('fixedRangeProfile')!;
    return Math.abs((tool.boundaries()?.toX ?? Infinity) - window.__chartTest!.timeToX(time));
  }, timeMs);
}

/** Drags the end handle onto a bar slot with a real pointer. */
async function dragEndTo(page: Page, slot: number) {
  const host = (await page.locator('.chart-host').boundingBox())!;
  const edge = (await boundaries(page))!;
  const target = await position(page, slot);
  await page.mouse.move(host.x + edge.toX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
}

async function expectEndLineAt(page: Page, timeMs: number) {
  await expect.poll(() => endLineGap(page, timeMs)).toBeLessThan(0.001);
}

test('FRVP end placed in the empty area stays on that future slot and requests up to the quote time', async ({
  page,
}) => {
  await commitFutureRange(page);
  const edge = (await boundaries(page))!;
  expect(edge.range).toEqual({ fromMs: STUB_NOW - 8 * INTERVAL, endMs: FUTURE_END_MS });
  await expectEndLineAt(page, FUTURE_LINE_MS);
  expect(await endLineGap(page, NEWEST_BAR_MS)).toBeGreaterThan(20);
  const sent = await requests(page);
  expect(sent).toHaveLength(1);
  expect(sent[0].args).toMatchObject({
    symbol: 'EURUSD',
    fromMs: STUB_NOW - 8 * INTERVAL,
    endMs: STUB_NOW,
    rows: 128,
  });
});

test('FRVP a new bar before the end line keeps the line and refreshes with the profile kept', async ({ page }) => {
  await commitFutureRange(page);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
  const quoteMs = STUB_NOW + 120_000;
  await pushLiveTick(page, quoteMs, STUB_NOW);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(2);
  expect((await requests(page))[1].args).toMatchObject({
    fromMs: STUB_NOW - 8 * INTERVAL,
    endMs: quoteMs,
    rows: 128,
  });
  await expectEndLineAt(page, FUTURE_LINE_MS);
  expect((await boundaries(page))!.range.endMs).toBe(FUTURE_END_MS);
  expect((await profileState(page)).hasProfile).toBe(true);
  await respond(page, 1);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
  expect(await requests(page)).toHaveLength(2);
});

test('FRVP bars passing the end line trigger exactly one final refresh', async ({ page }) => {
  await commitFutureRange(page);
  await respond(page, 0);
  await pushLiveTick(page, STUB_NOW + 20_000, STUB_NOW);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(2);
  await respond(page, 1);
  // Bars open up to the line's own slot: its bar is still forming, so the range stays open.
  await pushLiveTick(page, STUB_NOW + INTERVAL + 5_000, STUB_NOW + INTERVAL);
  await pushLiveTick(page, FUTURE_LINE_MS + 5_000, FUTURE_LINE_MS);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(3);
  await respond(page, 2);
  // A bar opens at the range end: the line's bar closed, one more refresh covers its last ticks.
  await pushLiveTick(page, FUTURE_END_MS + 10_000, FUTURE_END_MS);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(4);
  expect((await requests(page))[3].args).toMatchObject({ fromMs: STUB_NOW - 8 * INTERVAL, endMs: FUTURE_END_MS });
  await respond(page, 3);
  await pushLiveTick(page, FUTURE_END_MS + 20_000, FUTURE_END_MS);
  await pushLiveTick(page, FUTURE_END_MS + 30_000, FUTURE_END_MS);
  await page.waitForTimeout(2500);
  expect(await requests(page)).toHaveLength(4);
  await expectEndLineAt(page, FUTURE_LINE_MS);
});

test('FRVP end exactly on the newest bar refreshes while it forms, once after it closes, and stays on it', async ({
  page,
}) => {
  await gotoWithStub(page);
  await ready(page);
  await select(page, 2, NEWEST_SLOT);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  expect((await boundaries(page))!.range.endMs).toBe(STUB_NOW);
  await respond(page, 0);
  await pushLiveTick(page, STUB_NOW + 20_000, NEWEST_BAR_MS);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(2);
  expect((await requests(page))[1].args).toMatchObject({ fromMs: STUB_NOW - 8 * INTERVAL, endMs: STUB_NOW });
  await respond(page, 1);
  await pushLiveTick(page, STUB_NOW + 40_000, STUB_NOW);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(3);
  await respond(page, 2);
  await pushLiveTick(page, STUB_NOW + 60_000, STUB_NOW);
  await pushLiveTick(page, STUB_NOW + 80_000, STUB_NOW);
  await page.waitForTimeout(2500);
  expect(await requests(page)).toHaveLength(3);
  await expectEndLineAt(page, NEWEST_BAR_MS);
});

test('FRVP range ended on an older bar does not refresh on live updates', async ({ page }) => {
  await commitProfile(page);
  expect((await boundaries(page))!.range.endMs).toBe(STUB_NOW - 5 * INTERVAL + INTERVAL * 2);
  await pushLiveTick(page, STUB_NOW + 60_000, STUB_NOW);
  await pushLiveTick(page, STUB_NOW + 120_000, STUB_NOW + INTERVAL);
  await page.waitForTimeout(2500);
  expect(await requests(page)).toHaveLength(1);
});

test('FRVP dragging an open end back onto an older bar stops the refreshes', async ({ page }) => {
  await commitFutureRange(page);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
  await dragEndTo(page, 7);
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await boundaries(page))!.range.endMs).toBe(STUB_NOW - 2 * INTERVAL);
  await respond(page, 1);
  await pushLiveTick(page, STUB_NOW + 60_000, STUB_NOW);
  await page.waitForTimeout(2500);
  expect(await requests(page)).toHaveLength(2);
});

test('FRVP dragging a fixed end into the empty area opens the range and it refreshes', async ({ page }) => {
  await gotoWithStub(page);
  await ready(page);
  await select(page, 2, 6);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
  await dragEndTo(page, FUTURE_SLOT);
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await boundaries(page))!.range.endMs).toBe(FUTURE_END_MS);
  await expectEndLineAt(page, FUTURE_LINE_MS);
  await respond(page, 1);
  await pushLiveTick(page, STUB_NOW + 20_000, STUB_NOW);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(3);
  await expectEndLineAt(page, FUTURE_LINE_MS);
});

test('FRVP refresh waits for a pending request, then follows up', async ({ page }) => {
  await commitFutureRange(page);
  for (let step = 1; step <= 3; step += 1) {
    await pushLiveTick(page, STUB_NOW + step * 20_000, STUB_NOW);
  }
  await page.waitForTimeout(3000);
  expect(await requests(page)).toHaveLength(1);
  await respond(page);
  await expect.poll(async () => (await requests(page)).length, { timeout: 5000 }).toBe(2);
});

test('FRVP reversed two clicks, first in the empty area then on an older bar, end on the future slot', async ({
  page,
}) => {
  await gotoWithStub(page);
  await ready(page);
  await select(page, FUTURE_SLOT, 5);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  expect((await boundaries(page))!.range).toEqual({ fromMs: STUB_NOW - 5 * INTERVAL, endMs: FUTURE_END_MS });
  await expectEndLineAt(page, FUTURE_LINE_MS);
});

for (const boundary of ['fromX', 'toX'] as const) {
  test(`FRVP crossing ${boundary} clamps to one real candle and commits one request`, async ({ page }) => {
    await requestProfile(page);
    const edge = (await boundaries(page))!;
    const host = (await page.locator('.chart-host').boundingBox())!;
    const target = await position(page, boundary === 'fromX' ? 9 : 0);
    await page.mouse.move(host.x + edge[boundary], target.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    expect(await requests(page)).toHaveLength(1);
    await page.mouse.up();
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    expect((await requests(page))[1].args).toMatchObject(
      boundary === 'fromX'
        ? { fromMs: STUB_NOW - 4 * INTERVAL, endMs: STUB_NOW - 3 * INTERVAL, rows: 128 }
        : { fromMs: STUB_NOW - 8 * INTERVAL, endMs: STUB_NOW - 7 * INTERVAL, rows: 128 },
    );
  });
}

test('live candle bursts paint once per distinct bar and keep the final OHLC and volume', async ({ page }) => {
  await gotoWithStub(page);
  await ready(page);
  const result = await page.evaluate(async (now) => {
    // Vite HMR query strings identify separate modules. Instrument the exact
    // class loaded by the app instead of importing another class prototype.
    const modulePath = performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/src/features/chart/engine/surface/chartController.ts')
      .pop()?.name;
    if (!modulePath) {
      throw new Error('ChartController module was not loaded by the app');
    }
    const { ChartController } = (await import(
      modulePath
    )) as typeof import('../src/features/chart/engine/surface/chartController');
    const original = ChartController.prototype.updateCandle;
    let updates = 0;
    ChartController.prototype.updateCandle = function (candle) {
      updates += 1;
      return original.call(this, candle);
    };
    const stub = (window as unknown as { __E2E_TAURI_STUB__: { emit(name: string, payload: unknown): void } })
      .__E2E_TAURI_STUB__;
    try {
      for (let bar = 0; bar < 2; bar += 1) {
        for (let tick = 0; tick < 100; tick += 1) {
          stub.emit('bar-update', {
            symbol: 'EURUSD',
            timeframe: 'M5',
            candle: {
              timeMs: now + bar * 300_000,
              open: '1.0850',
              high: '1.0870',
              low: '1.0840',
              close: tick === 99 ? '1.0860' : '1.0855',
              tickVolume: tick + 1,
              spread: 2,
              realVolume: 0,
            },
          });
        }
      }
      // An older bar arriving before the flush must still be rejected.
      stub.emit('bar-update', {
        symbol: 'EURUSD',
        timeframe: 'M5',
        candle: { timeMs: now, open: '1.0850', high: '1.0870', low: '1.0840', close: '1.0840', tickVolume: 999 },
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const chart = window.__chartTest!;
      return { updates, bars: chart.data() };
    } finally {
      ChartController.prototype.updateCandle = original;
    }
  }, STUB_NOW);
  expect(result.updates).toBe(2);
  expect(result.bars).toHaveLength(12);
  expect(result.bars.slice(-2)).toMatchObject([
    { time: STUB_NOW / 1000, close: 1.086, volume: 100 },
    { time: (STUB_NOW + INTERVAL) / 1000, close: 1.086, volume: 100 },
  ]);
  await expect(page.getByLabel('Candle OHLC')).toContainText('C 1.0860');
});

for (const reset of ['disconnect', 'history'] as const) {
  test(`pending live candles are cancelled on ${reset}`, async ({ page }) => {
    await gotoWithStub(page);
    await ready(page);
    const before = await data(page);
    await page.evaluate(
      async ({ now, reset }) => {
        const stub = (window as unknown as { __E2E_TAURI_STUB__: { emit(name: string, payload: unknown): void } })
          .__E2E_TAURI_STUB__;
        const candle = {
          timeMs: now,
          open: '1.0850',
          high: '1.0870',
          low: '1.0840',
          close: '1.0860',
          tickVolume: 100,
          spread: 2,
          realVolume: 0,
        };
        stub.emit('bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
        if (reset === 'disconnect') {
          stub.emit('bridge-status', { state: 'disconnected' });
        } else {
          stub.emit('market-snapshot', {
            symbol: 'EURUSD',
            timeframe: 'M5',
            complete: true,
            candles: [{ ...candle, timeMs: now + 300_000, close: '1.0850' }],
          });
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      },
      { now: STUB_NOW, reset },
    );
    if (reset === 'disconnect') {
      expect(await data(page)).toEqual(before);
    } else {
      expect(await data(page)).toMatchObject([{ time: (STUB_NOW + INTERVAL) / 1000, close: 1.085 }]);
    }
  });
}

test('FRVP keeps a pending first click and a future end on their times when a new bar opens between clicks', async ({
  page,
}) => {
  await gotoWithStub(page);
  await ready(page);
  await page.getByRole('button', { name: 'Fixed range volume profile', exact: true }).click();
  const first = await position(page, 2);
  await page.mouse.click(first.x, first.y);

  await pushLiveTick(page, STUB_NOW, STUB_NOW);
  await expect.poll(async () => (await data(page)).length).toBe(11);
  await page.evaluate(() => window.__chartTest?.scrollToRange({ from: -2, to: 15 }));
  // The range change rebuilds the empty future slots on the next animation frame; a click before
  // that lands on a slot that has no time yet and is ignored (the rare flake this wait removes).
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

  // Two empty slots right of the newest bar as it is now, not as it was at the first click.
  const futureOpenMs = STUB_NOW + 2 * INTERVAL;
  const click = await page.evaluate((timeMs) => {
    const x = window.__chartTest!.timeToX(timeMs);
    if (Number.isNaN(x)) {
      throw new Error('Expected future slot coordinate');
    }
    return x;
  }, futureOpenMs);
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.click(host.x + click, host.y + host.height * 0.3);

  await expect.poll(async () => (await requests(page)).length).toBe(1);
  // The request end is clamped to the quote clock; the committed range keeps the chosen slot.
  expect((await boundaries(page))!.range).toEqual({ fromMs: STUB_NOW - 8 * INTERVAL, endMs: futureOpenMs + INTERVAL });
  expect(await endLineGap(page, futureOpenMs)).toBeLessThan(1);
});
