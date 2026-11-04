import { customSeriesDefaultOptions, type CustomSeriesOptions } from 'lightweight-charts';
import { candleSeriesColors, DEFAULT_CANDLE_APPEARANCE } from '../../bars/candleAppearance';

/** The candle colours the chart's candle settings put on the series as a whole, as the built-in candles take them. */
type CandleSeriesColors = ReturnType<typeof candleSeriesColors>;

/**
 * What the volume candle series is drawn with: the library's custom series options, its candle colours and how
 * far the quietest visible bar's body narrows against the busiest bar of the visible window.
 */
export type VolumeCandlesOptions = CustomSeriesOptions &
  CandleSeriesColors & {
    /** From 0, every body at the full width, to 1, the quietest visible bar at the narrowest body. */
    readonly widthSensitivity: number;
  };

/** The width sensitivity a series starts on: 100 %, the full sensitivity the chart's settings offer by default. */
const DEFAULT_WIDTH_SENSITIVITY = 1;

/** The options a volume candle series starts on: the library's defaults, painted as default candles are. */
export const VOLUME_CANDLES_DEFAULT_OPTIONS: VolumeCandlesOptions = {
  ...customSeriesDefaultOptions,
  ...candleSeriesColors(DEFAULT_CANDLE_APPEARANCE),
  widthSensitivity: DEFAULT_WIDTH_SENSITIVITY,
};
