import type { BarFootprint } from '../chart/engine/barStyle/volumeFootprint/footprintData';
import type { FootprintValues } from '../chart/engine/barStyle/volumeFootprint/footprintModes';
import type { FootprintNotices } from '../chart/engine/legend/footprintNotice';

/**
 * What the legend has to say about the footprints the chart draws: the newest bar the host stopped reading
 * inside, and whether any of them counts trades instead of lots. A bar drawing its own trade counts writes
 * numbers that are no volume at all, so nothing is said about the ticks behind them.
 */
export function footprintNoticesOf(
  footprints: readonly BarFootprint[],
  incompleteBeforeMs: number | null,
  values: FootprintValues,
): FootprintNotices {
  return {
    incompleteBeforeMs,
    tickVolume: values !== 'tradeCount' && footprints.some((footprint) => footprint.volume === 'ticks'),
  };
}
