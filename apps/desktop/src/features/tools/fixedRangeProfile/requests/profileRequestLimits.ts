/** Rows of a profile whose owner sets none. */
export const DEFAULT_ROW_COUNT = 128;

/** Share of the volume the value area covers, in percent, for a profile whose owner sets none. */
export const DEFAULT_VALUE_AREA_PERCENT = 70;

/**
 * Safety net only. Every awaited request ends with a result, a correlated error (EA page read timeout 120 s), a
 * cancellation or a rejected invoke, and a session change or disconnect resets the tool, so a request still in
 * flight must never be replaced: the backend would drop the load and restart one that already takes 30-90 s on a
 * busy feed. The cutoff only recovers from a lost terminal event, so it is well beyond a legitimate load.
 */
export const IN_FLIGHT_SAFETY_MS = 300_000;
