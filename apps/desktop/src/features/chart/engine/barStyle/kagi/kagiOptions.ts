import { customSeriesDefaultOptions, type CustomSeriesOptions } from 'lightweight-charts';
import { palette } from '../../../../../shared/theme/palette';
import type { BarStyleLineWidth } from '../barStyleAppearance';
import type { KagiStrokeStyle } from './kagiStrokes';

/**
 * TradingView's own Yin red, which its Kagi line defaults to: no palette token holds it, and the chart's down
 * colour is the app's own sell red.
 */
const YIN_COLOR = '#ef5350';

/** What a Kagi series is drawn with: the colour and the thickness of each of the line's two styles. */
export interface KagiOptions extends CustomSeriesOptions {
  readonly yangColor: string;
  readonly yinColor: string;
  readonly yangLineWidth: BarStyleLineWidth;
  readonly yinLineWidth: BarStyleLineWidth;
}

/** The line as a Kagi chart starts on, which is TradingView's thick yang over thin yin. */
export const KAGI_DEFAULT_OPTIONS: KagiOptions = {
  ...customSeriesDefaultOptions,
  yangColor: palette.up,
  yinColor: YIN_COLOR,
  yangLineWidth: 3,
  yinLineWidth: 1,
};

/** The colour one of the line's two styles is drawn in, and how thick it is in media pixels. */
export interface KagiStylePaint {
  readonly color: string;
  readonly width: number;
}

/** How one of the line's two styles is painted: the yang pair for a thick stroke, the yin pair for a thin one. */
export function kagiStylePaint(options: KagiOptions, style: KagiStrokeStyle): KagiStylePaint {
  if (style === 'yang') {
    return { color: options.yangColor, width: options.yangLineWidth };
  }
  return { color: options.yinColor, width: options.yinLineWidth };
}
