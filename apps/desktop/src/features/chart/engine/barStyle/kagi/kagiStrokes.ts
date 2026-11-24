/** The two styles a Kagi line is drawn in: thick yang once it breaks a shoulder, thin yin below a waist. */
export type KagiStrokeStyle = 'yang' | 'yin';

/** One bar of the line, as the segmentation reads it: the price it starts at and the price it ends at. */
export interface KagiBar {
  readonly open: number;
  readonly close: number;
}

/** One Kagi stroke, which the line draws from `open` to `close` at the bar's own slot. */
export interface KagiStroke {
  readonly open: number;
  readonly close: number;
  /** The style the stroke ends in, which the whole stroke takes while `brokenLevel` is null. */
  readonly style: KagiStrokeStyle;
  /** The price the line changed style at inside the stroke, or null when it kept the style it opened in. */
  readonly brokenLevel: number | null;
}

/** The style the line opens in: no stroke before the first has a shoulder for it to rise above. */
const OPENING_STYLE: KagiStrokeStyle = 'yin';

const OTHER_STYLE: Readonly<Record<KagiStrokeStyle, KagiStrokeStyle>> = { yang: 'yin', yin: 'yang' };

/** The style a stroke opens in: its own, unless it changed style on the way and so opened in the other one. */
export function openingStyleOf(stroke: KagiStroke): KagiStrokeStyle {
  return stroke.brokenLevel === null ? stroke.style : OTHER_STYLE[stroke.style];
}

/** Which way a stroke runs; a flat stroke counts as running up, so its price becomes a shoulder. */
function runsUp(bar: KagiBar): boolean {
  return bar.close >= bar.open;
}

/**
 * The line's strokes, one per bar, each with the style it is drawn in.
 *
 * A stroke keeps the style the line is in. An up stroke that rises above the last up stroke's high — the
 * previous shoulder — turns the line thick yang from that price on, and a down stroke that falls below the
 * last down stroke's low — the previous waist — turns it thin yin. The first stroke has neither, so the line
 * opens yin. Each stroke ends at its own extreme, so an up stroke's close is the shoulder and a down stroke's
 * close the waist for the stroke that turns on it.
 */
export function kagiStrokes(bars: readonly KagiBar[]): KagiStroke[] {
  const strokes: KagiStroke[] = [];
  let style = OPENING_STYLE;
  let shoulder: number | null = null;
  let waist: number | null = null;
  for (const bar of bars) {
    let brokenLevel: number | null = null;
    if (runsUp(bar)) {
      if (style === 'yin' && shoulder !== null && bar.close > shoulder) {
        style = 'yang';
        brokenLevel = shoulder;
      }
      shoulder = bar.close;
    } else {
      if (style === 'yang' && waist !== null && bar.close < waist) {
        style = 'yin';
        brokenLevel = waist;
      }
      waist = bar.close;
    }
    strokes.push({ open: bar.open, close: bar.close, style, brokenLevel });
  }
  return strokes;
}
