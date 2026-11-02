import { expect, test } from '@playwright/test';
import type { BridgeState, MarketSessionStatus } from '../src/shared/bridge/types';
import { marketStatusLabel, marketStatusOf } from '../src/features/chart/engine/legend/marketStatus';

/** The verdict and wording of the legend's market dot. Pure Node. */

const SERVER_TIME_MS = 1_770_000_000_000;

/** A session report for EURUSD, as the EA's heartbeat carries it; `overrides` adjusts one field. */
function report(overrides: Partial<MarketSessionStatus> = {}): MarketSessionStatus {
  return { symbol: 'EURUSD', isOpen: true, tradeMode: 4, serverTimeMs: SERVER_TIME_MS, ...overrides };
}

test('an open report for the shown symbol reads as open', () => {
  const status = marketStatusOf({ bridgeState: 'connected', session: report(), shownSymbol: 'EURUSD' });
  expect(status).toBe('open');
});

test('a closed report for the shown symbol reads as closed', () => {
  const status = marketStatusOf({
    bridgeState: 'connected',
    session: report({ isOpen: false }),
    shownSymbol: 'EURUSD',
  });
  expect(status).toBe('closed');
});

test('a disconnected bridge leaves the status unknown, whatever it last reported', () => {
  const status = marketStatusOf({ bridgeState: 'disconnected', session: report(), shownSymbol: 'EURUSD' });
  expect(status).toBe('unknown');
});

test('a connecting bridge leaves the status unknown', () => {
  const status = marketStatusOf({ bridgeState: 'connecting', session: report(), shownSymbol: 'EURUSD' });
  expect(status).toBe('unknown');
});

test('a protocol error leaves the status unknown', () => {
  const status = marketStatusOf({ bridgeState: 'protocol_error', session: report(), shownSymbol: 'EURUSD' });
  expect(status).toBe('unknown');
});

test('a report for another symbol says nothing about the shown one', () => {
  const status = marketStatusOf({
    bridgeState: 'connected',
    session: report({ symbol: 'NAS100' }),
    shownSymbol: 'EURUSD',
  });
  expect(status).toBe('unknown');
});

test('without a session report the shown symbol has no status', () => {
  const status = marketStatusOf({ bridgeState: 'connected', session: undefined, shownSymbol: 'EURUSD' });
  expect(status).toBe('unknown');
});

test('before the chart knows its symbol there is no status', () => {
  const status = marketStatusOf({ bridgeState: 'connected', session: report(), shownSymbol: undefined });
  expect(status).toBe('unknown');
});

test('an open market reads as Market open', () => {
  expect(marketStatusLabel({ status: 'open', bridgeState: 'connected' })).toBe('Market open');
});

test('a closed market reads as Market closed', () => {
  expect(marketStatusLabel({ status: 'closed', bridgeState: 'connected' })).toBe('Market closed');
});

const UNKNOWN_LABELS: ReadonlyArray<[BridgeState, string]> = [
  ['connected', 'Market status unknown'],
  ['disconnected', 'Market status unknown: MT5 disconnected'],
  ['connecting', 'Market status unknown: MT5 connecting'],
  ['protocol_error', 'Market status unknown: MT5 connection error'],
];

for (const [bridgeState, label] of UNKNOWN_LABELS) {
  test(`an unknown status on a ${bridgeState} bridge reads as ${label}`, () => {
    expect(marketStatusLabel({ status: 'unknown', bridgeState })).toBe(label);
  });
}
