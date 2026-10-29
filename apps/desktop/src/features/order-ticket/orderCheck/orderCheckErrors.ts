/** Leads the error shown when the OrderCheck request itself is rejected; the rejection reason may follow after ": ". */
export const ORDER_CHECK_REQUEST_FAILED = 'OrderCheck could not be requested';

const STOP_LOSS_TOO_CLOSE = 'stop_loss too close:';

/**
 * The EA/Rust preflight's stop-distance rejection; the ticket shows it inline, so it raises no toast, whether it
 * arrives bare (check result) or behind the request-failed prefix (rejected command).
 */
export function withoutStopLossTooClose(message: string | undefined): string | undefined {
  const isStopLossTooClose =
    message?.startsWith(STOP_LOSS_TOO_CLOSE) ||
    message?.startsWith(`${ORDER_CHECK_REQUEST_FAILED}: ${STOP_LOSS_TOO_CLOSE}`);
  return isStopLossTooClose ? undefined : message;
}
