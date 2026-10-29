import type { RiskPreview, RiskSide } from '../bridge/types';

/** Prefer broker account-currency estimates; price distances are a fallback. */
export function riskRewardRatio(
  side: RiskSide,
  entry: string | number,
  stopLoss: string | number,
  takeProfit: string | number,
  estimate?: Pick<RiskPreview, 'estimatedRisk' | 'estimatedReward'>,
): string | undefined {
  const entryPrice = Number(entry);
  const stopPrice = Number(stopLoss);
  const targetPrice = Number(takeProfit);
  if (![entryPrice, stopPrice, targetPrice].every((price) => Number.isFinite(price) && price > 0)) {
    return undefined;
  }
  const risk = side === 'buy' ? entryPrice - stopPrice : stopPrice - entryPrice;
  const reward = side === 'buy' ? targetPrice - entryPrice : entryPrice - targetPrice;
  if (risk <= 0 || reward <= 0) {
    return undefined;
  }
  if (estimate?.estimatedReward != null) {
    const estimatedRisk = Number(estimate.estimatedRisk);
    const estimatedReward = Number(estimate.estimatedReward);
    if (
      Number.isFinite(estimatedRisk) &&
      estimatedRisk > 0 &&
      Number.isFinite(estimatedReward) &&
      estimatedReward >= 0
    ) {
      return (estimatedReward / estimatedRisk).toFixed(2);
    }
  }
  return (reward / risk).toFixed(2);
}
