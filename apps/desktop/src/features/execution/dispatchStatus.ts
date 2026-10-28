export type DispatchStatus = { kind: 'locked' | 'error'; text: string };

const DISPATCH_DISABLED_ERROR = /dispatch is disabled/i;
const DISPATCH_LOCKED_TEXT = 'Dispatch locked — nothing was sent to MT5. Owner approval required.';

/** A disabled-dispatch rejection is a calm "locked" line; any other failure keeps its own text. */
export function dispatchStatusFromError(text: string): DispatchStatus {
  return DISPATCH_DISABLED_ERROR.test(text) ? { kind: 'locked', text: DISPATCH_LOCKED_TEXT } : { kind: 'error', text };
}
