import type { IPrimitivePaneRenderer, IPrimitivePaneView } from 'lightweight-charts';
import { palette } from '../../../../shared/theme/palette';
import { AttachedSeriesPrimitive } from '../surface/attachedPrimitive';
import { priceTagHeight } from '../quotes/tagStack';
import { measureTextWidth } from '../text/textMeasure';
import {
  createDrawTarget,
  PANE_ABOVE_TRADING_OVERLAYS,
  PRICE_AXIS_ABOVE_TRADING_OVERLAYS,
  TIME_AXIS_ABOVE_TRADING_OVERLAYS,
  type RenderTarget,
} from '../surface/drawTarget';
import type { ChartDrawLayer, ChartDrawTarget, RenderViewport } from '../tools/toolContract';

/**
 * Pointer price/time labels shown for every tool, plus the tools' layer above the trading overlays.
 *
 * The library's own crosshair is off on this chart (`CrosshairMode.Hidden`):
 * its price label fills the price axis and its time label prints the axis tick
 * formatter's text, neither of which is the shape this chart wants, and the
 * overlay stack below the pointer is ours anyway. Both labels are therefore
 * painted here, from the same coordinates the chart uses. Each canvas first
 * runs the tools' above-trading-overlays layer (`drawToolLayer`, e.g. the crosshair
 * lines); the axis canvases then get the labels over it. Nothing pointer-related
 * is painted in the pane itself except that tool layer (owner decision):
 *
 *  - the time label is centred on the pointer x ON the time axis, as tall as the
 *    axis canvas, covering the tick labels under it while hovering, with the app
 *    accent as its top edge;
 *  - the price label is a box ON the price axis at the pointer y, as wide as the
 *    axis canvas and as tall as the Bid/Ask tags, with the app accent as its left
 *    edge. It is drawn after every other price-axis tag (this primitive is
 *    attached last, all views are `top`), so it covers the Bid/Ask/countdown and
 *    SL/TP tags. It takes the current axis width and never feeds the axis width
 *    hold logic.
 *
 * The time and price values are resolved at DRAW time from the pointer's pixel
 * position, so a scroll or zoom under a resting pointer updates the labels
 * with the data instead of leaving a stale readout behind.
 */

/** Colours come from the shared palette — a canvas renderer cannot read CSS variables. */
const LABEL_BACKGROUND = palette.border;
const LABEL_TEXT_COLOR = palette.text;
const LABEL_ACCENT_COLOR = palette.accent;
const LABEL_FONT_WEIGHT = 400;
/** Text padding inside a label box, the time box's minimum width, the accent bar width. */
const LABEL_PADDING = 8;
const MIN_LABEL_WIDTH = 54;
const ACCENT_WIDTH = 2;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * `Wed 30 Sep '26  08:03` — the date and the time of the bar under the pointer.
 * UTC, because that is the frame the library formats the time axis labels in;
 * formatting in the host's zone would print a time the axis next to it
 * contradicts. The two spaces before the clock are the reference's gap.
 */
function formatPointerTime(seconds: number): string {
  const at = new Date(seconds * 1000);
  const part = (type: 'day' | 'month' | 'year') =>
    DATE_FORMAT.formatToParts(at).find((entry) => entry.type === type)?.value ?? '';
  return `${WEEKDAY_FORMAT.format(at)} ${part('day')} ${part('month')} '${part('year')}  ${CLOCK_FORMAT.format(at)}`;
}

interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Size of the axis canvas a label is laid out on (CSS px). */
interface AxisRect {
  width: number;
  height: number;
}

/** Everything the dev-only test hook reports about one pointer position. */
export interface PointerReadout {
  x: number;
  y: number;
  timeSeconds: number | null;
  timeLabel: string | null;
  timeLabelBox: LabelBox | null;
  price: number | null;
  priceLabel: string | null;
  priceLabelBox: LabelBox | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The price label: flush with the price axis' left edge, vertically centred on the
 * pointer, clamped inside the axis. It never exceeds the axis width — the axis is
 * sized by the tags, not by the pointer — so a narrow axis squeezes the box.
 */
function priceLabelBox(y: number, axis: AxisRect, fontSize: number): LabelBox {
  const height = priceTagHeight(fontSize);
  return {
    x: 0,
    // Whole-pixel top, as the Bid/Ask tags round theirs: no blurred edge row.
    y: clamp(Math.round(y - height / 2), 0, axis.height - height),
    width: axis.width,
    height,
  };
}

/** The time label: centred on pointer x, filling the time axis' full height, clamped inside the pane's span. */
function timeLabelBox(text: string, x: number, paneWidth: number, axisHeight: number, font: string): LabelBox {
  const width = Math.max(MIN_LABEL_WIDTH, Math.ceil(measureTextWidth(text, font)) + LABEL_PADDING * 2);
  return {
    x: clamp(x - width / 2, 0, paneWidth - width),
    y: 0,
    width,
    height: axisHeight,
  };
}

export class PointerReadoutPrimitive extends AttachedSeriesPrimitive {
  /** Pointer position in pane CSS px; null outside the pane. */
  private point: { x: number; y: number } | null = null;
  private readonly pane: readonly IPrimitivePaneView[];
  private readonly timeAxis: readonly IPrimitivePaneView[];
  private readonly priceAxis: readonly IPrimitivePaneView[];

