import { test, expect } from '@playwright/test';
import { withFakeClock } from './helpers/fakeClock';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import type { ChartToolHost } from '../src/features/chart/engine/toolContract';
import { FixedRangeProfileLoader } from '../src/features/tools/fixedRangeProfile/loader';
import type { FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/overlay';
import type { FixedRangeProfileRange } from '../src/features/tools/fixedRangeProfile/range';

/**
 * The request side of the fixed range profile, with a fake clock and a fake market data
 * port: throttling, the pending-request wait, stale-result rejection, disposal and the
 * clip of the request end to the quote time.
 */

const SYMBOL = 'DEMO.TEST';
const THROTTLE_MS = 2000;
const PENDING_MAX_MS = 30_000;
const RANGE: FixedRangeProfileRange = { fromMs: 1_000_000, endMs: 9_000_000 };
const QUOTE_TIME_MS = 5_000_000;

const resultFor = (window: { fromMs: number; endMs: number }, symbol = SYMBOL) => profileResultFor(window, symbol);

function createLoader(committed: FixedRangeProfileRange | null = RANGE) {
  const market = createFakeMarketDataPort();
  const errors: string[] = [];
  const state: FixedRangeProfileState = { range: null, hit: {} };
  let committedRange = committed;
  const host = {
    barSeries: { bars: [{ time: 1_500 }] },
    currentMarket: {
      symbol: () => SYMBOL,
      quote: () => ({ symbol: SYMBOL, timeMs: QUOTE_TIME_MS }),
    },
    marketDataPort: market.port,
    requestRepaint: () => undefined,
    notifyError: (message: string) => errors.push(message),
  } as unknown as ChartToolHost;
  const loader = new FixedRangeProfileLoader(host, state, () => committedRange);
  return {
    loader,
    state,
    errors,
    market,
    setCommittedRange: (range: FixedRangeProfileRange | null) => {
      committedRange = range;
    },
  };
}

test('the request end is clipped to the quote time', () =>
  withFakeClock(() => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    expect(market.requests).toEqual([{ symbol: SYMBOL, fromMs: RANGE.fromMs, endMs: QUOTE_TIME_MS, rows: 128 }]);
    expect(state.range).toEqual({ fromMs: RANGE.fromMs, toMs: QUOTE_TIME_MS });
  }));

test('a result for the awaited request is painted, a result for any other request is ignored', () =>
  withFakeClock(() => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    const [request] = market.requests;
    market.publisher.publishTickProfile(resultFor({ ...request, endMs: request.endMs + 1 }));
    market.publisher.publishTickProfile(resultFor({ ...request, fromMs: request.fromMs + 1 }));
    market.publisher.publishTickProfile(resultFor(request, 'OTHER'));
    expect(state.profile).toBeUndefined();
    market.publisher.publishTickProfile(resultFor(request));
    expect(state.profile).toBeDefined();
  }));

test('a result that arrives after its request was abandoned is ignored', () =>
  withFakeClock(() => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    const [request] = market.requests;
    loader.abandonPendingRequest();
    market.publisher.publishTickProfile(resultFor(request));
    expect(state.profile).toBeUndefined();
  }));

test('a result of an earlier request is ignored once a newer request replaced it', () =>
  withFakeClock(() => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    loader.requestProfile({ fromMs: RANGE.fromMs + 1000, endMs: RANGE.endMs });
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    expect(state.profile).toBeUndefined();
    market.publisher.publishTickProfile(resultFor(market.requests[1]));
    expect(state.profile).toBeDefined();
  }));

test('a cancelled or failed event for the awaited request abandons it, one for another request does not', () =>
  withFakeClock(() => {
    const { loader, market, state, errors } = createLoader();
    loader.requestProfile(RANGE);
    const [request] = market.requests;
    market.publisher.publishTickProfileError({ ...request, endMs: request.endMs + 1, message: 'other' });
    market.publisher.publishTickProfileCancelled({ ...request, fromMs: request.fromMs + 1 });
    expect(errors).toEqual([]);
    market.publisher.publishTickProfile(resultFor(request));
    expect(state.profile).toBeDefined();

    state.profile = undefined;
    loader.requestProfile(RANGE);
    market.publisher.publishTickProfileError({ ...request, message: 'boom' });
    expect(errors).toEqual(['boom']);
    market.publisher.publishTickProfile(resultFor(request));
    expect(state.profile).toBeUndefined();

    loader.requestProfile(RANGE);
    market.publisher.publishTickProfileCancelled(request);
    market.publisher.publishTickProfile(resultFor(request));
    expect(state.profile).toBeUndefined();
  }));

test('many refreshes within the throttle window coalesce into one request', () =>
  withFakeClock((clock) => {
    const { loader, market } = createLoader();
    loader.requestProfile(RANGE);
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    for (let refresh = 0; refresh < 20; refresh += 1) {
      loader.requestThrottledRefresh(RANGE);
      clock.advance(50);
    }
    expect(market.requests).toHaveLength(1);
    clock.advance(THROTTLE_MS);
    expect(market.requests).toHaveLength(2);
    clock.advance(THROTTLE_MS * 5);
    expect(market.requests).toHaveLength(2);
  }));

test('a refresh waits while the previous request is pending and gives up after 30 seconds', () =>
  withFakeClock((clock) => {
    const { loader, market } = createLoader();
    loader.requestProfile(RANGE);
    loader.requestThrottledRefresh(RANGE);
    clock.advance(PENDING_MAX_MS - 1);
    expect(market.requests).toHaveLength(1);
    clock.advance(THROTTLE_MS);
    expect(market.requests).toHaveLength(2);
  }));

test('a refresh for a range the chart no longer holds is dropped', () =>
  withFakeClock((clock) => {
    const { loader, market, setCommittedRange } = createLoader();
    loader.requestThrottledRefresh(RANGE);
    setCommittedRange({ ...RANGE, endMs: RANGE.endMs + 1 });
    clock.advance(THROTTLE_MS);
    expect(market.requests).toHaveLength(0);
    expect(clock.pendingTimerCount()).toBe(0);
  }));

test('dispose clears the refresh timer and unsubscribes from the port', () =>
  withFakeClock((clock) => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    loader.requestThrottledRefresh(RANGE);
    expect(clock.pendingTimerCount()).toBe(1);
    loader.dispose();
    expect(clock.pendingTimerCount()).toBe(0);
    clock.advance(PENDING_MAX_MS * 2);
    expect(market.requests).toHaveLength(1);
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    expect(state.profile).toBeUndefined();
  }));
