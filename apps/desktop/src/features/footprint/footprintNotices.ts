import type { FootprintNotices } from '../chart/engine/legend/footprintNotice';

/**
 * What the legend has to say about the footprints the chart draws: the newest bar the host stopped reading
 * inside, whose footprint covers only the ticks it read before it stopped.
 */
export function footprintNoticesOf(incompleteBeforeMs: number | null): FootprintNotices {
  return { incompleteBeforeMs };
}
