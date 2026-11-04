import { customSeriesDefaultOptions, type CustomSeriesOptions } from 'lightweight-charts';
import { palette } from '../../../../../shared/theme/palette';
import type { ToggledColor } from '../barStyleAppearance';

/** How many decimals the price labels are written with before the anchor series' precision arrives. */
const DEFAULT_LABEL_PRECISION = 2;

/** What a high-low series is drawn with: the three parts of a bar and the precision its labels use. */
export interface HighLowOptions extends CustomSeriesOptions {
  readonly body: ToggledColor;
  readonly borders: ToggledColor;
  readonly labels: ToggledColor;
  /** The decimals the high and low labels are written with, which the anchor series' precision sets. */
  readonly labelPrecision: number;
}

/** The options a high-low series starts on: the library's defaults, with all three parts drawn in the info colour. */
export const HIGH_LOW_DEFAULT_OPTIONS: HighLowOptions = {
  ...customSeriesDefaultOptions,
  body: { visible: true, color: palette.info },
  borders: { visible: true, color: palette.info },
  labels: { visible: true, color: palette.info },
  labelPrecision: DEFAULT_LABEL_PRECISION,
};
