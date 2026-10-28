import { test, expect } from '@playwright/test';
import { createFakeMarketDataPort } from './helpers/fakeMarketDataPort';
import type { ProfileRequestParams } from '../src/features/bridge/marketDataPort';
import type { ChartToolHost } from '../src/features/chart/engine/tools/toolContract';
import {
  DEFAULT_PROFILE_REQUEST_PARAMS,
  FixedRangeProfileRequester,
} from '../src/features/tools/fixedRangeProfile/requests/fixedRangeProfileRequester';
import type { FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/overlay';

/** The requester sends the histogram settings its owner supplies, and today's defaults when it supplies none. */

const SYMBOL = 'DEMO.TEST';
const FROM_MS = Date.now() - 600_000;
const END_MS = FROM_MS + 300_000;

function createRequester(requestParams?: () => ProfileRequestParams) {
  const market = createFakeMarketDataPort();
  // Only the host members the request path reads.
  const host = {
    currentMarket: { symbol: () => SYMBOL, quote: () => null },
    barSeries: { bars: [{ time: (END_MS + 60_000) / 1000 }] },
    requestRepaint: () => undefined,
    notifyError: () => undefined,
  } as unknown as ChartToolHost;
  const state = {} as FixedRangeProfileState;
  const requester = new FixedRangeProfileRequester(
    host,
    market.port,
    state,
    () => ({ fromMs: FROM_MS, endMs: END_MS }),
    requestParams,
  );
  return { requester, market };
}

test('without an owner the request carries 128 rows and a 70 percent value area', () => {
  const { requester, market } = createRequester();
  requester.requestProfile({ fromMs: FROM_MS, endMs: END_MS });
  expect(market.requests).toHaveLength(1);
  expect(market.requests[0]).toMatchObject({
    symbol: SYMBOL,
    fromMs: FROM_MS,
    endMs: END_MS,
    rowsLayout: { kind: 'rows', count: 128 },
    valueAreaPercent: 70,
  });
  expect(market.requests[0]).toMatchObject({ ...DEFAULT_PROFILE_REQUEST_PARAMS });
  requester.dispose();
});

test('the owner supplies the settings and a changed setting reaches the next request', () => {
  let params: ProfileRequestParams = { rowsLayout: { kind: 'ticksPerRow', ticks: 4 }, valueAreaPercent: 55 };
  const { requester, market } = createRequester(() => params);
  requester.requestProfile({ fromMs: FROM_MS, endMs: END_MS });
  params = { rowsLayout: { kind: 'rows', count: 64 }, valueAreaPercent: 90 };
  requester.requestProfile({ fromMs: FROM_MS, endMs: END_MS });
  expect(market.requests.map(({ rowsLayout, valueAreaPercent }) => ({ rowsLayout, valueAreaPercent }))).toEqual([
    { rowsLayout: { kind: 'ticksPerRow', ticks: 4 }, valueAreaPercent: 55 },
    { rowsLayout: { kind: 'rows', count: 64 }, valueAreaPercent: 90 },
  ]);
  requester.dispose();
});
