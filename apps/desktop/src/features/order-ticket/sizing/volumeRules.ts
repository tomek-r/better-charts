import type { BrokerSymbol } from '../../../shared/bridge/types';
import { formatVolume } from '../../../shared/format';

/** Absorbs binary-float noise when testing whether a volume is a whole multiple of the step (e.g. 0.3/0.1). */
const VOLUME_STEP_TOLERANCE = 1e-8;

/**
 * Editable volume: positive decimal and, when instrument metadata is known, inside [volumeMin, volumeMax] and a
 * whole multiple of volumeStep. Unknown instrument: plain positive decimal only; the backend/EA re-validates
 * volume on the wire.
 */
export function orderVolumeIssue(value: string, instrument?: BrokerSymbol): string | undefined {
  const trimmed = value.trim();
  const volume = Number(trimmed);
  if (!trimmed || !Number.isFinite(volume) || volume <= 0) {
    return 'Volume must be a positive decimal.';
  }
  if (!instrument) {
    return undefined;
  }
  const min = Number(instrument.volumeMin);
  const max = Number(instrument.volumeMax);
  const step = Number(instrument.volumeStep);
  // Broker decimals carry padding ("0.10000000"); show them as a person would write them.
  const shownMin = formatVolume(instrument.volumeMin);
  const shownMax = formatVolume(instrument.volumeMax);
  const range = `Volume must be between ${shownMin} and ${shownMax}.`;
  if (Number.isFinite(min) && volume < min) {
    return range;
  }
  if (Number.isFinite(max) && volume > max) {
    return range;
  }
  if (
    Number.isFinite(step) &&
    step > 0 &&
    Math.abs(volume / step - Math.round(volume / step)) > VOLUME_STEP_TOLERANCE
  ) {
    return `Volume must respect ${formatVolume(instrument.volumeStep)} step (min ${shownMin}, max ${shownMax})`;
  }
  return undefined;
}
