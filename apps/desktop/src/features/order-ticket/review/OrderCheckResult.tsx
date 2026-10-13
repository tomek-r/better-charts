import type { ReactNode } from 'react';
import { ErrorNotification } from '../../../shared/ui/ErrorNotifications';
import type {
  AccountSnapshot,
  MarginRisk,
  OrderCheckResult as OrderCheckResultModel,
} from '../../../shared/bridge/types';
import { formatMoney } from '../../../shared/format';
import { formatOrderMetric, formatQuoted } from '../domain/ticketFormatting';

type ReviewAccount = Pick<
  AccountSnapshot,
  'currency' | 'currencyDigits' | 'marginCallLevel' | 'stopOutLevel' | 'marginLevelsUnit'
>;

const MARGIN_WARNING: Partial<Record<MarginRisk, { text: string; className: string }>> = {
  below_margin_call: { text: 'Below margin call', className: 'margin-risk-below-margin-call' },
  below_stop_out: { text: 'Below stop out', className: 'margin-risk-below-stop-out' },
};

function finiteNumber(value: string | null | undefined): number | undefined {
  return value !== null && value !== undefined && value.trim() !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : undefined;
}

function Cell({ label, value, riskClass }: { label: string; value: ReactNode; riskClass?: string }) {
  return (
    <div>
      <small>{label}</small>
      <b className={riskClass}>{value}</b>
    </div>
  );
}

/** MT5 OrderCheck result panel shown in the ticket's review stage. */
export function OrderCheckResult({
  orderCheck,
  account,
}: {
  orderCheck: OrderCheckResultModel;
  account: ReviewAccount | undefined;
}) {
  const money = (value: string | null | undefined) => {
    const amount = finiteNumber(value);
    return account?.currency && amount !== undefined
      ? formatMoney(amount, account.currency, account.currencyDigits)
      : '—';
  };
  const levelAfterFill = finiteNumber(orderCheck.marginLevelAfterFill);
  const levelText = levelAfterFill === undefined ? '—' : `${levelAfterFill.toFixed(2)}%`;
  // Threshold unit follows ACCOUNT_MARGIN_SO_MODE: percentages or account-currency amounts.
  const threshold = (value: string | null | undefined) => {
    const amount = finiteNumber(value);
    if (amount === undefined) {
      return '—';
    }
    if (account?.marginLevelsUnit === 'percent') {
      return `${amount}%`;
    }
    return account?.marginLevelsUnit === 'money' ? money(value) : '—';
  };
  const risk = orderCheck.marginRisk ?? 'unknown';
  const warning = MARGIN_WARNING[risk];
  const riskClass = warning?.className;
  return (
    <div className="order-check-result" aria-label="MT5 OrderCheck result">
      {orderCheck.checkPassed && orderCheck.lastError !== 0 && (
        <ErrorNotification message={`Last error code ${orderCheck.lastError}`} />
      )}
      <div className="order-check-grid">
        <Cell label="Used price" value={formatOrderMetric(orderCheck.checkPrice)} />
        <Cell label="Requested entry" value={formatOrderMetric(orderCheck.requestedEntry)} />
        {orderCheck.stopLoss && <Cell label="Stop loss" value={formatOrderMetric(orderCheck.stopLoss)} />}
        {orderCheck.takeProfit && <Cell label="Take profit" value={formatOrderMetric(orderCheck.takeProfit)} />}
        <Cell label="Margin at fill" value={money(orderCheck.marginAtFill)} />
        <Cell label="Free margin after fill" value={money(orderCheck.freeMarginAfterFill)} riskClass={riskClass} />
        <Cell label="Units" value={formatOrderMetric(orderCheck.volume)} />
        <Cell label="Margin level after fill" value={levelText} riskClass={riskClass} />
      </div>
      <div className="order-check-margin-note">
        <small>
          Margin call {threshold(account?.marginCallLevel)} · Stop out {threshold(account?.stopOutLevel)}
        </small>
        {warning && (
          <strong className={`order-check-margin-warning ${riskClass}`} role="status">
            {warning.text}
          </strong>
        )}
      </div>
      <small className="order-check-time">Checked {formatQuoted(orderCheck.checkedAtMs)}</small>
    </div>
  );
}
