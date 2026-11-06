/** An EMA as Pine's `ta.ema` builds it: the sum of the values seen while seeding, then the average. */
export interface EmaState {
  seedSum: number;
  seedCount: number;
  average: number | null;
}

/** The state before any value is in: nothing seen yet and no average to lean on. */
export const INITIAL_EMA_STATE: EmaState = { seedSum: 0, seedCount: 0, average: null };

/** Pine's `ta.ema` weight of the newest value. */
function smoothingWeight(length: number): number {
  return 2 / (length + 1);
}

/** The state once `value` is in: the seed sum fills up, then the average leans on the newest value. */
export function emaAfter(state: EmaState, value: number, length: number): EmaState {
  if (state.average !== null) {
    const weight = smoothingWeight(length);
    return { ...state, average: weight * value + (1 - weight) * state.average };
  }
  const seedCount = state.seedCount + 1;
  const seedSum = state.seedSum + value;
  if (seedCount < length) {
    return { seedSum, seedCount, average: null };
  }
  return { seedSum, seedCount, average: seedSum / length };
}

/** The average the state holds, or nothing while the first `length` values are still being collected. */
export function emaValue(state: EmaState): number | null {
  return state.average;
}
