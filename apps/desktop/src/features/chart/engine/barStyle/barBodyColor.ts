import type { RenderBar } from '../bars/renderBar';
import type { BarStyleAppearance } from './barStyleAppearance';
import { barColor, directionColor, roseAgainstPreviousClose, roseTo } from './barStylePoints';

/**
 * The colour the body of `bar` is drawn in, or null for a style that draws no body. A body that is
 * hidden still reads its colour, so a legend value never turns invisible.
 */
export function barBodyColor(
  appearance: BarStyleAppearance,
  bar: RenderBar,
  previous: RenderBar | undefined,
): string | null {
  switch (appearance.style) {
    case 'candles':
    case 'heikinAshi':
    case 'volumeCandles': {
      const { body, colorByPreviousClose } = appearance.candles;
      const rising = colorByPreviousClose ? roseAgainstPreviousClose(bar, previous) : roseTo(bar, bar.open);
      return directionColor(body, rising);
    }
    case 'hollowCandles':
      return directionColor(appearance.candles.body, roseAgainstPreviousClose(bar, previous));
    case 'bars':
    case 'columns':
      return barColor(bar, previous, appearance);
    case 'line':
    case 'lineWithMarkers':
    case 'stepLine':
    case 'area':
    case 'baseline':
    case 'highLow':
      // These styles have no up and down colours, so the legend keeps its label colour.
      return null;
  }
}
