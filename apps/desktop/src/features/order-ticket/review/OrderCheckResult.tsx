import { ErrorNotification } from '../../../shared/ui/ErrorNotifications';
import type { AccountSnapshot, OrderCheckResult as OrderCheckResultModel } from '../../../shared/bridge/types';
import { formatMoney } from '../../../shared/format';
import { formatOrderMetric, formatQuoted } from '../domain/ticketFormatting';

/** MT5 OrderCheck result panel shown in the ticket's review stage. */
export function OrderCheckResult({
  orderCheck,
  account,
}: {
  orderCheck: OrderCheckResultModel;
  account: AccountSnapshot | undefined;
}) {
  const money = (value: string) =>
    account?.currency && value.trim() && Number.isFinite(Number(value))
      ? formatMoney(Number(value), account.currency, account.currencyDigits)
      : '—';
  return (
    <div className="order-check-result" aria-label="MT5 OrderCheck result">
      {orderCheck.checkPassed && orderCheck.lastError !== 0 && (
        <ErrorNotification message={`Last error code ${orderCheck.lastError}`} />
      )}
      <div className="order-check-grid">
        <div>
          <small>Used price</small>
          <b>{formatOrderMetric(orderCheck.checkPrice)}</b>
        </div>
        <div>
          <small>Requested entry</small>
          <b>{formatOrderMetric(orderCheck.requestedEntry)}</b>
        </div>
        {orderCheck.stopLoss && (
          <div>
            <small>Stop loss</small>
            <b>{formatOrderMetric(orderCheck.stopLoss)}</b>
          </div>
        )}
        {orderCheck.takeProfit && (
          <div>
            <small>Take profit</small>
            <b>{formatOrderMetric(orderCheck.takeProfit)}</b>
          </div>
        )}
        <div>
          <small>Margin</small>
          <b>{money(orderCheck.margin)}</b>
        </div>
        <div>
          <small>Free margin</small>
          <b>{money(orderCheck.freeMargin)}</b>
        </div>
        <div>
          <small>Units</small>
          <b>{formatOrderMetric(orderCheck.volume)}</b>
        </div>
        <div>
          <small>Margin level</small>
          <b>{formatOrderMetric(orderCheck.marginLevel, orderCheck.marginLevel ? '%' : '')}</b>
        </div>
      </div>
      <small className="order-check-time">
        Checked {formatQuoted(orderCheck.checkedAtMs)} · Draft {orderCheck.draftId}
      </small>
    </div>
  );
}
