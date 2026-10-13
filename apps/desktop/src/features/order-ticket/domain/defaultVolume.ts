import type { BrokerSymbol } from '../../../shared/bridge/types';
import { formatVolume } from '../../../shared/format';

/** Until symbol metadata arrives the ticket starts at one unit. */
export const FALLBACK_ORDER_VOLUME = '1';

/**
 * Native number-input stepping for the Units field: one minimum volume per arrow press, from the minimum up to the
 * maximum. The browser steps in decimal (not binary float), so 0.1 -> 0.2 -> 0.3 stays exact and lands on the lot step.
 * Without usable symbol metadata the field keeps its plain behaviour.
 */
export function unitsStepAttributes(instrument: Pick<BrokerSymbol, 'volumeMin' | 'volumeMax'> | undefined): {
  min?: string;
  max?: string;
  step: string;
} {
  const min = instrument ? formatVolume(instrument.volumeMin) : '';
  if (!instrument || !(Number(min) > 0)) {
    return { step: 'any' };
  }
  const max = formatVolume(instrument.volumeMax);
  return Number(max) >= Number(min) ? { min, max, step: min } : { min, step: min };
}

/** Default Units-mode volume: the symbol's minimum volume as a decimal string, else the fallback. */
export function defaultOrderVolume(instrument: Pick<BrokerSymbol, 'volumeMin'> | undefined): string {
  const minimum = instrument ? formatVolume(instrument.volumeMin) : '';
  const value = Number(minimum);
  return minimum !== '' && Number.isFinite(value) && value > 0 ? minimum : FALLBACK_ORDER_VOLUME;
}
