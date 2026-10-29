import { SIZING_NEEDS_STOP_MESSAGE } from '../sizing/unitsModeCopy';

export type TicketBlockedReasonConditions = {
  canSubmitOrder: boolean;
  bridgeConnected: boolean;
  accountAvailable: boolean;
  marketOpen: boolean | undefined;
  stagedOnChart: boolean;
  orderVolumeValid: boolean;
  effectiveVolume: string;
  volumeIssue: string | undefined;
  stopDistanceReason: string | undefined;
  allocationIssue: string | undefined;
  sizingAllowed: boolean;
  limitPriceValid: boolean;
  acceptedCurrentCheck: boolean;
  previewRequired: boolean;
  previewCurrentForSubmit: boolean;
  orderCheckVolumeMatches: boolean;
  orderCheckEntry: string | null;
  slOn: boolean;
  orderCheckStopLoss: string | null;
  takeProfitInputValid: boolean;
};

/**
 * Why the order cannot be sent, or undefined when it can. The branch order is observable policy: overlapping
 * failures keep their precedence. `''` is a distinct value, not "no reason": the ticket is blocked without wording
 * (a too-close stop, whose band already shows it, or a stale required risk preview).
 */
export function ticketBlockedReason(conditions: TicketBlockedReasonConditions): string | undefined {
  if (conditions.canSubmitOrder) {
    return undefined;
  }
  if (!conditions.bridgeConnected) {
    return 'Bridge not connected.';
  }
  if (!conditions.accountAvailable) {
    return 'Account snapshot unavailable.';
  }
  if (conditions.marketOpen !== true) {
    return conditions.marketOpen === false
      ? 'Market is closed for this symbol — trading resumes when the session opens.'
      : 'Market session is unavailable — waiting for the bridge heartbeat.';
  }
  if (!conditions.stagedOnChart) {
    return 'Staged order was cleared from the chart — stage it again to send.';
  }
  if (!conditions.orderVolumeValid) {
    return conditions.effectiveVolume === ''
      ? 'Volume is required.'
      : (conditions.volumeIssue ?? 'Volume must be a positive decimal.');
  }
  if (conditions.stopDistanceReason !== undefined) {
    return conditions.stopDistanceReason;
  }
  if (conditions.allocationIssue) {
    return conditions.allocationIssue;
  }
  if (!conditions.sizingAllowed) {
    return SIZING_NEEDS_STOP_MESSAGE;
  }
  if (!conditions.limitPriceValid) {
    return 'Stop limit requires limit price — enter the resting limit price on the ticket.';
  }
  if (!conditions.acceptedCurrentCheck) {
    return 'Run OrderCheck in MT5 — an accepted result for the current draft is required.';
  }
  if (conditions.previewRequired && !conditions.previewCurrentForSubmit) {
    return '';
  }
  if (!conditions.orderCheckVolumeMatches) {
    return 'Volume changed — run OrderCheck in MT5 again.';
  }
  if (!conditions.orderCheckEntry || (conditions.slOn && !conditions.orderCheckStopLoss)) {
    return 'Entry and stop loss must be valid prices.';
  }
  if (!conditions.takeProfitInputValid) {
    return 'Take profit must be a valid price or empty.';
  }
  return 'Order panel is not ready.';
}
