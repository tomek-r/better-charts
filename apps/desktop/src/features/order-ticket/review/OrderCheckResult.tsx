import type { OrderCheckResult as OrderCheckResultModel } from '../../../shared/bridge/types';
import { formatOrderMetric, formatQuoted } from '../domain/ticketFormatting';

/** MT5 OrderCheck result panel shown in the ticket's review stage. */
export function OrderCheckResult({ orderCheck }: { orderCheck: OrderCheckResultModel }) {
  return (
    <div className="order-check-result" aria-label="MT5 OrderCheck result">
      {orderCheck.lastError !== 0 && <p className="error-text">Last error code {orderCheck.lastError}</p>}
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
          <b>{formatOrderMetric(orderCheck.margin)}</b>
        </div>
        <div>
          <small>Free margin</small>
          <b>{formatOrderMetric(orderCheck.freeMargin)}</b>
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
