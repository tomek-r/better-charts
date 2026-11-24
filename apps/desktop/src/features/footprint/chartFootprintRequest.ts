import type { ChartFootprintRequest } from '../../shared/bridge/types';
import type { VolumeFootprintAppearance } from '../chart/engine/barStyle/barStyleAppearance';

/** What the chart asks the host to publish its bars' footprints with, read off the footprint style's appearance. */
export function chartFootprintRequest(appearance: VolumeFootprintAppearance): ChartFootprintRequest {
  return {
    rowSize: appearance.rowSize,
    vaPercent: appearance.valueAreaPercent,
    imbalancePercent: appearance.imbalancePercent,
  };
}
