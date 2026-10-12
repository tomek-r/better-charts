import { test, expect } from '@playwright/test';
import { withFakeClock, type FakeClock } from './helpers/fakeClock';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import type { ChartToolHost } from '../src/features/chart/engine/toolContract';
import { FixedRangeProfileLoader, SLOW_PROFILE_SPINNER_DELAY_MS } from '../src/features/tools/fixedRangeProfile/loader';
import type { FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/overlay';
import type { FixedRangeProfileRange } from '../src/features/tools/fixedRangeProfile/range';

/**
 * The request side of the fixed range profile, with a fake clock and a fake market data
 * port: throttling, the pending-request wait, stale-result rejection, disposal and the
 * clip of the request end to the quote time.
 */

const SYMBOL = 'DEMO.TEST';
const THROTTLE_MS = 2000;
const PENDING_MAX_MS = 300_000;
const SPINNER_DELAY_MS = SLOW_PROFILE_SPINNER_DELAY_MS;
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

test('a refresh never replaces a request still loading after a minute and resumes at the normal cadence after the result', () =>
  withFakeClock((clock) => {
    const { loader, market } = createLoader();
    loader.requestProfile(RANGE);
    loader.requestThrottledRefresh(RANGE);
    clock.advance(60_000);
    expect(market.requests).toHaveLength(1);
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    clock.advance(THROTTLE_MS);
    expect(market.requests).toHaveLength(2);
    market.publisher.publishTickProfile(resultFor(market.requests[1]));
    loader.requestThrottledRefresh(RANGE);
    clock.advance(THROTTLE_MS);
    expect(market.requests).toHaveLength(3);
  }));

test('a refresh recovers from a lost terminal event only after the five minute safety net', () =>
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
    // The refresh timer and the slow-load spinner countdown.
    expect(clock.pendingTimerCount()).toBe(2);
    loader.dispose();
    expect(clock.pendingTimerCount()).toBe(0);
    clock.advance(PENDING_MAX_MS * 2);
    expect(market.requests).toHaveLength(1);
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    expect(state.profile).toBeUndefined();
  }));

type Created = ReturnType<typeof createLoader>;

/** Long past the delay, the indicator never showed and nothing is scheduled. */
function expectNeverShown(state: FixedRangeProfileState, clock: FakeClock): void {
  clock.advance(SPINNER_DELAY_MS * 2);
  expect(state.loadingIndicator).toBeFalsy();
  expect(clock.pendingTimerCount()).toBe(0);
}

/** The indicator stays hidden for the delay minus 1 ms, then shows. */
function expectIndicatorAtDelay({ state }: Created, clock: FakeClock): void {
  clock.advance(SPINNER_DELAY_MS - 1);
  expect(state.loadingIndicator).toBeFalsy();
  clock.advance(1);
  expect(state.loadingIndicator).toBe(true);
}

test('the loading indicator shows once the awaited request has been pending for 6 seconds', () =>
  withFakeClock((clock) => {
    const created = createLoader();
    created.loader.requestProfile(RANGE);
    expectIndicatorAtDelay(created, clock);
    created.loader.dispose();
  }));

for (const [name, settle] of [
  ['a result', ({ market }: Created) => market.publisher.publishTickProfile(resultFor(market.requests[0]))],
  [
    'an error',
    ({ market }: Created) => market.publisher.publishTickProfileError({ ...market.requests[0], message: 'boom' }),
  ],
  ['a cancellation', ({ market }: Created) => market.publisher.publishTickProfileCancelled(market.requests[0])],
  ['an abandon', ({ loader }: Created) => loader.abandonPendingRequest()],
  ['a range delete', ({ loader }: Created) => loader.cancelRequest()],
] as const) {
  test(`${name} hides the loading indicator and stops its repaint loop`, () =>
    withFakeClock((clock) => {
      const created = createLoader();
      created.loader.requestProfile(RANGE);
      clock.advance(SPINNER_DELAY_MS);
      expect(created.state.loadingIndicator).toBe(true);
      expect(clock.pendingTimerCount()).toBeGreaterThan(0);
      settle(created);
      expect(created.state.loadingIndicator).toBeFalsy();
      expect(clock.pendingTimerCount()).toBe(0);
      created.loader.dispose();
    }));
}

