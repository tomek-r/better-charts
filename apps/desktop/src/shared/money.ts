import type { BrokerSymbol, RiskSide } from './bridge/types';

export type AccountMoneyBasis = {
  currency: string;
  currencyDigits?: number;
  tickSize: number;
  tickValueProfit: number;
  tickValueLoss: number;
};

/** Display estimates only; broker quotes remain authoritative for sizing. */
export function accountMoneyBasis(
  instrument: BrokerSymbol | undefined,
  currency: string | undefined,
  currencyDigits = 2,
): AccountMoneyBasis | undefined {
  if (!instrument || !currency?.trim() || instrument.tickValueCurrency !== currency) {
    return undefined;
  }
  const tickSize = Number(instrument.tickSize);
  const tickValueProfit = Number(instrument.tickValueProfit);
  const tickValueLoss = Number(instrument.tickValueLoss);
  if (![tickSize, tickValueProfit, tickValueLoss].every((value) => Number.isFinite(value) && value > 0)) {
    return undefined;
  }
  return { currency, currencyDigits, tickSize, tickValueProfit, tickValueLoss };
}

export function estimateLevelMoney(
  entry: number,
  level: number,
  volume: number,
  side: RiskSide,
  money: AccountMoneyBasis,
): number | undefined {
  if (
    ![entry, level, volume, money.tickSize, money.tickValueProfit, money.tickValueLoss].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    (side !== 'buy' && side !== 'sell')
  ) {
    return undefined;
  }
  const ticks = ((level - entry) * (side === 'buy' ? 1 : -1)) / money.tickSize;
  const amount = ticks * (ticks < 0 ? money.tickValueLoss : money.tickValueProfit) * volume;
  return Number.isFinite(amount) ? amount : undefined;
}

export function currencyFractionDigits(digits: number | undefined): number {
  return digits !== undefined && Number.isInteger(digits) && digits >= 0 && digits <= 8 ? digits : 2;
}
