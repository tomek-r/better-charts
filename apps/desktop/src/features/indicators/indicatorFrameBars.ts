import type { RenderBar } from '../chart/engine/bars/renderBar';
import type { IndicatorBar } from '../chart/engine/indicators/indicatorFrame';

const MILLISECONDS_PER_SECOND = 1000;

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
