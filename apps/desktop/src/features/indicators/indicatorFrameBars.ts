import type { RenderBar } from '../chart/engine/bars/renderBar';
import type { IndicatorBar, IndicatorFrame } from '../chart/engine/indicators/indicatorFrame';

const MILLISECONDS_PER_SECOND = 1000;

/** The index a chart bar carries while the frame holds no bar for it. */
export const NO_FRAME_BAR = -1;

/** One bar of a frame: the bar's time in milliseconds and one value per plot, coloured when told. */
export function indicatorFrameBar(
  bar: RenderBar,
  values: readonly (number | null)[],
  confirmed: boolean,
  colors?: readonly (string | null)[],
): IndicatorBar {
  const frameBar = { timeMs: bar.time * MILLISECONDS_PER_SECOND, confirmed, values };
  return colors === undefined ? frameBar : { ...frameBar, colors: [...colors] };
}

/**
 * One bar per chart bar, carrying the values and colours of the frame bar `sourceIndexOf` names for it, and no
 * value where it names none.
 */
export function projectFrameBars(
  frame: IndicatorFrame,
  chartBars: readonly RenderBar[],
  sourceIndexOf: (index: number) => number,
): readonly IndicatorBar[] {
  const missingValues: readonly null[] = frame.plots.map(() => null);
  const formingIndex = chartBars.length - 1;
  return chartBars.map((chartBar, index) => {
    const sourceBar = frame.bars[sourceIndexOf(index)];
    return indicatorFrameBar(chartBar, sourceBar?.values ?? missingValues, index !== formingIndex, sourceBar?.colors);
  });
}
