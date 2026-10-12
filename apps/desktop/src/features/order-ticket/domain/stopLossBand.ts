import type { AccountSnapshot, BrokerSymbol, OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { volumeWithUnit } from '../../../shared/format';
import { accountMoneyBasis } from '../../../shared/money';
import { orderEntryPrice } from './ticketRules';

/**
 * Allowed stop-loss band for risk-sized orders, as absolute prices. Display and
 * gesture aid only: the backend/EA risk preview stays the sizing authority, so
 * any missing or inconsistent metadata yields `undefined` (no band, no clamp).
 */
export interface StopLossBand {
  /** Closest permitted SL (broker stop distance, or the volumeMax cap). */
  nearPrice: number;
  /** Farthest permitted SL: the minimum lot spends the whole risk budget. */
  farPrice: number;
  /** No price satisfies both edges: the shading and the clamp are skipped. */
  empty: boolean;
  nearHint: string;
  farHint: string;
  emptyHint: string;
}

export interface StopLossBandInput {
  instrument: BrokerSymbol | undefined;
  account: Pick<AccountSnapshot, 'currency' | 'currencyDigits'> | undefined;
  unitsMode: 'money' | 'equity' | 'units';
  /** Risk budget in the account currency (see deriveOrderRiskBasis). */
  riskBudget: string;
  /** Human wording of the budget for hints, e.g. "5%" or "10 USD". */
  riskLabel: string;
  side: RiskSide;
  orderKind: OrderKind;
  entry: string;
  limitPrice: string;
  quote: QuoteSnapshot | undefined;
}

export function stopLossRiskLabel(unitsMode: 'money' | 'equity' | 'units', riskAmount: string, currency = ''): string {
  const amount = riskAmount.trim();
  return unitsMode === 'equity' ? `${amount}%` : `${amount} ${currency}`.trimEnd();
}

// Prices live on the tick grid; the epsilon absorbs binary-float noise such as 0.3/0.1.
const GRID_EPSILON = 1e-9;
const onGrid = (value: number, digits: number) => Number(value.toFixed(digits));

export function deriveStopLossBand(input: StopLossBandInput): StopLossBand | undefined {
  const { instrument, side } = input;
  if (input.unitsMode === 'units' || !instrument) {
    return undefined;
  }
  const money = accountMoneyBasis(instrument, input.account?.currency, input.account?.currencyDigits);
  const budget = Number(input.riskBudget);
  const volumeMin = Number(instrument.volumeMin);
  const volumeMax = Number(instrument.volumeMax);
  const point = Number(instrument.pointSize);
  const referenceText = orderEntryPrice(input.orderKind, input.entry, input.limitPrice).trim();
  const entryReference = Number(referenceText);
  if (
    !money ||
    !Number.isFinite(budget) ||
    budget <= 0 ||
    !Number.isFinite(volumeMin) ||
    volumeMin <= 0 ||
    !Number.isFinite(volumeMax) ||
    volumeMax < volumeMin ||
    referenceText === '' ||
    !Number.isFinite(entryReference) ||
    entryReference <= 0 ||
    !Number.isInteger(instrument.digits)
  ) {
    return undefined;
  }
  const { tickSize } = money;
  // Same loss model as the SL money labels: converted tick loss per price unit per lot.
  const lossPerUnitPerLot = money.tickValueLoss / tickSize;
  const buy = side === 'buy';
  const digits = instrument.digits;

  // stopDistanceGuard requires distance > max(stopsLevel x point, 20 ticks).
  const stopsMinimum = Math.max(Number.isFinite(point) && point > 0 ? instrument.stopsLevel * point : 0, 20 * tickSize);
  const brokerNear = (Math.floor(stopsMinimum / tickSize + GRID_EPSILON) + 1) * tickSize;
  // Closer than this the required volume would exceed volumeMax.
  const volumeNear = Math.ceil(budget / (volumeMax * lossPerUnitPerLot) / tickSize - GRID_EPSILON) * tickSize;
  const volumeCapDominates = volumeNear > brokerNear;
  const nearDistance = Math.max(brokerNear, volumeNear);
  const farDistance = Math.floor(budget / (volumeMin * lossPerUnitPerLot) / tickSize + GRID_EPSILON) * tickSize;

  // Market stop-distance is measured from the quote side (BUY: bid, SELL: ask);
  // risk is always measured from the entry the sizing uses.
  const bid = Number(input.quote?.bid);
  const ask = Number(input.quote?.ask);
  const useQuote = input.orderKind === 'market' && bid > 0 && ask > 0;
  const quoteSide = buy ? bid : ask;
  const guardReference = useQuote ? quoteSide : entryReference;
  const signed = buy ? -1 : 1;
  const nearPrice = onGrid(guardReference + signed * nearDistance, digits);
  const farPrice = onGrid(entryReference + signed * farDistance, digits);
  const label = input.riskLabel;
  return {
    nearPrice,
    farPrice,
    empty: buy ? farPrice > nearPrice : farPrice < nearPrice,
    nearHint: volumeCapDominates
      ? `Min SL for ${label} risk at ${volumeWithUnit(instrument.volumeMax)}`
      : 'Min SL: broker stop distance',
    farHint: `Max SL for ${label} risk at ${volumeWithUnit(instrument.volumeMin)}`,
    emptyHint: `Risk is too low for ${volumeWithUnit(instrument.volumeMin)} at any allowed SL distance`,
  };
}
