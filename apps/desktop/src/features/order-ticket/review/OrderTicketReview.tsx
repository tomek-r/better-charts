import { ErrorNotification } from '../../../shared/ui/ErrorNotifications';
import { type Dispatch, type SetStateAction } from 'react';
import type { OrderCheckResult, RiskSide } from '../../../shared/bridge/types';
import { OrderCheckResult as OrderCheckResultView } from './OrderCheckResult';

export function OrderTicketReview({
  canSubmitOrder,
  effectiveVolume,
  orderCheck,
  orderCheckError,
  orderCheckLoading,
  orderKindDisplay,
  ticketBlockedReason,
  riskSide,
  setTicketStage,
  submitOrder,
  submitStatus,
  submittingSide,
}: {
  canSubmitOrder: boolean;
  effectiveVolume: string;
  orderCheck: OrderCheckResult | undefined;
  orderCheckError: string | undefined;
  orderCheckLoading: boolean;
  orderKindDisplay: string;
  ticketBlockedReason: string | undefined;
  riskSide: RiskSide;
  setTicketStage: Dispatch<SetStateAction<'edit' | 'review'>>;
  submitOrder: (side: RiskSide) => Promise<void>;
  submitStatus: { kind: 'locked' | 'error'; text: string } | undefined;
  submittingSide: RiskSide | undefined;
}) {
  return (
    <>
      <div className="ticket-review-head">
        <strong>Review order</strong>
        <span>
          {riskSide === 'buy' ? 'Buy' : 'Sell'} · {orderKindDisplay} · {effectiveVolume || '—'}
        </span>
      </div>
      {orderCheckLoading && !orderCheck && !orderCheckError && <p className="search-hint">Checking with MT5…</p>}
      {orderCheck && <OrderCheckResultView orderCheck={orderCheck} />}
      {orderCheck && orderCheck.checkPassed === false && (
        <ErrorNotification
          message={
            orderCheck.comment.trim() !== ''
              ? `${orderCheck.comment.trim()} (code ${orderCheck.retcode}). Adjust the ticket and start the review again.`
              : `Retcode ${orderCheck.retcode}. Adjust the ticket and start the review again.`
          }
        />
      )}
      {!submitStatus &&
        orderCheck &&
        !orderCheckError &&
        !orderCheckLoading &&
        !canSubmitOrder &&
        orderCheck.checkPassed && (
          <p className="ticket-blocked-reason" role="status">
            {ticketBlockedReason}
          </p>
        )}
      <div className="ticket-review-actions">
        <button
          className={`ticket-cta side-${riskSide} send`}
          disabled={!canSubmitOrder || submittingSide !== undefined}
          aria-busy={submittingSide !== undefined}
          onClick={() => void submitOrder(riskSide)}
        >
          {submittingSide !== undefined ? 'Sending…' : 'Send order'}
        </button>
        <button className="ticket-back" onClick={() => setTicketStage('edit')}>
          Cancel
        </button>
      </div>
    </>
  );
}
