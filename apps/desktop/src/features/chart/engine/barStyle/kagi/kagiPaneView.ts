import type {
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  Time,
} from 'lightweight-charts';
import { KAGI_DEFAULT_OPTIONS, type KagiOptions } from './kagiOptions';
import type { KagiPoint } from './kagiPoint';
import { KagiRenderer } from './kagiRenderer';

/** One chart's Kagi line as the library's custom series: its data, its options and its renderer. */
export class KagiPaneView implements ICustomSeriesPaneView<Time, KagiPoint, KagiOptions> {
  private readonly kagiRenderer = new KagiRenderer();

  /** The prices the price scale fits to each stroke: its low, its high, and its close as the line's value. */
  priceValueBuilder(point: KagiPoint): number[] {
    return [point.low, point.high, point.close];
  }

  /** A bar whose close never arrived draws nothing, so the chart must not fit the scale to it. */
  isWhitespace(point: KagiPoint | CustomSeriesWhitespaceData<Time>): point is CustomSeriesWhitespaceData<Time> {
    return !('close' in point);
  }

  renderer(): KagiRenderer {
    return this.kagiRenderer;
  }

  update(data: PaneRendererCustomData<Time, KagiPoint>, options: KagiOptions): void {
    this.kagiRenderer.update(data, options);
  }

  defaultOptions(): KagiOptions {
    return { ...KAGI_DEFAULT_OPTIONS };
  }
}
