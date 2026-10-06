import { equityAllocationIssue } from './ticketRules';

export type OrderRiskBasis = {
  riskMode: 'usd' | 'equity';
  effectiveRiskAmount: string;
  equityValue: number | undefined;
  riskModeHint: string | undefined;
};

export function deriveOrderRiskBasis({
  unitsMode,
  riskAmount,
  equity,
  equityAllocationPercent = '100',
  currency,
  stagedOnChart,
}: {
  unitsMode: 'money' | 'equity' | 'units';
  riskAmount: string;
  equity: string | undefined;
  equityAllocationPercent?: string;
  currency: string | undefined;
  stagedOnChart: boolean;
}): OrderRiskBasis {
  const riskMode = unitsMode === 'equity' ? 'equity' : 'usd';
  const parsedEquity = equity?.trim() ? Number(equity) : NaN;
  const equityValue = Number.isFinite(parsedEquity) && parsedEquity > 0 ? parsedEquity : undefined;
  const parsedRisk = Number(riskAmount);
  const percentRiskAmount =
    riskMode === 'equity' &&
    equityValue !== undefined &&
    equityAllocationIssue(equityAllocationPercent) === undefined &&
    riskAmount.trim() !== '' &&
    Number.isFinite(parsedRisk) &&
    parsedRisk > 0
      ? ((parsedRisk / 100) * equityValue * (Number(equityAllocationPercent) / 100)).toFixed(2)
      : '';
  const effectiveRiskAmount = riskMode === 'usd' ? riskAmount : percentRiskAmount;
  let riskModeHint: string | undefined;
  if (riskMode === 'equity' && equityValue === undefined) {
    riskModeHint = stagedOnChart ? 'Account data required' : undefined;
  } else if (riskMode === 'equity' && percentRiskAmount) {
    riskModeHint = `≈ ${percentRiskAmount} ${currency ?? ''}`.trimEnd();
  }
  return { riskMode, effectiveRiskAmount, equityValue, riskModeHint };
}
