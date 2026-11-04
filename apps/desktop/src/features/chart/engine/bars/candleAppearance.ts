import { palette } from '../../../../shared/theme/palette';
import type { RenderBar } from './renderBar';

/** One drawn part of a candle — body, borders or wick — with the colour it takes in each direction. */
export interface CandlePartAppearance {
  readonly visible: boolean;
  readonly up: string;
  readonly down: string;
}

/** How the candles are drawn: what each part looks like, and whether a bar follows the previous close. */
export interface CandleAppearance {
  readonly colorByPreviousClose: boolean;
  readonly body: CandlePartAppearance;
  readonly borders: CandlePartAppearance;
  readonly wick: CandlePartAppearance;
}

/** The colours one bar overrides the series with; empty while bars keep the series colours. */
export interface CandlePointColors {
  readonly color?: string;
  readonly borderColor?: string;
  readonly wickColor?: string;
}

/** A part that is off has no colour to paint, and the library has no per-part switch to hide it. */
const HIDDEN_PART_COLOR = 'transparent';

const PART_COLOR_UP = palette.up;
const PART_COLOR_DOWN = palette.sell;

/**
 * Today's candles: a solid body, no borders and a wick, so the chart looks the same
 * before and after the first setting lands.
 */
export const DEFAULT_CANDLE_APPEARANCE: CandleAppearance = {
  colorByPreviousClose: false,
  body: { visible: true, up: PART_COLOR_UP, down: PART_COLOR_DOWN },
  borders: { visible: false, up: PART_COLOR_UP, down: PART_COLOR_DOWN },
  wick: { visible: true, up: PART_COLOR_UP, down: PART_COLOR_DOWN },
};

/** Every part of the anchor's candles switched off; the colours stay behind the flag. */
const HIDDEN_CANDLE_PART: CandlePartAppearance = {
  visible: false,
  up: PART_COLOR_UP,
  down: PART_COLOR_DOWN,
};

/**
 * The candles the anchor series draws while another series paints the bars: every part hidden, so the
 * anchor keeps the price format, the price fit and every primitive attached to it without painting.
 */
export const HIDDEN_CANDLE_APPEARANCE: CandleAppearance = {
  colorByPreviousClose: false,
  body: HIDDEN_CANDLE_PART,
  borders: HIDDEN_CANDLE_PART,
  wick: HIDDEN_CANDLE_PART,
};

/** The colour a part is drawn in: the up one for a bar that rose, the down one for a bar that fell. */
function partColor(part: CandlePartAppearance, rising: boolean): string {
  return rising ? part.up : part.down;
}

/** A hidden part paints nothing, so it takes the transparent colour instead of its own. */
export function paintedColor(part: CandlePartAppearance, rising: boolean): string {
  return part.visible ? partColor(part, rising) : HIDDEN_PART_COLOR;
}

/**
 * The series-wide colours. The parts keep their own visibility flags, so a hidden
 * border is not drawn at all rather than drawn in a transparent colour.
 */
export function candleSeriesColors(appearance: CandleAppearance) {
  return {
    upColor: paintedColor(appearance.body, true),
    downColor: paintedColor(appearance.body, false),
    borderVisible: appearance.borders.visible,
    borderUpColor: appearance.borders.up,
    borderDownColor: appearance.borders.down,
    wickVisible: appearance.wick.visible,
    wickUpColor: appearance.wick.up,
    wickDownColor: appearance.wick.down,
  };
}

/**
 * The colours one bar overrides the series with. Its direction is read against the previous close,
 * and against its own open for the first bar, which has none.
 */
export function candlePointColors(
  appearance: CandleAppearance,
  bar: RenderBar,
  previous: RenderBar | undefined,
): CandlePointColors {
  if (!appearance.colorByPreviousClose) {
    return {};
  }
  const rising = bar.close >= (previous?.close ?? bar.open);
  return {
    color: paintedColor(appearance.body, rising),
    borderColor: partColor(appearance.borders, rising),
    wickColor: partColor(appearance.wick, rising),
  };
}

function sameCandlePart(first: CandlePartAppearance, second: CandlePartAppearance): boolean {
  return first.visible === second.visible && first.up === second.up && first.down === second.down;
}

/** Whether two appearances draw the same candles, so a setting that did not change costs no repaint. */
export function sameCandleAppearance(first: CandleAppearance, second: CandleAppearance): boolean {
  return (
    first.colorByPreviousClose === second.colorByPreviousClose &&
    sameCandlePart(first.body, second.body) &&
    sameCandlePart(first.borders, second.borders) &&
    sameCandlePart(first.wick, second.wick)
  );
}
