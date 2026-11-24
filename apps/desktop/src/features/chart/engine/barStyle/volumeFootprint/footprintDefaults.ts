import type { FootprintImbalanceHighlight, FootprintStackedImbalance, ToggledColor } from '../barStyleAppearance';
import { FOOTPRINT_POC_COLOR } from './footprintShades';
import type { FootprintDisplay, FootprintRowSizeMode, FootprintType, FootprintValues } from './footprintModes';

/** Whether a footprint bar writes its delta box until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_SHOW_SUMMARY = true;
/** The colours an imbalanced cell is marked in until the settings say otherwise: the buy side green, the sell side red. */
export const FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT: FootprintImbalanceHighlight = {
  visible: true,
  buyColor: '#089981',
  sellColor: '#F23645',
};
/** The colour the row a bar traded most at is drawn in until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_POC: ToggledColor = { visible: true, color: FOOTPRINT_POC_COLOR };

/**
 * The four shades each side's cells are graded through until the settings say otherwise, lightest first: the sell
 * side red, the buy side green.
 */
export const FOOTPRINT_DEFAULT_SELL_SHADES: readonly string[] = ['#ff99a0', '#f7525f', '#cc2f3c', '#801922'];
export const FOOTPRINT_DEFAULT_BUY_SHADES: readonly string[] = ['#5cc4b4', '#089981', '#056656', '#004d40'];

/** Whether each cell is graded through the shades until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_GRADIENT = true;
/** How a footprint row's width is chosen until the settings say otherwise: the host's automatic ATR rows. */
export const FOOTPRINT_DEFAULT_ROW_SIZE_MODE: FootprintRowSizeMode = 'auto';
/** How many bars the host's automatic row size averages over until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_ATR_LENGTH = 14;
/** How many of the symbol's ticks one row spans until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_TICKS_PER_ROW = 10;
/** The share of a bar's volume its value area covers until the settings say otherwise, in percent. */
export const FOOTPRINT_DEFAULT_VALUE_AREA_PERCENT = 70;
/** Whether a bar's value area is marked until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_SHOW_VALUE_AREA = true;
/** The share of opposite volume a row needs to count as an imbalance until the settings say otherwise, in percent. */
export const FOOTPRINT_DEFAULT_IMBALANCE_PERCENT = 300;
/** How a footprint bar places its cells until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_DISPLAY: FootprintDisplay = 'cluster';
/** What a footprint bar's cells write until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_TYPE: FootprintType = 'buySell';
/** The unit a footprint number is counted in until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_VALUES: FootprintValues = 'volume';

/** How many levels a stacked zone collects, and whether such zones are drawn, until the settings say otherwise. */
export const FOOTPRINT_DEFAULT_STACKED_IMBALANCE: FootprintStackedImbalance = { visible: false, count: 3 };
