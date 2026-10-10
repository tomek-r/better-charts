import type { IPrimitivePaneRenderer, IPrimitivePaneView } from 'lightweight-charts';
import { palette } from '../../../shared/theme/palette';
import { AttachedSeriesPrimitive } from './attachedPrimitive';
import { measureTextWidth } from './textMeasure';

/**
 * Pointer price/time labels for every tool, with crosshair lines only for Cross.
 *
 * The library's own crosshair is off on this chart (`CrosshairMode.Hidden`):
 * its price label fills the price axis and its time label prints the axis tick
 * formatter's text, neither of which is the shape this chart wants, and the
 * overlay stack below the pointer is ours anyway. Both labels are therefore
 * painted here, from the same coordinates the chart uses:
 *
 *  - Cross lines are 1 CSS px solid and continue over both axes, so the two
 *    readouts are visibly attached to them;
 *  - the time label is centred on the pointer x just above the time axis,
 *    leaving the axis tick labels visible;
 *  - the price label is a box hugged against the pane's right edge — just
 *    before the price axis, where the reference has it — with the app accent
 *    as its left edge.
 *
 * The time and price values are resolved at DRAW time from the pointer's pixel
 * position, so a scroll or zoom under a resting pointer updates the labels
 * with the data instead of leaving a stale readout behind.
 */

