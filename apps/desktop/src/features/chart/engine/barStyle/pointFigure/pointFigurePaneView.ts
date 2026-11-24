import type {
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  Time,
} from 'lightweight-charts';
import { POINT_FIGURE_DEFAULT_OPTIONS, type PointFigureOptions } from './pointFigureOptions';
import type { PointFigurePoint } from './pointFigurePoint';
import { PointFigureRenderer } from './pointFigureRenderer';

/** A point with no prices at all, which a column that never closed reduces to. */
type WhitespacePoint = CustomSeriesWhitespaceData<Time>;

/** One chart's Point & figure columns as the library's custom series: its data, its options and its renderer. */
export class PointFigurePaneView implements ICustomSeriesPaneView<Time, PointFigurePoint, PointFigureOptions> {
  private readonly pointFigureRenderer = new PointFigureRenderer();

  /** The prices the price scale fits to each column: its low end, its high end, and its close as the value. */
  priceValueBuilder(point: PointFigurePoint): number[] {
    return [point.low, point.high, point.close];
  }

  /** A column whose close never arrived draws nothing, so the chart must not fit the scale to it. */
  isWhitespace(point: PointFigurePoint | WhitespacePoint): point is WhitespacePoint {
    return !('close' in point);
  }

  renderer(): PointFigureRenderer {
    return this.pointFigureRenderer;
  }

  update(data: PaneRendererCustomData<Time, PointFigurePoint>, options: PointFigureOptions): void {
    this.pointFigureRenderer.update(data, options);
  }

  defaultOptions(): PointFigureOptions {
    return { ...POINT_FIGURE_DEFAULT_OPTIONS };
  }
}
