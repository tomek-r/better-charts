import type { OrderKind } from '../../../shared/bridge/types';

/** Price used for entry-relative risk sizing: stop_limit executes from its resting price. */
export function orderEntryPrice(orderKind: OrderKind, entry: string, limitPrice: string): string {
  return orderKind === 'stop_limit' ? limitPrice : entry;
}

/** Only stop_limit carries a resting limit price, and it must be a positive number. */
export function isLimitPriceValid(orderKind: OrderKind, limitPrice: string): boolean {
  return (
    orderKind !== 'stop_limit' ||
    (limitPrice.trim() !== '' && Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0)
  );
}
