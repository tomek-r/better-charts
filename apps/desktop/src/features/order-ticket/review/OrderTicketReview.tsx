import { ErrorNotification } from '../../../shared/ui/notification/ErrorNotifications';
import { type Dispatch, type SetStateAction } from 'react';
import type { AccountSnapshot, OrderCheckResult, RiskSide } from '../../../shared/bridge/types';
import { Separated } from '../../../shared/ui/icons/SeparatorIcon';
import { OrderCheckResult as OrderCheckResultView, type LocalOrderFigures } from './OrderCheckResult';

function sendButtonLabel(submitting: boolean, checking: boolean): string {
  if (submitting) {
    return 'Sending…';
  }
  return checking ? 'Checking with MT5…' : 'Send order';
}

export function OrderTicketReview({
  account,
  canSubmitOrder,
  effectiveVolume,
  localFigures,
  orderCheck,
  orderCheckError,
  orderCheckLoading,
  orderKindDisplay,
  passedStopEntry,
  ticketBlockedReason,
  riskSide,
  setTicketStage,
  submitOrder,
  submitStatus,
  submittingSide,
}: {
  account:
    | Pick<AccountSnapshot, 'currency' | 'currencyDigits' | 'marginCallLevel' | 'stopOutLevel' | 'marginLevelsUnit'>
    | undefined;
  canSubmitOrder: boolean;
  effectiveVolume: string;
  localFigures: LocalOrderFigures;
  orderCheck: OrderCheckResult | undefined;
  orderCheckError: string | undefined;
  orderCheckLoading: boolean;
  orderKindDisplay: string;
  passedStopEntry: string | undefined;
  ticketBlockedReason: string | undefined;
  riskSide: RiskSide;
  setTicketStage: Dispatch<SetStateAction<'edit' | 'review'>>;
  submitOrder: (side: RiskSide) => Promise<void>;
  submitStatus: { kind: 'locked' | 'error'; text: string } | undefined;
  submittingSide: RiskSide | undefined;
}) {
  const submitting = submittingSide !== undefined;
  const checking = orderCheckLoading && !orderCheck && !orderCheckError;
  const blockedReasonShown =
    !submitStatus && orderCheck && !orderCheckError && !orderCheckLoading && !canSubmitOrder && orderCheck.checkPassed;
  return (
    <>
      <div className="ticket-review-head">
        <strong>Review order</strong>
        <span>
          <Separated parts={[riskSide === 'buy' ? 'Buy' : 'Sell', orderKindDisplay, effectiveVolume || '—']} />
        </span>
      </div>
      <OrderCheckResultView orderCheck={orderCheck} local={localFigures} account={account} />
      {orderCheck && orderCheck.checkPassed === false && (
        <ErrorNotification
          message={
            orderCheck.comment.trim() !== ''
              ? `${orderCheck.comment.trim()} (code ${orderCheck.retcode}). Adjust the ticket and start the review again.`
              : `Retcode ${orderCheck.retcode}. Adjust the ticket and start the review again.`
          }
        />
      )}
      {passedStopEntry && <ErrorNotification noticeKey="passed-stop-entry" message={passedStopEntry} />}
      {/* Reasons reach the user as notifications; the card carries no text above Send. */}
      {blockedReasonShown && <ErrorNotification message={ticketBlockedReason} />}
      <div className="ticket-review-actions">
        <button
          className={`ticket-cta side-${riskSide} send`}
          disabled={!canSubmitOrder || submitting}
          aria-busy={submitting || checking}
          onClick={() => void submitOrder(riskSide)}
        >
          {sendButtonLabel(submitting, checking)}
        </button>
        <button className="ticket-back" onClick={() => setTicketStage('edit')}>
          Cancel
        </button>
      </div>
    </>
  );
}
