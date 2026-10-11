import { test, expect } from '@playwright/test';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import type { ChartToolHost, ChartToolResetReason } from '../src/features/chart/engine/toolContract';
import { FixedRangeProfileTool } from '../src/features/tools/fixedRangeProfile/tool';

/**
 * What a reset does to the Fixed Range Volume Profile tool and its backend request:
 * only a symbol change that finds a placed range cancels the backend work.
 */

const BAR_SECONDS = 60;
const SLOT_WIDTH = 10;

function createToolWithPlacedRange() {
  const market = createFakeMarketDataPort();
  const bars = Array.from({ length: 10 }, (_, index) => ({ time: 1_000 + index * BAR_SECONDS }));
  const host = {
    barSeries: { bars, timeframe: 'M1', intervalSeconds: BAR_SECONDS },
    geometry: {
      viewport: () => ({ chartRect: { width: 600, height: 400 } }),
      slotAt: (x: number) => Math.floor(x / SLOT_WIDTH),
      timeToX: (timeMs: number) => ((timeMs / 1000 - 1_000) / BAR_SECONDS) * SLOT_WIDTH,
    },
    currentMarket: { symbol: () => 'DEMO.TEST', quote: () => undefined },
    marketDataPort: market.port,
    requestRepaint: () => undefined,
    returnToDefaultTool: () => undefined,
    notifyError: () => undefined,
  } as unknown as ChartToolHost;
  const tool = new FixedRangeProfileTool(host);
  const placeRange = () => {
    for (const x of [25, 65]) {
      tool.pointerDown(x, 50, 'startNewDrawing');
      tool.pointerUp('released');
    }
  };
  return { tool, market, placeRange };
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
