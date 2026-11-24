import { customSeriesDefaultOptions, type CustomSeriesOptions } from 'lightweight-charts';
import { palette } from '../../../../../shared/theme/palette';

/**
 * TradingView's own down red, which its Point & figure O marks are drawn in: no palette token holds it, and the
 * chart's down colour is the app's own sell red.
 */
const MARK_DOWN_COLOR = '#ef5350';

/** What a Point & figure series is drawn with: the colour of its rising X marks and of its falling O marks. */
export interface PointFigureOptions extends CustomSeriesOptions {
  readonly upColor: string;
  readonly downColor: string;
}

/** The columns as a Point & figure chart starts on, which is TradingView's up teal over down red. */
export const POINT_FIGURE_DEFAULT_OPTIONS: PointFigureOptions = {
  ...customSeriesDefaultOptions,
  upColor: palette.up,
  downColor: MARK_DOWN_COLOR,
};
