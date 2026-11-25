import { customSeriesDefaultOptions, type CustomSeriesOptions } from 'lightweight-charts';
import { candleSeriesColors, DEFAULT_CANDLE_APPEARANCE, type CandleSeriesColors } from '../../bars/candleAppearance';
import type { FootprintImbalanceHighlight, FootprintStackedImbalance, ToggledColor } from '../barStyleAppearance';
import {
  FOOTPRINT_DEFAULT_BUY_SHADES,
  FOOTPRINT_DEFAULT_DISPLAY,
  FOOTPRINT_DEFAULT_GRADIENT,
  FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT,
  FOOTPRINT_DEFAULT_POC,
  FOOTPRINT_DEFAULT_SELL_SHADES,
  FOOTPRINT_DEFAULT_SHOW_SUMMARY,
  FOOTPRINT_DEFAULT_SHOW_VALUE_AREA,
  FOOTPRINT_DEFAULT_STACKED_IMBALANCE,
  FOOTPRINT_DEFAULT_TYPE,
  FOOTPRINT_DEFAULT_VALUES,
} from './footprintDefaults';
import type { FootprintDisplay, FootprintType, FootprintValues } from './footprintModes';

/**
 * What the volume footprint series is drawn with: the library's custom series options, the candle colours
 * of the thin candle in the middle of each bar, and what its cells say and how they are shaded. The
 * imbalance marks, the value area and the colour of the row a bar traded most at are drawn from here too.
 */
export type VolumeFootprintOptions = CustomSeriesOptions &
  CandleSeriesColors & {
    /** Whether each bar's cells are graded through its own values, instead of one shade per side. */
    readonly gradient: boolean;
    readonly display: FootprintDisplay;
    readonly type: FootprintType;
    readonly values: FootprintValues;
    readonly sellShades: readonly string[];
    readonly buyShades: readonly string[];
    /** Whether each bar's cells are followed by a box holding its delta and the volume it traded. */
    readonly showSummary: boolean;
    /** Whether the value area's rows are marked on each bar. */
    readonly showValueArea: boolean;
    readonly imbalanceHighlight: FootprintImbalanceHighlight;
    readonly stackedImbalance: FootprintStackedImbalance;
    readonly poc: ToggledColor;
  };

/** The options a volume footprint series starts on: the library's defaults, painted as default candles are. */
export const VOLUME_FOOTPRINT_DEFAULT_OPTIONS: VolumeFootprintOptions = {
  ...customSeriesDefaultOptions,
  ...candleSeriesColors(DEFAULT_CANDLE_APPEARANCE),
  gradient: FOOTPRINT_DEFAULT_GRADIENT,
  display: FOOTPRINT_DEFAULT_DISPLAY,
  type: FOOTPRINT_DEFAULT_TYPE,
  values: FOOTPRINT_DEFAULT_VALUES,
  sellShades: FOOTPRINT_DEFAULT_SELL_SHADES,
  buyShades: FOOTPRINT_DEFAULT_BUY_SHADES,
  showSummary: FOOTPRINT_DEFAULT_SHOW_SUMMARY,
  showValueArea: FOOTPRINT_DEFAULT_SHOW_VALUE_AREA,
  imbalanceHighlight: FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT,
  stackedImbalance: FOOTPRINT_DEFAULT_STACKED_IMBALANCE,
  poc: FOOTPRINT_DEFAULT_POC,
};