test('a result before 6 seconds never shows the loading indicator', () =>
  withFakeClock((clock) => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    clock.advance(SPINNER_DELAY_MS - 1);
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    expectNeverShown(state, clock);
  }));

/** Replaces the request once the indicator is visible and reports whether it is still visible. */
function indicatorVisibleAfterReplacing(replacement: FixedRangeProfileRange): boolean | undefined {
  let visible: boolean | undefined;
  withFakeClock((clock) => {
    const { loader, state } = createLoader();
    loader.requestProfile(RANGE);
    clock.advance(SPINNER_DELAY_MS);
    expect(state.loadingIndicator).toBe(true);
    loader.requestProfile(replacement, { keepProfile: true });
    visible = state.loadingIndicator;
    loader.dispose();
  });
  return visible;
}

test('a request for another range hides the indicator, a same-range replacement keeps it', () => {
  expect(indicatorVisibleAfterReplacing({ fromMs: RANGE.fromMs + 1000, endMs: RANGE.endMs })).toBeFalsy();
  expect(indicatorVisibleAfterReplacing(RANGE)).toBe(true);
});

/** Replaces the request 5 s into the countdown and returns how long after the original send the indicator shows. */
function indicatorShowsAfterReplacement(replacement: FixedRangeProfileRange): number {
  let elapsed = 5000;
  withFakeClock((clock) => {
    const { loader, state } = createLoader();
    loader.requestProfile(RANGE);
    clock.advance(5000);
    loader.requestProfile(replacement, { keepProfile: true });
    while (!state.loadingIndicator && elapsed < SPINNER_DELAY_MS * 3) {
      clock.advance(1);
      elapsed += 1;
    }
    loader.dispose();
  });
  return elapsed;
}

test('a same-range replacement keeps the original countdown, another range restarts it', () => {
  expect(indicatorShowsAfterReplacement({ ...RANGE, endMs: RANGE.endMs - 1 })).toBe(SPINNER_DELAY_MS);
  expect(indicatorShowsAfterReplacement({ fromMs: RANGE.fromMs + 1000, endMs: RANGE.endMs })).toBe(
    5000 + SPINNER_DELAY_MS,
  );
});

test('a kept-profile refresh follows the same 6 second rule', () =>
  withFakeClock((clock) => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    market.publisher.publishTickProfile(resultFor(market.requests[0]));
    loader.requestProfile(RANGE, { keepProfile: true });
    expectIndicatorAtDelay({ state } as Created, clock);
    expect(state.profile).toBeDefined();
    loader.dispose();
  }));

test('a window with nothing to request shows no indicator and leaves no timer', () =>
  withFakeClock((clock) => {
    const { loader, state } = createLoader();
    loader.requestProfile(RANGE);
    loader.requestProfile({ fromMs: QUOTE_TIME_MS + 1, endMs: RANGE.endMs });
    expectNeverShown(state, clock);
  }));

test('dispose clears the countdown and the visible indicator repaint loop', () =>
  withFakeClock((clock) => {
    const { loader, state } = createLoader();
    loader.requestProfile(RANGE);
    expect(clock.pendingTimerCount()).toBe(1);
    loader.dispose();
    expect(clock.pendingTimerCount()).toBe(0);

    const shown = createLoader();
    shown.loader.requestProfile(RANGE);
    clock.advance(SPINNER_DELAY_MS);
    expect(shown.state.loadingIndicator).toBe(true);
    shown.loader.dispose();
    expect(shown.state.loadingIndicator).toBeFalsy();
    expect(clock.pendingTimerCount()).toBe(0);
    expect(state.loadingIndicator).toBeFalsy();
  }));

test('renewing after a timeframe switch re-sends an unsettled request and leaves a loaded profile alone', () =>
  withFakeClock(() => {
    const { loader, market, state } = createLoader();
    loader.requestProfile(RANGE);
    market.publisher.publishTickProfileCancelled(market.requests[0]);
    loader.renewUnsettledRequest(RANGE);
    expect(market.requests).toHaveLength(2);
    market.publisher.publishTickProfile(resultFor(market.requests[1]));
    expect(state.profile).toBeDefined();
    loader.renewUnsettledRequest(RANGE);
    expect(market.requests).toHaveLength(2);
  }));
