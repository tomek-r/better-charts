import { test, expect } from '@playwright/test';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import type { TickProfileRequest } from '../src/features/bridge/marketDataPort';
import { DEFAULT_PROFILE_REQUEST_PARAMS } from '../src/features/tools/fixedRangeProfile/requests/fixedRangeProfileRequester';
import { TickProfileRequestQueue } from '../src/features/tools/fixedRangeProfile/requests/tickProfileRequestQueue';

/**
 * The queue that lets many drawings share a backend that computes one tick profile at a time: it sends
 * one request, holds the others in their arrival order, and frees the backend when the load in flight
 * ends. The windows are told apart by their end, so every assertion names one request exactly.
 */

const SYMBOL = 'DEMO.TEST';
const SAFETY_MS = 300_000;
const START_MS = Date.now();

type Market = ReturnType<typeof createFakeMarketDataPort>;
type EndLoad = (market: Market, request: TickProfileRequest) => void;

const requestFor = (endMs: number): TickProfileRequest => ({
  symbol: SYMBOL,
  fromMs: START_MS,
  endMs,
  ...DEFAULT_PROFILE_REQUEST_PARAMS,
});
const FIRST = requestFor(START_MS + 60_000);
const SECOND = requestFor(START_MS + 120_000);
const REPLACEMENT = requestFor(START_MS + 180_000);

function createQueue() {
  const market = createFakeMarketDataPort();
  let nowMs = START_MS;
  const queue = new TickProfileRequestQueue(market.port, () => nowMs);
  return {
    queue,
    market,
    /** Moves the injected clock the queue's safety net reads. */
    advanceTo: (timeMs: number) => {
      nowMs = timeMs;
    },
  };
}

/** Sends the first owner's request and the second owner's, so the second one waits its turn. */
function createTwoOwnerQueue() {
  const session = createQueue();
  session.queue.portFor('first').requestTickProfile(FIRST);
  session.queue.portFor('second').requestTickProfile(SECOND);
  return session;
}

const publishResult: EndLoad = (market, request) =>
  market.publisher.publishTickProfile(profileResultFor(request, SYMBOL));
const publishCancelled: EndLoad = (market, request) => market.publisher.publishTickProfileCancelled(request);
const publishFailed: EndLoad = (market, request) =>
  market.publisher.publishTickProfileError({ ...request, message: 'x' });

/** Every way the backend can end the load in flight. */
const OUTCOMES: ReadonlyArray<{ name: string; end: EndLoad }> = [
  { name: 'a result', end: publishResult },
  { name: 'a cancellation', end: publishCancelled },
  { name: 'an error', end: publishFailed },
];

test('the first request is sent at once and the second owner waits its turn', () => {
  const { market } = createTwoOwnerQueue();
  expect(market.requests).toEqual([FIRST]);
});

for (const { name, end } of OUTCOMES) {
  test(`${name} of the load in flight sends the waiting request`, () => {
    const { market } = createTwoOwnerQueue();
    end(market, FIRST);
    expect(market.requests).toEqual([FIRST, SECOND]);
  });
}

test('an event for another window leaves the queue as it is', () => {
  const { market } = createTwoOwnerQueue();
  publishCancelled(market, { ...FIRST, endMs: FIRST.endMs + 1 });
  expect(market.requests).toEqual([FIRST]);
});

test('a waiting owner asks again and replaces its waiting request', () => {
  const { queue, market } = createTwoOwnerQueue();
  queue.portFor('second').requestTickProfile(REPLACEMENT);
  expect(market.requests).toEqual([FIRST]);
  publishResult(market, FIRST);
  expect(market.requests).toEqual([FIRST, REPLACEMENT]);
});

test('the owner in flight asks again at once, which replaces that load', () => {
  const { queue, market } = createTwoOwnerQueue();
  queue.portFor('first').requestTickProfile(REPLACEMENT);
  expect(market.requests).toEqual([FIRST, REPLACEMENT]);
  expect(market.cancelCount()).toBe(0);
});

test('cancelling the owner in flight sends the waiting request without a backend cancel', () => {
  const { queue, market } = createTwoOwnerQueue();
  queue.portFor('first').cancelTickProfile();
  expect(market.cancelCount()).toBe(0);
  expect(market.requests).toEqual([FIRST, SECOND]);
});

test('cancelling the owner in flight with nothing waiting sends one backend cancel and no request', () => {
  const { queue, market } = createQueue();
  queue.portFor('first').requestTickProfile(FIRST);
  queue.portFor('first').cancelTickProfile();
  expect(market.cancelCount()).toBe(1);
  expect(market.requests).toEqual([FIRST]);
});

test('cancelling a waiting owner sends nothing to the backend', () => {
  const { queue, market } = createTwoOwnerQueue();
  queue.portFor('second').cancelTickProfile();
  expect(market.cancelCount()).toBe(0);
  publishResult(market, FIRST);
  expect(market.requests).toEqual([FIRST]);
});

test('releasing a waiting owner drops its request without a backend cancel', () => {
  const { queue, market } = createTwoOwnerQueue();
  queue.release('second');
  publishResult(market, FIRST);
  expect(market.requests).toEqual([FIRST]);
  expect(market.cancelCount()).toBe(0);
});

test('clear forgets the load in flight and the waiting requests without a backend cancel', () => {
  const { queue, market } = createTwoOwnerQueue();
  queue.clear();
  expect(market.cancelCount()).toBe(0);
  publishResult(market, FIRST);
  expect(market.requests).toEqual([FIRST]);
  // Nothing is left to block the backend: the next request leaves at once.
  queue.portFor('third').requestTickProfile(REPLACEMENT);
  expect(market.requests).toEqual([FIRST, REPLACEMENT]);
});

test('cancelling the load in flight is the one backend cancel a reset sends', () => {
  const { queue, market } = createQueue();
  queue.portFor('first').requestTickProfile(FIRST);
  queue.cancelInFlight();
  expect(market.cancelCount()).toBe(1);
  queue.clear();
  expect(market.cancelCount()).toBe(1);
});

test('an in-flight request older than the safety net no longer blocks the queue', () => {
  const { queue, market, advanceTo } = createQueue();
  queue.portFor('first').requestTickProfile(FIRST);
  advanceTo(START_MS + SAFETY_MS);
  queue.portFor('second').requestTickProfile(SECOND);
  expect(market.requests).toEqual([FIRST]);
  advanceTo(START_MS + SAFETY_MS + 1);
  queue.portFor('second').requestTickProfile(SECOND);
  expect(market.requests).toEqual([FIRST, SECOND]);
});

test('dispose unsubscribes, so a later event sends nothing', () => {
  const session = createTwoOwnerQueue();
  session.queue.dispose();
  publishResult(session.market, FIRST);
  expect(session.market.requests).toEqual([FIRST]);
});
