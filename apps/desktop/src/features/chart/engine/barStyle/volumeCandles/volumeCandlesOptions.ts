import { customSeriesDefaultOptions, type CustomSeriesOptions } from 'lightweight-charts';
import { candleSeriesColors, DEFAULT_CANDLE_APPEARANCE } from '../../bars/candleAppearance';

/** The candle colours the chart's candle settings put on the series as a whole, as the built-in candles take them. */
type CandleSeriesColors = ReturnType<typeof candleSeriesColors>;

/** What the volume candle series is drawn with: the library's custom series options and its candle colours. */
export type VolumeCandlesOptions = CustomSeriesOptions & CandleSeriesColors;

/** The options a volume candle series starts on: the library's defaults, painted as default candles are. */
export const VOLUME_CANDLES_DEFAULT_OPTIONS: VolumeCandlesOptions = {
  ...customSeriesDefaultOptions,
  ...candleSeriesColors(DEFAULT_CANDLE_APPEARANCE),
};
