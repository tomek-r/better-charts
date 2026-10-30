import { test, expect } from '@playwright/test';
import { BrokerTime } from '../src/features/chart/engine/brokerTime/brokerTime';

const SYMBOL = 'XBRUSD';
const OTHER_SYMBOL = 'EURUSD';
const SESSION = 'session-1';
const TICK_GAP_MS = 1000;
const BROKER_OFFSET_MINUTES = 180;
const MS_PER_MINUTE = 60_000;

function liveBrokerTime(): { brokerTime: BrokerTime; liveTickMs: number } {
  const brokerTime = new BrokerTime();
  brokerTime.setConnection('connected', SESSION);
  const cachedTickMs = Date.now();
  const liveTickMs = cachedTickMs + TICK_GAP_MS;
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: cachedTickMs });
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: liveTickMs });
  return { brokerTime, liveTickMs };
}

test('a disconnected bridge never makes broker time live', () => {
  const brokerTime = new BrokerTime();
  const tickMs = Date.now();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: tickMs });
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: tickMs + TICK_GAP_MS });
  expect(brokerTime.read()).toBeNull();
});

test('a newer tick for the same symbol makes broker time live', () => {
  const brokerTime = new BrokerTime();
  brokerTime.setConnection('connected', SESSION);
  const cachedTickMs = Date.now();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: cachedTickMs });
  // The connect-time snapshot may be a closed market's cached last tick, so it cannot anchor the clock.
  expect(brokerTime.read()).toBeNull();
  const liveTickMs = cachedTickMs + TICK_GAP_MS;
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: liveTickMs });
  const reading = brokerTime.read();
  expect(reading?.symbol).toBe(SYMBOL);
  expect(reading?.nowMs).toBeGreaterThanOrEqual(liveTickMs);
  expect(reading?.nowMs).toBeLessThan(liveTickMs + TICK_GAP_MS);
  expect(reading?.ageMs).toBeGreaterThanOrEqual(0);
});

test('a repeated or older tick leaves broker time where it was', () => {
  const { brokerTime, liveTickMs } = liveBrokerTime();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: liveTickMs });
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: liveTickMs - TICK_GAP_MS });
  expect(brokerTime.read()?.nowMs).toBeGreaterThanOrEqual(liveTickMs);
});

test('a tick for another symbol is not live', () => {
  const brokerTime = new BrokerTime();
  brokerTime.setConnection('connected', SESSION);
  const tickMs = Date.now();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: tickMs });
  brokerTime.acceptQuote({ symbol: OTHER_SYMBOL, timeMs: tickMs + TICK_GAP_MS });
  expect(brokerTime.read()).toBeNull();
});

test('a dropped connection clears broker time and a tick seen while disconnected cannot anchor it', () => {
  const { brokerTime, liveTickMs } = liveBrokerTime();
  expect(brokerTime.read()).not.toBeNull();
  brokerTime.setConnection('disconnected', SESSION);
  expect(brokerTime.read()).toBeNull();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: liveTickMs + TICK_GAP_MS });
  expect(brokerTime.read()).toBeNull();
  brokerTime.setConnection('connected', SESSION);
  expect(brokerTime.read()).toBeNull();
  const reconnectTickMs = liveTickMs + 2 * TICK_GAP_MS;
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: reconnectTickMs });
  expect(brokerTime.read()?.nowMs).toBeGreaterThanOrEqual(reconnectTickMs);
});

test('a new session identity clears a live clock', () => {
  const { brokerTime } = liveBrokerTime();
  expect(brokerTime.read()).not.toBeNull();
  brokerTime.setConnection('connected', 'session-2');
  expect(brokerTime.read()).toBeNull();
});

test('broker time reaches UTC through the broker offset, and is unknown until live', () => {
  const brokerTime = new BrokerTime();
  brokerTime.setConnection('connected', SESSION);
  expect(brokerTime.utcNowMs(BROKER_OFFSET_MINUTES)).toBeNull();
  const cachedTickMs = Date.now();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: cachedTickMs });
  expect(brokerTime.utcNowMs(BROKER_OFFSET_MINUTES)).toBeNull();
  brokerTime.acceptQuote({ symbol: SYMBOL, timeMs: cachedTickMs + TICK_GAP_MS });
  const brokerNowMs = brokerTime.read()?.nowMs ?? 0;
  const utcNowMs = brokerTime.utcNowMs(BROKER_OFFSET_MINUTES);
  expect(utcNowMs).not.toBeNull();
  expect(Math.abs((utcNowMs ?? 0) - (brokerNowMs - BROKER_OFFSET_MINUTES * MS_PER_MINUTE))).toBeLessThan(TICK_GAP_MS);
});
