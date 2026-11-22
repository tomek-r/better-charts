import {
  type Background,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type Logical,
  type LogicalRange,
  type PrimitivePaneViewZOrder,
  type Time,
} from 'lightweight-charts';
import { palette } from '../../../../shared/theme/palette';
import { ChartSeriesPrimitive } from '../surface/chartSeriesPrimitive';
import type { RenderTarget } from '../surface/drawTarget';
import { handleBarIndices } from './indicatorHandleIndices';
import { handleRing } from './indicatorHandles';
import { numericPointAt } from './indicatorSeriesValue';

/** Handles paint over the line they mark, so a ring stays readable where the line crosses it. */
const HANDLE_VIEW_Z_ORDER: PrimitivePaneViewZOrder = 'top';

/** The arc that traces a circle once round. */
const FULL_CIRCLE_RADIANS = Math.PI * 2;

/**
 * How many times a handle's inside is filled with the pane background. The chart's background may
 * carry an alpha, as the app's default one does; laid once, it would let the plot line tint the inside.
 */
const PANE_FILL_PASSES = 2;

/** A position on the target: media (CSS) pixels until `bitmapPointOf` scales it. */
interface HandlePosition {
  readonly x: number;
  readonly y: number;
}

/** What every handle of one draw pass shares: the colour inside its ring and the ratios its position scales by. */
interface HandlePaint {
  readonly paneColor: string;
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

/** The colour behind the pane: a gradient's top colour, or the solid one. */
function paneBackgroundColor(background: Background): string {
  return 'topColor' in background ? background.topColor : background.color;
}

/**
 * Paints the handles of one selected plot: a hollow ring, 9 CSS pixels across and stroked in the
 * selection blue, on every 10th visible bar and on the bar the plot's line ends on. The ring's inside
 * is the pane background, so the line the handle marks does not show through it.
 *
 * Attached to the plot's own line series, so the rings share its scale and pane. It reads the series'
 * data on every draw, like the marker primitive, because the layer updates one series at a time and
 * the chart repaints after each.
 */
export class IndicatorPlotHandles extends ChartSeriesPrimitive {
  private readonly views: readonly IPrimitivePaneView[];
  private selected = false;

  constructor() {
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

  /** The handles of one draw pass; a hidden series paints none at all. */
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
    const handles = this.handlesIn(range);
    if (handles.length === 0) {
      return;
    }
    const paneColor = paneBackgroundColor(chart.options().layout.background);
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      paintHandles(context, handles, { paneColor, horizontalPixelRatio, verticalPixelRatio });
    });
  }

  private handlesIn(range: LogicalRange): HandlePosition[] {
    const handles: HandlePosition[] = [];
    for (const index of handleBarIndices(range, this.lastBarIndex())) {
      const handle = this.handleAt(index);
      if (handle !== null) {
        handles.push(handle);
      }
    }
    return handles;
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

  /** The handle of one bar: the point it plots, at the coordinate both axes give it; null where it has none. */
  private handleAt(index: number): HandlePosition | null {
    const series = this.series;
    const x = this.chart?.timeScale().logicalToCoordinate(index as Logical) ?? null;
    const point = series === null ? null : numericPointAt(series, index);
    const y = point === null || series === null ? null : series.priceToCoordinate(point.value);
    return x === null || y === null ? null : { x, y };
  }
}

/** Paints one ring per handle: the pane background inside it, then the selection blue round it. */
function paintHandles(context: CanvasRenderingContext2D, handles: readonly HandlePosition[], paint: HandlePaint): void {
  const ring = handleRing(paint.horizontalPixelRatio);
  context.save();
  context.strokeStyle = palette.selection;
  context.lineWidth = ring.strokeWidth;
  for (const handle of handles) {
    const centre = bitmapPointOf(handle, paint);
    fillDisc(context, centre, ring.fillRadius, paint.paneColor);
    strokeCircle(context, centre, ring.strokeRadius);
  }
  context.restore();
}

function bitmapPointOf(position: HandlePosition, paint: HandlePaint): HandlePosition {
  return { x: position.x * paint.horizontalPixelRatio, y: position.y * paint.verticalPixelRatio };
}

/** Fills a disc with the pane background, laid `PANE_FILL_PASSES` deep so an alpha in it shows no line. */
function fillDisc(context: CanvasRenderingContext2D, centre: HandlePosition, radius: number, color: string): void {
  context.fillStyle = color;
  traceCircle(context, centre, radius);
  for (let pass = 0; pass < PANE_FILL_PASSES; pass += 1) {
    context.fill();
  }
}

function strokeCircle(context: CanvasRenderingContext2D, centre: HandlePosition, radius: number): void {
  traceCircle(context, centre, radius);
  context.stroke();
}

function traceCircle(context: CanvasRenderingContext2D, centre: HandlePosition, radius: number): void {
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, FULL_CIRCLE_RADIANS);
}
