import { test, expect, type Page } from '@playwright/test';
import { openTradePanel } from './panel';
import { gotoWithStub, pushEvent, STUB_NOW, stubInvocations } from './tauriStub';
import type { Candle } from '../src/shared/bridge/types';

const INTERVAL = 300_000;
async function data(page: Page) {
  return page.evaluate(() => window.__chartTest?.data() ?? []);
}
async function boundaries(page: Page) {
  return page.evaluate(() => window.__chartTest?.profileBoundaries() ?? null);
}
async function profileState(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __stagedWidgetTest: {
        fixedRangeProfile(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
      };
    };
    return w.__stagedWidgetTest.fixedRangeProfile();
  });
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
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
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
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);

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
    await gotoWithStub(page);
    await ready(page);
    await select(page);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await respond(page);
    await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
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
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
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
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
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
    page.evaluate(() => {
      const chart = window.__chartTest!;
      const host = document.querySelector('.chart-host')!.getBoundingClientRect();
      return {
        to: chart.visibleRange()!.to,
        width: host.width,
        candleFromRight: host.width - chart.timeToX(1745700000000 - 300_000)!,
      };
    });
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
    await gotoWithStub(page);
    await ready(page);
    await select(page);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
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

test('an incomplete-history profile result can still render its available bins', async ({ page }) => {
  await gotoWithStub(page);
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
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

for (const boundary of ['fromX', 'toX'] as const) {
  test(`FRVP crossing ${boundary} clamps to one real candle and commits one request`, async ({ page }) => {
    await gotoWithStub(page);
    await ready(page);
    await select(page);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
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
      .filter((entry) => new URL(entry.name).pathname === '/src/features/chart/engine/chartController.ts')
      .pop()?.name;
    if (!modulePath) {
      throw new Error('ChartController module was not loaded by the app');
    }
    const { ChartController } = (await import(
      modulePath
    )) as typeof import('../src/features/chart/engine/chartController');
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
