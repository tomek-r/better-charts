import type {
  IChartApi,
  IPaneApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { palette } from '../../../shared/theme/palette';

/**
 * Bid/Ask price-axis labels.
 *
 * The lines are native Lightweight Charts price lines; only their labels are
 * positioned here. A price line cannot own them: the library's label alignment
 * splits its labels around the series' last price and pushes overlapping ones
 * apart, and that price alternates between the Bid and the Ask tick, so with a
 * spread inside one label height the pair is restacked on every tick and jumps.
 * A second, label-only price line cannot be used either, because a price line's
 * axis label always prints its own price: shifting one far enough to separate
 * the tags would print a price the market never traded.
 *
 * So the tags are ordinary price-axis labels — the library paints them exactly
 * as it paints a native price line's label — spaced by the two prices so both
 * stay readable, and only ever moving with the scale.
 */

/** Height of a primitive price-axis label, per 12px of font. */
export const priceTagHeight = (fontSize: number) => fontSize * (1 + 2 * ((2.5 + 2) / 12));

/**
 * Half the shortfall when two tags would sit closer than one tag height, so
 * each moves away by the same amount. Zero once they are far enough apart,
 * which leaves a wide spread looking exactly like the native labels.
 */
export const priceTagOffset = (gap: number, height: number) => Math.max(0, height - Math.abs(gap)) / 2;

export interface PriceAxisTagsState {
  ask?: number;
  bid?: number;
}

/**
 * The library measures label text with digits 2-9 replaced by `0` (its width
 * cache) and draws what it is given, so a price containing `1` measures
 * narrower than one that does not. Two labels that sit as one column then end
 * up ragged, which is what a Bid/Ask stack looks like. Both texts are measured
 * here the same way and the narrower one is padded with hair spaces, which are
 * invisible and leave the digits exactly where they were.
 */
const CACHE_NORMALISATION = /[2-9]/g;
const HAIR_SPACE = '\u200a';

let measurer: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (measurer === null) {
    return 0;
  }
  measurer.font = font;
  return measurer.measureText(text.replace(CACHE_NORMALISATION, '0')).width;
}

export interface PriceAxisTagsOptions {
  askColor: string;
  bidColor: string;
}

export class PriceAxisTagsPrimitive implements ISeriesPrimitive<Time> {
  private readonly axisViews: readonly ISeriesPrimitiveAxisView[];
  private options: PriceAxisTagsOptions;
  private readonly state: PriceAxisTagsState = {};
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: IChartApi | null = null;
  private pane: IPaneApi<Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private paneHeight = 0;
  /** Pending post-paint width read, so a burst of quotes schedules one. */
  private widthFrame = 0;
  /** The axis width the chart was configured with, restored on a symbol change. */
  private configuredMinimumWidth = 0;
  /** Widest axis width needed so far; never lowered while this series is shown. */
  private heldAxisWidth = 0;
  /** Formatted (and width-matched) tag texts, kept until prices or font move. */
  private texts: { key: string; ask: string; bid: string } = { key: '', ask: '', bid: '' };

  constructor(options: PriceAxisTagsOptions) {
    this.options = { ...options };
    const tags: Array<{ price: () => number | undefined; side: 'ask' | 'bid' }> = [
      { price: () => this.state.ask, side: 'ask' },
      { price: () => this.state.bid, side: 'bid' },
    ];
    this.axisViews = tags.map((tag) => ({
      coordinate: () => this.coordinate(tag.price(), tag.side),
      text: () => this.text(tag.price(), tag.side),
      textColor: () => palette.text,
      backColor: () => (tag.side === 'ask' ? this.options.askColor : this.options.bidColor),
      tickVisible: () => false,
      visible: () => this.visible(tag.price(), tag.side),
    }));
  }