/** The canvas target a renderer draws on (fancy-canvas' `CanvasRenderingTarget2D`). */
type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** Palette mirrored from styles/tokens.css — a canvas renderer cannot read CSS variables. */
const LINE_COLOR = palette.textLabel;
const LABEL_BACKGROUND = palette.border;
const LABEL_TEXT_COLOR = palette.text;
const LABEL_ACCENT_COLOR = palette.accent;
const LABEL_FONT_WEIGHT = 400;
/** Text padding inside a label box, the box's minimum width, the accent bar width. */
const LABEL_PADDING = 8;
const MIN_LABEL_WIDTH = 54;
const ACCENT_WIDTH = 2;
/** Label height per chart font size: 22px at the default 11. */
const LABEL_HEIGHT_FACTOR = 2;

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
function formatCrosshairTime(seconds: number): string {
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

/** Pane geometry the labels are laid out in (CSS px). */
interface PaneRect {
  width: number;
  height: number;
}

/** Everything the dev-only test hook reports about one pointer position. */
export interface CrosshairReadout {
  x: number;
  y: number;
  linesVisible: boolean;
  timeSeconds: number | null;
  timeLabel: string | null;
  timeLabelBox: LabelBox | null;
  price: number | null;
  priceLabel: string | null;
  priceLabelBox: LabelBox | null;
}

/** Box height derived from the chart's own font size, so it tracks the axis labels. */
const labelHeight = (fontSize: number) => Math.round(fontSize * LABEL_HEIGHT_FACTOR);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** The price label: right-aligned in the pane, vertically centred, clamped inside it. */
function priceLabelBox(text: string, y: number, pane: PaneRect, font: string, fontSize: number): LabelBox {
  const width = Math.max(MIN_LABEL_WIDTH, Math.ceil(measureTextWidth(text, font)) + LABEL_PADDING * 2 + ACCENT_WIDTH);
  const height = labelHeight(fontSize);
  return {
    x: Math.max(0, pane.width - width),
    y: clamp(y - height / 2, 0, pane.height - height),
    width,
    height,
  };
}

/** The time label: centred on pointer x, along the pane bottom above the axis. */
function timeLabelBox(text: string, x: number, pane: PaneRect, font: string, fontSize: number): LabelBox {
  const width = Math.max(MIN_LABEL_WIDTH, Math.ceil(measureTextWidth(text, font)) + LABEL_PADDING * 2);
  const height = labelHeight(fontSize);
  return {
    x: clamp(x - width / 2, 0, pane.width - width),
    y: Math.max(0, pane.height - height),
    width,
    height,
  };
}

export class CrosshairPrimitive extends AttachedSeriesPrimitive {
  /** Pointer position in pane CSS px; null outside the pane. */
  private point: { x: number; y: number } | null = null;
  private linesVisible = false;
  private readonly pane: readonly IPrimitivePaneView[];
  private readonly timeAxis: readonly IPrimitivePaneView[];
  private readonly priceAxis: readonly IPrimitivePaneView[];

  constructor() {
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

  /** Tool changes affect the lines without dropping the pointer's axis labels. */
  setLinesVisible(visible: boolean): void {
    if (this.linesVisible === visible) {
      return;
    }
    this.linesVisible = visible;
    if (this.point !== null) {
      this.requestUpdate?.();
    }
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
  readout(): CrosshairReadout | null {
    const point = this.point;
    const chart = this.chart;
    if (point === null || chart === null) {
      return null;
    }
    const pane = { width: chart.timeScale().width(), height: chart.panes()[0]?.getHeight() ?? 0 };
    const font = this.labelFont();
    const fontSize = this.fontSize();
    const time = this.timeAt(point.x);
    const price = this.priceAt(point.y);
    return {
      x: point.x,
      y: point.y,
      linesVisible: this.linesVisible,
      timeSeconds: time?.seconds ?? null,
      timeLabel: time?.text ?? null,
      timeLabelBox: time === null ? null : timeLabelBox(time.text, point.x, pane, font, fontSize),
      price: price?.price ?? null,
      priceLabel: price?.text ?? null,
      priceLabelBox: price === null ? null : priceLabelBox(price.text, point.y, pane, font, fontSize),
    };
  }

  private drawPane(target: RenderTarget): void {
    const point = this.point;
    if (point === null) {
      return;
    }
    this.drawLines(target, [point.x], [point.y]);
    const price = this.priceAt(point.y);
    const time = this.timeAt(point.x);
    if (price === null && time === null) {
      return;
    }
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const font = this.labelFont();
      const fontSize = this.fontSize();
      context.save();
      if (price !== null) {
        const box = priceLabelBox(price.text, point.y, mediaSize, font, fontSize);
        this.drawLabel(context, box, price.text, font, 'left');
      }
      if (time !== null) {
        const box = timeLabelBox(time.text, point.x, mediaSize, font, fontSize);
        this.drawLabel(context, box, time.text, font, 'top');
      }
      context.restore();
    });
  }

  private drawTimeAxis(target: RenderTarget): void {
    const point = this.point;
    if (point !== null) {
      this.drawLines(target, [point.x], []);
    }
  }

  private drawPriceAxis(target: RenderTarget): void {
    const point = this.point;
    if (point === null) {
      return;
    }
    this.drawLines(target, [], [point.y]);
  }

  /**
   * The crosshair lines, snapped to the device pixel grid in bitmap space so a
   * 1px line stays 1px (and stays sharp) at every device pixel ratio.
   */
  private drawLines(target: RenderTarget, columns: number[], rows: number[]): void {
    if (!this.linesVisible) {
      return;
    }
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const { width, height } = context.canvas;
      context.save();
      context.strokeStyle = LINE_COLOR;
      for (const column of columns) {
        const x = Math.round(column * horizontalPixelRatio);
        context.lineWidth = horizontalPixelRatio;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (const row of rows) {
        const y = Math.round(row * verticalPixelRatio);
        context.lineWidth = verticalPixelRatio;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
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
    context.fillText(text, box.x + LABEL_PADDING + (accent === 'left' ? ACCENT_WIDTH : 0), box.y + box.height / 2);
  }

  private timeAt(x: number): { seconds: number; text: string } | null {
    const time = this.chart?.timeScale().coordinateToTime(x) ?? null;
    if (typeof time !== 'number') {
      return null;
    }
    return { seconds: time, text: formatCrosshairTime(time) };
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
