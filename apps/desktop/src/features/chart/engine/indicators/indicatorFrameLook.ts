import type { ChartIndicatorPane } from './indicatorContract';
import type { IndicatorFrame } from './indicatorFrame';

/**
 * Everything a frame draws beyond its bars: the plots, the levels, the fills, the decimals its values are
 * written with, the pane it draws in and whether its plots label the price scale. Two frames with the same
 * look are drawn the same way, so the display layer only has to write their bars.
 */
export function frameLookKey(frame: IndicatorFrame, paneKind: ChartIndicatorPane, priceLabelsVisible: boolean): string {
  return JSON.stringify({
    plots: frame.plots,
    levels: frame.levels ?? [],
    fills: frame.fills ?? [],
    precision: frame.precision ?? null,
    paneKind,
    priceLabelsVisible,
  });
}