  /** Mirror the owner's quotes in; the tags follow the prices themselves. */
  update(state: Readonly<PriceAxisTagsState>): void {
    const changed = this.state.ask !== state.ask || this.state.bid !== state.bid;
    this.state.ask = state.ask;
    this.state.bid = state.bid;
    if (changed) {
      this.requestUpdate?.();
      this.holdAxisWidthAfterPaint();
    }
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
    // The pane height bounds the tags. Resolved once here; `updateAllViews`
    // re-reads it, so nothing walks the pane list on the per-frame path.
    this.pane = chart.panes().find((candidate) => candidate.getSeries().includes(series)) ?? null;
    this.paneHeight = this.pane?.getHeight() ?? 0;
    this.configuredMinimumWidth = series.priceScale().options().minimumWidth;
    this.heldAxisWidth = this.configuredMinimumWidth;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.pane = null;
    this.requestUpdate = null;
    this.paneHeight = 0;
    cancelAnimationFrame(this.widthFrame);
    this.widthFrame = 0;
    this.configuredMinimumWidth = 0;
    this.heldAxisWidth = 0;
    this.state.ask = undefined;
    this.state.bid = undefined;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  updateAllViews(): void {
    this.paneHeight = this.pane?.getHeight() ?? 0;
  }

  /**
   * Reads the settled axis width once the tags have been drawn.
   *
   * The width is only final after the paint that lays the labels out, so
   * measuring before it would hold the width the axis had *without* them —
   * the very narrowing this guards against.
   */
  private holdAxisWidthAfterPaint(): void {
    if (this.widthFrame !== 0) {
      return;
    }
    this.widthFrame = requestAnimationFrame(() => {
      this.widthFrame = 0;
      this.holdAxisWidth();
    });
  }

  /**
   * Holds the price axis at the widest width it has needed, so a label that stops
   * being drawn cannot narrow it.
   *
   * The Bid/Ask tags leave the pane as soon as the price ticks outside the visible
   * range, and a label that stops being measured narrows the axis — which widens
   * the pane by those pixels and slides the whole chart sideways. A price sitting
   * on that boundary therefore shook the chart left and right on every tick, and
   * the same happened whenever the tags came back. Holding the width costs a few
   * pixels once and removes the movement.
   */
  private holdAxisWidth(): void {
    const scale = this.series?.priceScale();
    if (scale === undefined) {
      return;
    }
    const width = scale.width();
    if (width > this.heldAxisWidth) {
      this.heldAxisWidth = width;
      scale.applyOptions({ minimumWidth: width });
    }
  }

  /**
   * Releases the held width, so the next instrument sizes its axis from its own
   * prices instead of the widest label the previous one happened to show.
   */
  releaseAxisWidth(): void {
    this.heldAxisWidth = this.configuredMinimumWidth;
    const scale = this.series?.priceScale();
    if (scale !== undefined && scale.options().minimumWidth !== this.configuredMinimumWidth) {
      scale.applyOptions({ minimumWidth: this.configuredMinimumWidth });
    }
  }

  /** Both tags move away from each other by the same amount when they would touch. */
  private offset(): number {
    const ask = this.coordinateOf(this.state.ask);
    const bid = this.coordinateOf(this.state.bid);
    if (ask === null || bid === null) {
      return 0;
    }
    return priceTagOffset(bid - ask, priceTagHeight(this.fontSize()));
  }

  private coordinateOf(price: number | undefined): number | null {
    if (price === undefined || this.series === null) {
      return null;
    }
    return this.series.priceToCoordinate(price);
  }

  private coordinate(price: number | undefined, side: 'ask' | 'bid'): number {
    const y = this.coordinateOf(price);
    if (y === null) {
      return NaN;
    }
    // Ask above its price, Bid below its price: the pair grows outwards, so one
    // tag never covers the other however tight the spread gets, and with a wide
    // spread the offset is zero and they sit on their prices like native labels.
    const offset = this.offset();
    return side === 'ask' ? y - offset : y + offset;
  }

  private text(price: number | undefined, side: 'ask' | 'bid'): string {
    if (price === undefined || this.series === null) {
      return '';
    }
    return this.tagTexts()[side];
  }

  /**
   * Both tag texts, the narrower padded so the pair shares one width. A price
   * line's own label would be ragged here for the same reason, because the
   * library measures every label through the same digit-normalising cache.
   */
  private tagTexts(): { ask: string; bid: string } {
    const formatter = this.series?.priceFormatter();
    const ask = formatter === undefined || this.state.ask === undefined ? '' : formatter.format(this.state.ask);
    const bid = formatter === undefined || this.state.bid === undefined ? '' : formatter.format(this.state.bid);
    const font = `${this.fontSize()}px ${this.fontFamily()}`;
    const key = `${ask}|${bid}|${font}`;
    if (this.texts.key === key) {
      return this.texts;
    }
    const target = Math.max(textWidth(ask, font), textWidth(bid, font));
    const padded = (text: string) => {
      let out = text;
      // Hair spaces only: they are invisible, and the digits keep their places.
      while (out.length < 32 && textWidth(out, font) + 0.25 < target) {
        out += HAIR_SPACE;
      }
      return out;
    };
    this.texts = { key, ask: padded(ask), bid: padded(bid) };
    return this.texts;
  }

  /** Font size the tags are sized against, matching the library's own labels. */
  private fontSize(): number {
    return this.chart?.options().layout.fontSize ?? 11;
  }

  private fontFamily(): string {
    return this.chart?.options().layout.fontFamily ?? 'sans-serif';
  }

  private visible(price: number | undefined, side: 'ask' | 'bid'): boolean {
    const y = this.coordinate(price, side);
    return this.text(price, side) !== '' && Number.isFinite(y) && y >= 0 && y <= this.paneHeight;
  }
}
