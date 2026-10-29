import { formatSignedMoney } from '../../../../shared/format';
import { estimateLevelMoney, type AccountMoneyBasis } from '../../../../shared/money';
import type { RiskSide } from '../../../../shared/bridge/types';

/** Account-currency display estimates shared by live and staged labels. */
export function levelMoneyText(
  entry: number,
  level: number,
  volume: number,
  side: RiskSide,
  money: AccountMoneyBasis,
): string | undefined {
  const value = estimateLevelMoney(entry, level, volume, side, money);
  return value === undefined ? undefined : formatSignedMoney(value, money.currency, money.currencyDigits);
}
/** Signed money P&L in the ACCOUNT currency, the levelMoneyText format
 *  ("−6.63 USD" / "+1.04 USD") so the P&L box reads exactly like SL/TP money. */
export function pnlMoneyText(
  profit: string | undefined,
  currency: string | undefined,
  currencyDigits?: number,
): string | undefined {
  if (profit === undefined || profit.trim() === '' || !currency) {
    return undefined;
  }
  const value = Number(profit);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return formatSignedMoney(value, currency, currencyDigits);
}
