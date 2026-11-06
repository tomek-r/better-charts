import type { RenderBar } from '../bars/renderBar';
import type { BarDirectionColors, BarStyleAppearance } from './barStyleAppearance';
import { directionColor, roseAgainstPreviousClose, roseTo } from './barStylePoints';

/** The up and down colours a style's bodies take, or null for a style that has no such pair. */
export function barDirectionColors(appearance: BarStyleAppearance): BarDirectionColors | null {
  switch (appearance.style) {
    case 'candles':
    case 'heikinAshi':
    case 'volumeCandles':
    case 'hollowCandles':
      return appearance.candles.body;
    case 'bars':
    case 'columns':
      return appearance.colors;
    case 'line':
    case 'lineWithMarkers':
    case 'stepLine':
    case 'area':
    case 'baseline':
    case 'highLow':
      return null;
  }
}

/**
 * Whether the body of `bar` is read as rising: the previous close decides for hollow candles and for the
 * styles set to colour by it, and the bar's own open decides otherwise.
 */
function bodyRose(appearance: BarStyleAppearance, bar: RenderBar, previous: RenderBar | undefined): boolean {
  switch (appearance.style) {
    case 'hollowCandles':
      return roseAgainstPreviousClose(bar, previous);
    case 'candles':
    case 'heikinAshi':
    case 'volumeCandles':
      return appearance.candles.colorByPreviousClose ? roseAgainstPreviousClose(bar, previous) : roseTo(bar, bar.open);
    case 'bars':
    case 'columns':
      return appearance.colorByPreviousClose ? roseAgainstPreviousClose(bar, previous) : roseTo(bar, bar.open);
    case 'line':
    case 'lineWithMarkers':
    case 'stepLine':
    case 'area':
    case 'baseline':
    case 'highLow':
      // These styles draw no body colour, so the direction read for them is never written anywhere.
      return roseTo(bar, bar.open);
  }
}

/**
 * The colour the body of `bar` is drawn in, or null for a style that draws no body. A body that is
 * hidden still reads its colour, so a legend value never turns invisible.
 */
export function barBodyColor(
  appearance: BarStyleAppearance,
  bar: RenderBar,
  previous: RenderBar | undefined,
): string | null {
  const colors = barDirectionColors(appearance);
  if (colors === null) {
    return null;
  }
  return directionColor(colors, bodyRose(appearance, bar, previous));
}
