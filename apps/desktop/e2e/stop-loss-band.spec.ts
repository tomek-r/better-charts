import { expect, test } from '@playwright/test';
import { deriveStopLossBand, type StopLossBandInput } from '../src/features/order-ticket/domain/stopLossBand';
import { deriveOrderRiskBasis } from '../src/features/order-ticket/domain/riskBasis';
import { accountMoneyBasis, estimateLevelMoney } from '../src/shared/money';
import { brokerSymbolFixture } from './helpers/tauriStub';

// US100-like CFD: 1 account unit per point per lot, 0.01 tick, 0.1 minimum lot.
const instrument = brokerSymbolFixture('US100', 'US Tech 100', {
  digits: 2,
  tickSize: '0.01',
  pointSize: '0.01',
  tickValueProfit: '0.01',
  tickValueLoss: '0.01',
  volumeMin: '0.1',
  volumeMax: '100',
  volumeStep: '0.1',
});
const base: StopLossBandInput = {
  instrument,
  account: { currency: 'USD', currencyDigits: 2 },
  unitsMode: 'equity',
  riskBudget: '6.25',
  side: 'buy',
  orderKind: 'limit',
  entry: '20000',
  limitPrice: '',
  quote: undefined,
};

test('buy: farthest SL is where the minimum lot spends the whole risk budget', () => {
  const band = deriveStopLossBand(base)!;
  // 6.25 USD / (0.1 lot x 1 USD per point per lot) = 62.5 points below entry.
  expect(band.farPrice).toBeCloseTo(19937.5, 8);
  // Broker minimum is 20 ticks (0.20); the guard needs STRICTLY more.
  expect(band.nearPrice).toBeCloseTo(19999.79, 8);
  expect(band.empty).toBe(false);
});

test('the far edge costs at most the budget under the SL money-label model, within one tick of it', () => {
  const money = accountMoneyBasis(instrument, 'USD', 2)!;
  const oneTickMoney = money.tickValueLoss * Number(instrument.volumeMin);
  for (const side of ['buy', 'sell'] as const) {
    const band = deriveStopLossBand({ ...base, side })!;
    const loss = -estimateLevelMoney(20000, band.farPrice, Number(instrument.volumeMin), side, money)!;
    expect(loss).toBeLessThanOrEqual(6.25 + 1e-9);
    expect(loss).toBeGreaterThan(6.25 - oneTickMoney - 1e-9);
  }
});

test('percent risk: the far edge never costs more than the unrounded budget the native sizing receives', () => {
  // 3% of 124.96 USD = 3.7488 USD; the displayed estimate rounds up to 3.75 and must not size the band.
  const basis = deriveOrderRiskBasis({
    unitsMode: 'equity',
    riskAmount: '3',
    equity: '124.96',
    equityAllocationPercent: '100',
    currency: 'USD',
    currencyDigits: 2,
    stagedOnChart: true,
  });
  expect(basis.effectiveRiskAmount).toBe('3.75');
  const money = accountMoneyBasis(instrument, 'USD', 2)!;
  const volumeMin = Number(instrument.volumeMin);
  for (const side of ['buy', 'sell'] as const) {
    const band = deriveStopLossBand({ ...base, side, entry: '30482.43', riskBudget: basis.sizingRiskAmount })!;
    const loss = -estimateLevelMoney(30482.43, band.farPrice, volumeMin, side, money)!;
    expect(loss).toBeLessThanOrEqual(3.7488 + 1e-9);
  }
});

test('sell mirrors the band above the entry', () => {
  const band = deriveStopLossBand({ ...base, side: 'sell' })!;
  expect(band.farPrice).toBeCloseTo(20062.5, 8);
  expect(band.nearPrice).toBeCloseTo(20000.21, 8);
});

test('stops level beyond 20 ticks raises the nearest SL', () => {
  const band = deriveStopLossBand({ ...base, instrument: { ...instrument, stopsLevel: 500 } })!;
  expect(band.nearPrice).toBeCloseTo(19994.99, 8);
});

test('required volume above volumeMax pushes the nearest SL out', () => {
  const band = deriveStopLossBand({ ...base, instrument: { ...instrument, volumeMax: '1' } })!;
  // 6.25 / (1 lot x 1) = 6.25 points: any closer needs more than 1 lot.
  expect(band.nearPrice).toBeCloseTo(19993.75, 8);
});

test('a budget too small for any allowed distance yields an empty band', () => {
  const band = deriveStopLossBand({ ...base, riskBudget: '0.01' })!;
  expect(band.empty).toBe(true);
  expect(band.emptyHint).toBe('Risk is too low for 0.1 units at any allowed SL distance');
});

test('stop_limit measures from its resting limit price', () => {
  const band = deriveStopLossBand({ ...base, orderKind: 'stop_limit', entry: '20010', limitPrice: '20000' })!;
  expect(band.farPrice).toBeCloseTo(19937.5, 8);
});

test('market orders measure the stop guard from the quote side but risk from the entry', () => {
  const band = deriveStopLossBand({
    ...base,
    orderKind: 'market',
    entry: '20000.4',
    quote: {
      symbol: 'US100',
      timeMs: 0,
      bid: '20000',
      ask: '20000.4',
      last: '20000',
      volume: 0,
      volumeReal: '0',
      flags: 0,
    },
  })!;
  expect(band.nearPrice).toBeCloseTo(19999.79, 8); // bid - 0.21
  expect(band.farPrice).toBeCloseTo(19937.9, 8); // ask - 62.5
});

test('units mode, missing or foreign-currency metadata and invalid budgets add no band', () => {
  expect(deriveStopLossBand({ ...base, unitsMode: 'units' })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, instrument: undefined })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, account: { currency: 'PLN', currencyDigits: 2 } })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, instrument: { ...instrument, tickValueLoss: null } })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, riskBudget: '' })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, riskBudget: '0' })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, entry: '' })).toBeUndefined();
  expect(deriveStopLossBand({ ...base, instrument: { ...instrument, volumeMin: 'x' } })).toBeUndefined();
});
