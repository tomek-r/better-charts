import type {
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  Time,
} from 'lightweight-charts';
import type { VolumeCandlePoint } from './volumeCandlePoint';
import { VOLUME_CANDLES_DEFAULT_OPTIONS, type VolumeCandlesOptions } from './volumeCandlesOptions';
import { VolumeCandlesRenderer } from './volumeCandlesRenderer';

/** One chart's volume candles as the library's custom series: its data, its options and its renderer. */
export class VolumeCandlesPaneView implements ICustomSeriesPaneView<Time, VolumeCandlePoint, VolumeCandlesOptions> {
  private readonly volumeCandlesRenderer = new VolumeCandlesRenderer();

  /** The prices the price scale fits to each bar: its range, and its close as the bar's current value. */
  priceValueBuilder(point: VolumeCandlePoint): number[] {
    return [point.low, point.high, point.close];
  }

  /** A bar whose close never arrived draws nothing, so the chart must not fit the scale to it. */
  isWhitespace(point: VolumeCandlePoint | CustomSeriesWhitespaceData<Time>): point is CustomSeriesWhitespaceData<Time> {
    return !('close' in point);
  }

  renderer(): VolumeCandlesRenderer {
    return this.volumeCandlesRenderer;
  }

  update(data: PaneRendererCustomData<Time, VolumeCandlePoint>, options: VolumeCandlesOptions): void {
    this.volumeCandlesRenderer.update(data, options);
  }

  defaultOptions(): VolumeCandlesOptions {
    return { ...VOLUME_CANDLES_DEFAULT_OPTIONS };
  }
}
