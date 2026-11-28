import { TICK_INTERVALS } from '../../../shared/bridge/chartIntervals';
import { isDrawableInterval } from '../../../shared/bridge/chartIntervalModel';
import { timeframeOptions } from '../../../shared/bridge/timeframes';

export const customIntervalsKey = 'better-charts.custom-intervals.v1';

/** The codes the menu lists for everyone, which the user does not have to type to see. */
const LISTED_CODES: readonly string[] = [
  ...TICK_INTERVALS.map((interval) => interval.code),
  ...timeframeOptions.map((option) => option.wire),
];

/** Whether `code` is one only the user's own input brings to the menu: drawable and not listed already. */
function isCustomCode(code: string): boolean {
  return isDrawableInterval(code) && !LISTED_CODES.includes(code);
}

/** Wire codes the user typed: a drawable interval the menu does not list, de-duplicated and in stored
 * order. Missing or malformed storage yields none. `storage` is injectable for tests. */
export function loadCustomIntervals(storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = (storage ?? localStorage).getItem(customIntervalsKey);
    if (raw === null) {
      return [];
    }
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }
    const known = value.filter((code): code is string => typeof code === 'string' && isCustomCode(code));
    return [...new Set(known)];
  } catch {
    return [];
  }
}

export function saveCustomIntervals(codes: readonly string[], storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? localStorage).setItem(customIntervalsKey, JSON.stringify(codes));
  } catch {
    /* storage is optional */
  }
}

/** `codes` with `code` appended, unless it is already listed or is no interval of the user's own. */
export function withCustomInterval(codes: readonly string[], code: string): readonly string[] {
  if (codes.includes(code) || !isCustomCode(code)) {
    return codes;
  }
  return [...codes, code];
}

/** `codes` without `code`; a code that was not there leaves the list as it was. */
export function withoutCustomInterval(codes: readonly string[], code: string): readonly string[] {
  return codes.filter((listed) => listed !== code);
}
