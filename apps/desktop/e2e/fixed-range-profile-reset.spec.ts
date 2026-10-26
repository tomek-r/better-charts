import { test, expect } from '@playwright/test';
import { withFakeClock } from './helpers/fakeClock';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import { createFakeToolHost } from './helpers/fakeToolHost';
import type { ChartToolResetReason } from '../src/features/chart/engine/tools/toolContract';
import { FixedRangeProfileTool } from '../src/features/tools/fixedRangeProfile/tool';

/**
 * What a reset does to the Fixed Range Volume Profile tool and its backend request:
 * only a symbol change that finds a placed range cancels the backend work.
 */

const BAR_SECONDS = 60;

function createToolWithPlacedRange() {
  const market = createFakeMarketDataPort();
  const fakeHost = createFakeToolHost(market.port);
  const tool = new FixedRangeProfileTool(fakeHost.host);
  const placeRange = () => {
    for (const x of [25, 65]) {
      tool.pointerDown(x, 50, 'startNewDrawing');
      tool.pointerUp('released');
    }
  };
  return { tool, market, placeRange, barSeries: fakeHost.barSeries, setQuoteTime: fakeHost.setQuoteTime };
}

for (const [reason, placed, expectedCancels] of [
  ['symbol', true, 1],
  ['disconnect', true, 0],
  ['session', true, 0],
  ['symbol', false, 0],
] as Array<[ChartToolResetReason, boolean, number]>) {
  test(`a ${reason} reset ${placed ? 'with' : 'without'} a placed range sends ${expectedCancels} backend cancel(s)`, () => {
    const { tool, market, placeRange } = createToolWithPlacedRange();
    if (placed) {
      placeRange();
      expect(market.requests).toHaveLength(1);
    }
    tool.reset(reason);
    expect(market.cancelCount()).toBe(expectedCancels);
    expect(tool.testApi().selection()).toEqual({ range: null, hasProfile: false });
    expect(tool.testApi().boundaries()).toBeNull();
  });
}

test('a result for a request abandoned by a reset is ignored', () => {
  const { tool, market, placeRange } = createToolWithPlacedRange();
  placeRange();
  const [request] = market.requests;
  tool.reset('disconnect');
  market.publisher.publishTickProfile(profileResultFor(request, request.symbol));
  expect(tool.testApi().selection().hasProfile).toBe(false);
});

type Created = ReturnType<typeof createToolWithPlacedRange>;

/** Bars of another timeframe replace the series, as a timeframe switch does, then the tool hears about it. */
function switchTimeframe(
  { tool, barSeries }: Created,
  timeframe: string,
  openTimesSeconds: number[],
  intervalSeconds = BAR_SECONDS,
): void {
  barSeries.timeframe = timeframe;
  barSeries.intervalSeconds = intervalSeconds;
  barSeries.bars = openTimesSeconds.map((time) => ({ time }));
  tool.barsChanged();
}

// The placed range is [1_120_000, 1_420_000) ms: closed for any series whose newest bar opens at or after 1_420 s.
const CLOSED_COARSE_BARS = [900, 1_800];

test('a timeframe switch re-requests a closed range whose result never arrived', () =>
  withFakeClock(() => {
    const created = createToolWithPlacedRange();
    created.placeRange();
    switchTimeframe(created, 'M15', CLOSED_COARSE_BARS);
    expect(created.market.requests).toHaveLength(2);
    switchTimeframe(created, 'M1', [1_300, 1_540]);
    expect(created.market.requests).toHaveLength(3);
    created.market.publisher.publishTickProfile(profileResultFor(created.market.requests[2], 'DEMO.TEST'));
    expect(created.tool.testApi().selection().hasProfile).toBe(true);
  }));

test('a timeframe switch leaves a closed range with a loaded profile alone', () =>
  withFakeClock((clock) => {
    const created = createToolWithPlacedRange();
    created.placeRange();
    created.market.publisher.publishTickProfile(profileResultFor(created.market.requests[0], 'DEMO.TEST'));
    switchTimeframe(created, 'M15', CLOSED_COARSE_BARS);
    clock.advance(10_000);
    expect(created.market.requests).toHaveLength(1);
    expect(created.tool.testApi().selection().hasProfile).toBe(true);
  }));

test('a closed range is never refreshed by new bars or quotes', () =>
  withFakeClock((clock) => {
    const created = createToolWithPlacedRange();
    created.placeRange();
    created.market.publisher.publishTickProfile(profileResultFor(created.market.requests[0], 'DEMO.TEST'));
    for (let step = 1; step <= 3; step += 1) {
      created.setQuoteTime(1_600_000 + step * 1_000);
      switchTimeframe(created, 'M1', [1_300, 1_540, 1_540 + step * BAR_SECONDS]);
      clock.advance(10_000);
    }
    expect(created.market.requests).toHaveLength(1);
  }));

test('a range that ended before the latest quote is closed even when a coarse bar opened before its end', () =>
  withFakeClock((clock) => {
    const created = createToolWithPlacedRange();
    created.placeRange();
    created.market.publisher.publishTickProfile(profileResultFor(created.market.requests[0], 'DEMO.TEST'));
    created.setQuoteTime(1_600_000);
    // The newest hourly-style bar opened at 900 s, before the range end (1_420 s), but the feed is already past it.
    switchTimeframe(created, 'H1', [0, 900], 3_600);
    clock.advance(10_000);
    expect(created.market.requests).toHaveLength(1);
  }));
