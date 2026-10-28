import type { AccountSnapshot, BrokerSymbol, OrderKind, QuoteSnapshot, RiskSide } from '../../../shared/bridge/types';
import { volumeWithUnit } from '../../../shared/format';
import { accountMoneyBasis, lossPerPriceUnitPerLot } from '../../../shared/money';
import type { StagedSlBand } from '../../chart/engine/trading/slBand';
import { STOP_DISTANCE_MIN_TICKS } from '../exits/stopDistance';
import { orderEntryPrice } from '../pricing/orderEntryPrice';
import type { UnitsMode } from '../sizing/unitsMode';

/** The chart engine owns the band shape; the ticket derives it from the order draft. */
export type StopLossBand = StagedSlBand;

export interface StopLossBandInput {
  instrument: BrokerSymbol | undefined;
  account: Pick<AccountSnapshot, 'currency' | 'currencyDigits'> | undefined;
  unitsMode: UnitsMode;
  /** Risk budget in the account currency (see deriveOrderRiskBasis). */
  riskBudget: string;
  side: RiskSide;
  orderKind: OrderKind;
  entry: string;
  limitPrice: string;
  quote: QuoteSnapshot | undefined;
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
  const lossPerUnitPerLot = lossPerPriceUnitPerLot(money);
  const buy = side === 'buy';
  const digits = instrument.digits;

  // stopDistanceGuard requires distance > max(stopsLevel x point, STOP_DISTANCE_MIN_TICKS ticks).
  const stopsMinimum = Math.max(
    Number.isFinite(point) && point > 0 ? instrument.stopsLevel * point : 0,
    STOP_DISTANCE_MIN_TICKS * tickSize,
  );
  const brokerNear = (Math.floor(stopsMinimum / tickSize + GRID_EPSILON) + 1) * tickSize;
  // Closer than this the required volume would exceed volumeMax.
  const volumeNear = Math.ceil(budget / (volumeMax * lossPerUnitPerLot) / tickSize - GRID_EPSILON) * tickSize;
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
  return {
    nearPrice,
    farPrice,
    empty: buy ? farPrice > nearPrice : farPrice < nearPrice,
    emptyHint: `Risk is too low for ${volumeWithUnit(instrument.volumeMin)} at any allowed SL distance`,
  };
}
