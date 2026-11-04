import type {
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  Time,
} from 'lightweight-charts';
import { HIGH_LOW_DEFAULT_OPTIONS, type HighLowOptions } from './highLowOptions';
import type { HighLowPoint } from './highLowPoint';
import { HighLowRenderer } from './highLowRenderer';

/** One chart's high-low bars as the library's custom series: its data, its options and its renderer. */
export class HighLowPaneView implements ICustomSeriesPaneView<Time, HighLowPoint, HighLowOptions> {
  private readonly highLowRenderer = new HighLowRenderer();

  /** The prices the price scale fits to each bar: its range, and its high as the bar's current value. */
  priceValueBuilder(point: HighLowPoint): number[] {
    return [point.low, point.high, point.high];
  }

  /** A bar whose range never arrived draws nothing, so the chart must not fit the scale to it. */
  isWhitespace(point: HighLowPoint | CustomSeriesWhitespaceData<Time>): point is CustomSeriesWhitespaceData<Time> {
    return !('high' in point);
  }

  renderer(): HighLowRenderer {
    return this.highLowRenderer;
  }

  update(data: PaneRendererCustomData<Time, HighLowPoint>, options: HighLowOptions): void {
    this.highLowRenderer.update(data, options);
  }

  defaultOptions(): HighLowOptions {
    return { ...HIGH_LOW_DEFAULT_OPTIONS };
  }
}
