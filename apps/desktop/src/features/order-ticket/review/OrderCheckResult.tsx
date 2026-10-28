import type { ReactNode } from 'react';
import { ErrorNotification } from '../../../shared/ui/notification/ErrorNotifications';
import type {
  AccountSnapshot,
  MarginRisk,
  OrderCheckResult as OrderCheckResultModel,
} from '../../../shared/bridge/types';
import { formatAccountMoney, formatMarginThreshold } from '../../../shared/accountFormat';
import { parseToFiniteNumber } from '../../../shared/finiteNumber';
import { Separated } from '../../../shared/ui/icons/SeparatorIcon';
import { formatOrderMetric, formatQuoted } from './ticketFormatting';

type ReviewAccount = Pick<
  AccountSnapshot,
  'currency' | 'currencyDigits' | 'marginCallLevel' | 'stopOutLevel' | 'marginLevelsUnit'
>;

const MARGIN_WARNING: Partial<Record<MarginRisk, { text: string; className: string }>> = {
  below_margin_call: { text: 'Below margin call', className: 'margin-risk-below-margin-call' },
  below_stop_out: { text: 'Below stop out', className: 'margin-risk-below-stop-out' },
};

function Cell({ label, value, riskClass }: { label: string; value: ReactNode; riskClass?: string }) {
  return (
    <div>
      <small>{label}</small>
      <b className={riskClass}>{value}</b>
    </div>
  );
}

/** What the ticket itself holds; shown until (or instead of) the broker's echo, never as a broker value. */
export type LocalOrderFigures = {
  entry: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  volume: string;
};

/**
 * Order data block of the review stage. It always renders the same rows: the OrderCheck figures
 * when a result exists, the ticket's own prices and units otherwise, and "—" for what only MT5 can answer.
 */
export function OrderCheckResult({
  orderCheck,
  local,
  account,
}: {
  orderCheck: OrderCheckResultModel | undefined;
  local: LocalOrderFigures;
  account: ReviewAccount | undefined;
}) {
  const money = (value: string | null | undefined) => formatAccountMoney(value, account) ?? '—';
  const levelAfterFill = parseToFiniteNumber(orderCheck?.marginLevelAfterFill);
  const levelText = levelAfterFill === undefined ? '—' : `${levelAfterFill.toFixed(2)}%`;
  const threshold = (value: string | null | undefined) => formatMarginThreshold(value, account) ?? '—';
  const warning = MARGIN_WARNING[orderCheck?.marginRisk ?? 'unknown'];
  const riskClass = warning?.className;
  const stopLoss = orderCheck ? orderCheck.stopLoss : local.stopLoss;
  const takeProfit = orderCheck ? orderCheck.takeProfit : local.takeProfit;
  const marginThresholds = [
    `Margin call ${threshold(account?.marginCallLevel)}`,
    `Stop out ${threshold(account?.stopOutLevel)}`,
  ];
  return (
    <div className="order-check-result" aria-label="MT5 OrderCheck result">
      {orderCheck?.checkPassed && orderCheck.lastError !== 0 && (
        <ErrorNotification message={`Last error code ${orderCheck.lastError}`} />
      )}
      <div className="order-check-grid">
        <Cell label="Used price" value={orderCheck ? formatOrderMetric(orderCheck.checkPrice) : '—'} />
        <Cell label="Requested entry" value={formatOrderMetric(orderCheck ? orderCheck.requestedEntry : local.entry)} />
        {stopLoss && <Cell label="Stop loss" value={formatOrderMetric(stopLoss)} />}
        {takeProfit && <Cell label="Take profit" value={formatOrderMetric(takeProfit)} />}
        <Cell label="Margin at fill" value={money(orderCheck?.marginAtFill)} />
        <Cell label="Free margin after fill" value={money(orderCheck?.freeMarginAfterFill)} riskClass={riskClass} />
        <Cell label="Units" value={formatOrderMetric(orderCheck ? orderCheck.volume : local.volume)} />
        <Cell label="Margin level after fill" value={levelText} riskClass={riskClass} />
      </div>
      <div className="order-check-margin-note">
        <small>
          <Separated parts={marginThresholds} />
        </small>
        {warning && (
          <strong className={`order-check-margin-warning ${riskClass}`} role="status">
            {warning.text}
          </strong>
        )}
      </div>
      {/* Without a check the row stays as an invisible blank line so the card height does not jump on the result. */}
      {orderCheck ? (
        <small className="order-check-time">Checked {formatQuoted(orderCheck.checkedAtMs)}</small>
      ) : (
        <small className="order-check-time order-check-time-reserved" aria-hidden="true">
          &nbsp;
        </small>
      )}
    </div>
  );
}
