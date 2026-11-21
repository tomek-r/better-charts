import {
  type Background,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type Logical,
  type LogicalRange,
  type PrimitivePaneViewZOrder,
  type Time,
} from 'lightweight-charts';
import { ChartSeriesPrimitive } from '../surface/chartSeriesPrimitive';
import type { RenderTarget } from '../surface/drawTarget';
import { handleBarIndices } from './indicatorHandleIndices';
import { handleRadius, handleRingWidth } from './indicatorHandles';
import { numericPointAt } from './indicatorSeriesValue';

/** Handles paint over the line they mark, so a dot stays readable where the line crosses it. */
const HANDLE_VIEW_Z_ORDER: PrimitivePaneViewZOrder = 'top';

/** The arc that traces a circle once round. */
const FULL_CIRCLE_RADIANS = Math.PI * 2;

/** A position on the target: media (CSS) pixels until `bitmapPointOf` scales it. */
interface HandlePosition {
  readonly x: number;
  readonly y: number;
}

/** What every dot of one draw pass shares: the two colours and the ratios its positions scale by. */
interface HandlePaint {
  readonly color: string;
  readonly ringColor: string;
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

/** The colour behind the pane: a gradient's top colour, or the solid one. */
function paneBackgroundColor(background: Background): string {
  return 'topColor' in background ? background.topColor : background.color;
}

/**
 * Paints the handles of one selected plot: a filled dot in the plot's colour, ringed with the pane's
 * background, on every 10th visible bar and on the bar the plot's line ends on.
 *
 * Attached to the plot's own line series, so the dots share its scale and pane. It reads the series'
 * data on every draw, like the marker primitive, because the layer updates one series at a time and
 * the chart repaints after each.
 */
export class IndicatorPlotHandles extends ChartSeriesPrimitive {
  private readonly views: readonly IPrimitivePaneView[];
  private selected = false;

  constructor(private readonly color: string) {
    super();
    // The view list is stable: the library caches views by array identity. An unselected plot hands
    // back no renderer, so its handles cost nothing until the indicator is selected.
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => HANDLE_VIEW_Z_ORDER, renderer: () => (this.selected ? renderer : null) }];
  }

  /** Shows or hides the handles; the layer follows the chart's indicator selection with it. */
  setSelected(selected: boolean): void {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** The dots of one draw pass; a hidden series paints none at all. */
  private draw(target: RenderTarget): void {
    const chart = this.chart;
    const series = this.series;
    if (chart === null || series === null || !series.options().visible) {
      return;
    }
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range === null) {
      return;
    }
    const dots = this.dotsIn(range);
    if (dots.length === 0) {
      return;
    }
    const ringColor = paneBackgroundColor(chart.options().layout.background);
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      paintDots(context, dots, { color: this.color, ringColor, horizontalPixelRatio, verticalPixelRatio });
    });
  }

  private dotsIn(range: LogicalRange): HandlePosition[] {
    const dots: HandlePosition[] = [];
    for (const index of handleBarIndices(range, this.lastBarIndex())) {
      const dot = this.dotAt(index);
      if (dot !== null) {
        dots.push(dot);
      }
    }
    return dots;
  }

  /** The logical index of the bar the plot's last point sits on; null while the plot holds no point. */
  private lastBarIndex(): number | null {
    const point = this.series?.data().at(-1);
    return point === undefined ? null : this.barIndexOf(point.time);
  }

  /** `time`'s logical index, read back from the coordinate it draws at; null while it has none. */
  private barIndexOf(time: Time): number | null {
    const timeScale = this.chart?.timeScale();
    const x = timeScale?.timeToCoordinate(time) ?? null;
    if (timeScale === undefined || x === null) {
      return null;
    }
    const logical = timeScale.coordinateToLogical(x);
    return logical === null ? null : Math.round(logical);
  }

  /** The dot of one bar: the point it plots, at the coordinate both axes give it; null where it has none. */
  private dotAt(index: number): HandlePosition | null {
    const series = this.series;
    const x = this.chart?.timeScale().logicalToCoordinate(index as Logical) ?? null;
    const point = series === null ? null : numericPointAt(series, index);
    const y = point === null || series === null ? null : series.priceToCoordinate(point.value);
    return x === null || y === null ? null : { x, y };
  }
}

/** Paints one ringed dot per handle: the background ring first, the plot's colour over it. */
function paintDots(context: CanvasRenderingContext2D, dots: readonly HandlePosition[], paint: HandlePaint): void {
  const radius = handleRadius(paint.horizontalPixelRatio);
  const ringRadius = radius + handleRingWidth(paint.horizontalPixelRatio);
  context.save();
  for (const dot of dots) {
    const centre = bitmapPointOf(dot, paint);
    fillCircle(context, centre, ringRadius, paint.ringColor);
    fillCircle(context, centre, radius, paint.color);
  }
  context.restore();
}

function bitmapPointOf(position: HandlePosition, paint: HandlePaint): HandlePosition {
  return { x: position.x * paint.horizontalPixelRatio, y: position.y * paint.verticalPixelRatio };
}

function fillCircle(context: CanvasRenderingContext2D, centre: HandlePosition, radius: number, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, FULL_CIRCLE_RADIANS);
  context.fill();
}
