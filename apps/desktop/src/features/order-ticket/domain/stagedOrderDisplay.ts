import type {
  AccountSnapshot,
  BrokerSymbol,
  MarketSnapshot,
  OrderKind,
  RiskPreview,
  RiskSide,
} from '../../../shared/bridge/types';
import { formatSignedMoney } from '../../../shared/format';
import { accountMoneyBasis, estimateLevelMoney } from '../../../shared/money';
import { orderEntryPrice, riskRewardRatio } from './ticketRules';

export interface StagedOrderDisplayInput {
  instrument: BrokerSymbol | undefined;
  account: AccountSnapshot | undefined;
  snapshot: MarketSnapshot;
  riskSide: RiskSide;
  entry: string;
  limitPrice: string;
  orderKind: OrderKind;
  stopLoss: string;
  takeProfit: string;
  slOn: boolean;
  tpOn: boolean;
  effectiveVolume: string;
  unitsMode: 'money' | 'equity' | 'units';
  riskPreview: RiskPreview | undefined;
  draftVersion: number;
  lastPreview?: RiskPreview;
}

/** Display estimates only: the chart and ticket share these values, while
 * broker sizing and submission keep their own freshness and execution gates. */
export function deriveStagedOrderDisplay(input: StagedOrderDisplayInput) {
  const currency = input.account?.currency;
  const entry = orderEntryPrice(input.orderKind, input.entry, input.limitPrice);
  const volume = Number(input.effectiveVolume);
  const money = accountMoneyBasis(input.instrument, currency, input.account?.currencyDigits);
  const current = input.riskPreview;
  const currentMatches =
    input.unitsMode !== 'units' &&
    current &&
    current.draftVersion === input.draftVersion &&
    current.symbol === input.snapshot.symbol &&
    current.side === input.riskSide &&
    current.volume === input.effectiveVolume &&
    current.currency === currency;
  const preview = currentMatches ? current : input.lastPreview;
  const previewMatches =
    preview &&
    preview.symbol === input.snapshot.symbol &&
    preview.side === input.riskSide &&
    preview.currency === currency;

  // Project the last broker amount onto the edited price and current units.
  // This is a local display estimate; only a new broker response sizes orders.
  const previewAmount = (kind: 'sl' | 'tp'): number | undefined => {
    if (!previewMatches || !preview) {
      return undefined;
    }
    const amount = kind === 'sl' ? -Number(preview.estimatedRisk) : Number(preview.estimatedReward);
    const previousLevel = kind === 'sl' ? preview.stopLoss : preview.takeProfit;
    if (previousLevel == null || (kind === 'tp' && preview.estimatedReward == null)) {
      return undefined;
    }
    const oldDistance = Number(previousLevel) - Number(preview.entry);
    const newDistance = Number(kind === 'sl' ? input.stopLoss : input.takeProfit) - Number(entry);
    const previousVolume = Number(preview.volume);
    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(oldDistance) ||
      oldDistance === 0 ||
      previousVolume <= 0 ||
      !Number.isFinite(previousVolume)
    ) {
      return undefined;
    }
    const projected = amount * (newDistance / oldDistance) * (volume / previousVolume);
    return Number.isFinite(projected) ? projected : undefined;
  };

  const levelAmount = (price: string, enabled: boolean): number | undefined => {
    if (!enabled || !price.trim() || !money) {
      return undefined;
    }
    return estimateLevelMoney(Number(entry), Number(price), volume, input.riskSide, money);
  };
  const stopSet =
    input.slOn && input.stopLoss.trim() !== '' && Number(input.stopLoss) > 0 && Number.isFinite(Number(input.stopLoss));
  const targetSet =
    input.tpOn &&
    input.takeProfit.trim() !== '' &&
    Number(input.takeProfit) > 0 &&
    Number.isFinite(Number(input.takeProfit));
  let loss: number | undefined;
  if (stopSet) {
    const projected = previewAmount('sl');
    if (projected !== undefined) {
      loss = projected;
    } else {
      loss = levelAmount(input.stopLoss, input.slOn);
    }
  }
  let reward: number | undefined;
  if (targetSet) {
    reward = previewAmount('tp') ?? levelAmount(input.takeProfit, input.tpOn);
  }
  // Risk budget is a ceiling, not the loss for the effective volume. Margin
  // caps can reduce actual exposure well below that ceiling.
  const estimate =
    loss !== undefined && loss < 0 && reward !== undefined && reward >= 0
      ? { estimatedRisk: String(-loss), estimatedReward: String(reward) }
      : undefined;
  return {
    slMoney:
      currency && loss !== undefined ? formatSignedMoney(loss, currency, input.account?.currencyDigits) : undefined,
    tpMoney:
      currency && reward !== undefined ? formatSignedMoney(reward, currency, input.account?.currencyDigits) : undefined,
    riskRewardLabel:
      stopSet && targetSet
        ? riskRewardRatio(input.riskSide, entry, input.stopLoss, input.takeProfit, estimate)
        : undefined,
  };
}
