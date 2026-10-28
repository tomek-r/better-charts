/** Where this device remembers that the setup finished, so the guide never returns on its own. */
const SETUP_COMPLETION_KEY = 'better-charts.setup-completed';

/** Stored value of a completed setup; any other value, and missing storage, reads as not completed. */
const COMPLETED_VALUE = 'true';

/** Whether this device has already finished the setup. Unavailable storage reads as not completed. */
export function readSetupCompleted(): boolean {
  try {
    return window.localStorage.getItem(SETUP_COMPLETION_KEY) === COMPLETED_VALUE;
  } catch {
    return false;
  }
}

/** Remembers the completed setup for this device. Unavailable storage forgets it on the next launch. */
export function saveSetupCompleted(): void {
  try {
    window.localStorage.setItem(SETUP_COMPLETION_KEY, COMPLETED_VALUE);
  } catch {
    // Storage is unavailable: the next launch shows the setup screen again.
  }
}
