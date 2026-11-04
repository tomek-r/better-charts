import type {
  IPriceScaleApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { palette } from '../../../../shared/theme/palette';
import { ChartSeriesPrimitive } from '../surface/chartSeriesPrimitive';
import { DEFAULT_CHART_SCALES_APPEARANCE } from '../surface/chartScalesAppearance';
import type { RenderTarget } from '../surface/drawTarget';
import { paintTag, tagLayout, type TagLayout } from '../text/priceTag';
import { priceTagHeight, tagStackTops } from './tagStack';

/**
 * The price-axis tags the quote draws: the Bid and Ask prices, and the chart's symbol name under
 * them.
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
 * So the tags are price-axis labels drawn here in the library's label style,
 * spaced by the two prices so both stay readable, and only ever moving with the
 * scale. The symbol name rides in the same stack, so it can never cover a quote
 * tag whichever price the market trades at.
 */

export interface PriceAxisTagsState {
  ask?: number;
  bid?: number;
}

/** The tags this primitive paints, in the stack order `tagStackTops` places them. */
const TAG_SIDES = ['ask', 'bid', 'symbol'] as const;

type TagSide = (typeof TAG_SIDES)[number];

/**
 * The tags are painted here, not by the library, because the library sizes a
 * label to its text and the chart font is proportional: the box breathed as the
 * digits changed, and its stack neighbour (the countdown) looked dynamic. The
 * digits are drawn in fixed cells (see `priceTag`), so the width depends
 * only on the number of characters.
 */
interface TagTexts {
  key: string;
  font: string;
  layouts: Readonly<Record<TagSide, TagLayout>>;
  /** Box width the Ask and Bid pair shares: the same digits count, and a price that gains one widens both. */
  priceWidth: number;
  /** Width of the widest box drawn, which the price axis has to be at least as wide as. */
  widestWidth: number;
}

export interface PriceAxisTagsOptions {
  askColor: string;
  bidColor: string;
  /** Whether the chart's symbol is drawn as a tag under the countdown, which the Symbol name label sets. */
  symbolNameLabel: boolean;
}

/** The tags a chart draws until the Bid and ask setting names other colours. */
const DEFAULT_TAG_OPTIONS: PriceAxisTagsOptions = {
  askColor: DEFAULT_CHART_SCALES_APPEARANCE.bidAsk.ask,
  bidColor: DEFAULT_CHART_SCALES_APPEARANCE.bidAsk.bid,
  symbolNameLabel: DEFAULT_CHART_SCALES_APPEARANCE.symbolNameLabel,
};

export class PriceAxisTagsPrimitive extends ChartSeriesPrimitive {
  private readonly axisViews: readonly IPrimitivePaneView[];
  /** Axis coordinate of each tag's centre captured by `updateAllViews`; NaN while hidden. */
  private readonly shownY: Record<TagSide, number> = { ask: NaN, bid: NaN, symbol: NaN };
  private options: PriceAxisTagsOptions;
  private readonly state: PriceAxisTagsState = {};
  /** The chart's symbol, drawn as a tag only while the Symbol name label setting draws it. */
  private symbol = '';
  /** Pending post-paint width read, so a burst of quotes schedules one. */
  private widthFrame = 0;
  /** The axis width the chart was configured with, restored on a symbol change. */
  private configuredMinimumWidth = 0;
  /** Widest axis width needed so far; never lowered while this series is shown. */
  private heldAxisWidth = 0;
  /** Formatted tag texts and layouts, kept until prices, symbol or font move. */
  private texts: TagTexts = {
    key: '',
    font: '',
    layouts: {
      ask: { width: 0, glyphs: [] },
      bid: { width: 0, glyphs: [] },
      symbol: { width: 0, glyphs: [] },
    },
    priceWidth: 0,
    widestWidth: 0,
  };

  constructor(options: PriceAxisTagsOptions = DEFAULT_TAG_OPTIONS) {
    super();
    this.options = { ...options };
    // The view list is stable: the library caches views by array identity. A
    // hidden tag has no renderer, so it costs nothing.
    this.axisViews = TAG_SIDES.map((side) => {
      const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target, side) };
      return {
        zOrder: () => 'top' as const,
        renderer: () => (Number.isNaN(this.shownY[side]) ? null : renderer),
      };
    });
  }

  /** Mirror the owner's quotes in; the tags follow the prices themselves. */
  update(state: Readonly<PriceAxisTagsState>): void {
    const changed = this.state.ask !== state.ask || this.state.bid !== state.bid;
    this.state.ask = state.ask;
    this.state.bid = state.bid;
    if (changed) {
      this.tagsChanged();
    }
  }

  /** The chart's symbol; the symbol tag follows it, so a new instrument re-lays it out at once. */
  setSymbol(symbol: string): void {
    if (symbol === this.symbol) {
      return;
    }
    this.symbol = symbol;
    this.tagsChanged();
  }

  /** The colours the Bid and ask setting names, and whether the symbol name tag is drawn. */
  applyOptions(options: Partial<PriceAxisTagsOptions>): void {
    this.options = { ...this.options, ...options };
    this.tagsChanged();
  }

  /** Whether the symbol name tag is drawn, which the dev test hook reads back. */
  symbolNameLabel(): boolean {
    return this.options.symbolNameLabel;
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    super.attached(params);
    this.configuredMinimumWidth = params.series.priceScale().options().minimumWidth;
    this.heldAxisWidth = this.configuredMinimumWidth;
  }

  detached(): void {
    super.detached();
    this.hideTags();
    cancelAnimationFrame(this.widthFrame);
    this.widthFrame = 0;
    this.configuredMinimumWidth = 0;
    this.heldAxisWidth = 0;
    this.state.ask = undefined;
    this.state.bid = undefined;
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.axisViews;
  }

  /** Runs on every chart update, before the axis is painted; the draw reads this snapshot. */
  updateAllViews(): void {
    this.refreshPaneHeight();
    const height = priceTagHeight(this.labelFontSize());
    const tops = tagStackTops(this.coordinateOf(this.state.ask), this.coordinateOf(this.state.bid), height);
    for (const side of TAG_SIDES) {
      this.shownY[side] = this.shownCentre(side, tops[side], height);
    }
  }

  /**
   * A change the layout depends on: widen the axis before the paint that first draws the boxes, and
   * repaint. The post-paint read then holds whatever the settled width turned out to be.
   */
  private tagsChanged(): void {
    this.reserveAxisWidthForTags();
    this.requestUpdate?.();
    this.holdAxisWidthAfterPaint();
  }

  /** Centre of a tag's box when it is drawn, NaN when it has no text or its box leaves the pane. */
  private shownCentre(side: TagSide, top: number, height: number): number {
    const centre = top + height / 2;
    const onPane = Number.isFinite(centre) && centre >= 0 && centre <= this.paneHeight;
    return onPane && this.text(side) !== '' ? centre : NaN;
  }

  private hideTags(): void {
    for (const side of TAG_SIDES) {
      this.shownY[side] = NaN;
    }
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
    // The tags are painted here, so the library's own width no longer includes
    // them: the axis must also be at least as wide as the boxes drawn.
    const shown = TAG_SIDES.some((side) => !Number.isNaN(this.shownY[side]));
    const width = Math.max(scale.width(), shown ? this.texts.widestWidth : 0);
    this.raiseAxisWidth(scale, width);
  }

  private raiseAxisWidth(scale: IPriceScaleApi, width: number): void {
    if (width > this.heldAxisWidth) {
      this.heldAxisWidth = width;
      scale.applyOptions({ minimumWidth: width });
    }
  }

  /**
   * Widens the axis for the tag boxes before the paint that first draws them.
   *
   * The library no longer counts the tags in its own width, so waiting for the
   * post-paint read left one frame at the narrower axis: the pane then narrowed
   * a frame later and the visible logical range slid by a bar.
   */
  private reserveAxisWidthForTags(): void {
    const scale = this.series?.priceScale();
    if (scale === undefined) {
      return;
    }
    const { widestWidth } = this.tagTexts();
    this.raiseAxisWidth(scale, widestWidth);
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

  private coordinateOf(price: number | undefined): number | null {
    if (price === undefined || this.series === null) {
      return null;
    }
    return this.series.priceToCoordinate(price);
  }

  /** The text a tag writes: a formatted price, or the symbol while the Symbol name label draws it. */
  private text(side: TagSide): string {
    if (side === 'symbol') {
      return this.options.symbolNameLabel ? this.symbol : '';
    }
    return this.priceText(side === 'ask' ? this.state.ask : this.state.bid);
  }

  private priceText(price: number | undefined): string {
    const formatter = this.series?.priceFormatter();
    return formatter === undefined || price === undefined ? '' : formatter.format(price);
  }

  /**
   * Every tag's text and fixed-cell layout, kept until a price, the symbol or the
   * font changes. The Ask and Bid pair shares one box width: with the same number
   * of characters it is already equal, and a price that gains a digit widens both.
   */
  private tagTexts(): TagTexts {
    const ask = this.text('ask');
    const bid = this.text('bid');
    const symbol = this.text('symbol');
    const font = this.labelFont();
    const key = `${ask}|${bid}|${symbol}|${font}`;
    if (this.texts.key === key) {
      return this.texts;
    }
    const fontSize = this.labelFontSize();
    const layouts = {
      ask: tagLayout(ask, font, fontSize),
      bid: tagLayout(bid, font, fontSize),
      symbol: tagLayout(symbol, font, fontSize),
    };
    const priceWidth = Math.max(layouts.ask.width, layouts.bid.width);
    this.texts = { key, font, layouts, priceWidth, widestWidth: Math.max(priceWidth, layouts.symbol.width) };
    return this.texts;
  }

  /** The box each tag is painted in: the Ask and Bid pair share one width, the symbol its own. */
  private boxWidth(texts: TagTexts, side: TagSide): number {
    return side === 'symbol' ? texts.layouts.symbol.width : texts.priceWidth;
  }

  /** Box and fixed-cell digits, in the axis canvas' own coordinates. */
  private draw(target: RenderTarget, side: TagSide): void {
    const centre = this.shownY[side];
    if (Number.isNaN(centre)) {
      return;
    }
    const texts = this.tagTexts();
    const height = priceTagHeight(this.labelFontSize());
    target.useMediaCoordinateSpace(({ context }) => {
      paintTag(context, {
        layout: texts.layouts[side],
        width: this.boxWidth(texts, side),
        font: texts.font,
        backColor: side === 'ask' ? this.options.askColor : this.options.bidColor,
        textColor: palette.text,
        top: Math.round(centre - height / 2),
        height,
      });
    });
  }
}