  /**
   * @param viewport the pane geometry handed to the tools.
   * @param drawToolLayer paints the tools' above-trading-overlays layer onto one canvas, under the labels.
   */
  constructor(
    private readonly viewport: () => RenderViewport,
    private readonly drawToolLayer: (target: ChartDrawTarget) => void,
  ) {
    super();
    // One renderer per canvas; each draws only once a position exists, so the
    // views are stable references and the hidden state costs nothing.
    this.pane = [this.view({ draw: (target) => this.drawPane(target) })];
    this.timeAxis = [this.view({ draw: (target) => this.drawTimeAxis(target) })];
    this.priceAxis = [this.view({ draw: (target) => this.drawPriceAxis(target) })];
  }

  private view(renderer: IPrimitivePaneRenderer): IPrimitivePaneView {
    return { zOrder: () => 'top', renderer: () => (this.point === null ? null : renderer) };
  }

  /** Follow the pointer (pane CSS px). Cheap to call per pointermove. */
  move(x: number, y: number): void {
    const point = this.point;
    if (point !== null && point.x === x && point.y === y) {
      return;
    }
    this.point = { x, y };
    this.requestUpdate?.();
  }

  hide(): void {
    if (this.point === null) {
      return;
    }
    this.point = null;
    this.requestUpdate?.();
  }

  detached(): void {
    super.detached();
    this.point = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.pane;
  }

  timeAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.timeAxis;
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.priceAxis;
  }

  /** Test-hook surface: the labels and boxes for the current position. */
  readout(): PointerReadout | null {
    const point = this.point;
    const chart = this.chart;
    if (point === null || chart === null) {
      return null;
    }
    const paneWidth = chart.timeScale().width();
    const priceAxis = { width: chart.priceScale('right').width(), height: chart.panes()[0]?.getHeight() ?? 0 };
    const font = this.labelFont();
    const fontSize = this.fontSize();
    const time = this.timeAt(point.x);
    const price = this.priceAt(point.y);
    return {
      x: point.x,
      y: point.y,
      timeSeconds: time?.seconds ?? null,
      timeLabel: time?.text ?? null,
      timeLabelBox:
        time === null ? null : timeLabelBox(time.text, point.x, paneWidth, chart.timeScale().height(), font),
      price: price?.price ?? null,
      priceLabel: price?.text ?? null,
      priceLabelBox: price === null ? null : priceLabelBox(point.y, priceAxis, fontSize),
    };
  }

  /** The pane only gets the tools' layer: the readouts live on the axes. */
  private drawPane(target: RenderTarget): void {
    this.paintTopLayer(target, PANE_ABOVE_TRADING_OVERLAYS);
  }

  private drawTimeAxis(target: RenderTarget): void {
    this.paintTopLayer(target, TIME_AXIS_ABOVE_TRADING_OVERLAYS);
    const point = this.point;
    const time = point === null ? null : this.timeAt(point.x);
    const chart = this.chart;
    if (point === null || time === null || chart === null) {
      return;
    }
    const paneWidth = chart.timeScale().width();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const font = this.labelFont();
      const box = timeLabelBox(time.text, point.x, paneWidth, mediaSize.height, font);
      context.save();
      this.drawLabel(context, box, time.text, font, 'top');
      context.restore();
    });
  }

  private drawPriceAxis(target: RenderTarget): void {
    this.paintTopLayer(target, PRICE_AXIS_ABOVE_TRADING_OVERLAYS);
    const point = this.point;
    const price = point === null ? null : this.priceAt(point.y);
    if (point === null || price === null) {
      return;
    }
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const font = this.labelFont();
      const box = priceLabelBox(point.y, mediaSize, this.fontSize());
      context.save();
      this.drawLabel(context, box, price.text, font, 'left');
      context.restore();
    });
  }

  /** Hands the active tool this canvas. Only called while a pointer is over the pane. */
  private paintTopLayer(target: RenderTarget, layer: ChartDrawLayer): void {
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      this.drawToolLayer(createDrawTarget(target, context, this.viewport(), layer));
      context.restore();
    });
  }

  /** Opaque badge with an accent edge: left for price, top for date/time. */
  private drawLabel(
    context: CanvasRenderingContext2D,
    box: LabelBox,
    text: string,
    font: string,
    accent: 'left' | 'top',
  ): void {
    context.fillStyle = LABEL_BACKGROUND;
    context.fillRect(box.x, box.y, box.width, box.height);
    context.fillStyle = LABEL_ACCENT_COLOR;
    if (accent === 'left') {
      context.fillRect(box.x, box.y, ACCENT_WIDTH, box.height);
    } else {
      context.fillRect(box.x, box.y, box.width, ACCENT_WIDTH);
    }
    context.font = font;
    context.fillStyle = LABEL_TEXT_COLOR;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const inset = LABEL_PADDING + (accent === 'left' ? ACCENT_WIDTH : 0);
    // maxWidth squeezes the text instead of overflowing when the box was capped to a narrow axis.
    context.fillText(text, box.x + inset, box.y + box.height / 2, Math.max(1, box.width - inset - 2));
  }

  private timeAt(x: number): { seconds: number; text: string } | null {
    const time = this.chart?.timeScale().coordinateToTime(x) ?? null;
    if (typeof time !== 'number') {
      return null;
    }
    return { seconds: time, text: formatPointerTime(time) };
  }

  private priceAt(y: number): { price: number; text: string } | null {
    const series = this.series;
    if (series === null) {
      return null;
    }
    const price = series.coordinateToPrice(y);
    if (price === null || !Number.isFinite(price)) {
      return null;
    }
    const formatter = series.priceFormatter();
    return { price, text: formatter === undefined ? String(price) : formatter.format(price) };
  }

  private fontSize(): number {
    return this.chart?.options().layout.fontSize ?? 11;
  }

  private labelFont(): string {
    const family = this.chart?.options().layout.fontFamily ?? 'sans-serif';
    return `${LABEL_FONT_WEIGHT} ${this.fontSize()}px ${family}`;
  }
}
