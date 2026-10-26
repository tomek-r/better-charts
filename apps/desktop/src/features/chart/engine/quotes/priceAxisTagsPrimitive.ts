import type {
  IPriceScaleApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { palette } from '../../../../shared/theme/palette';
import { AttachedSeriesPrimitive } from '../surface/attachedPrimitive';
import type { RenderTarget } from '../surface/drawTarget';
import { paintTag, tagLayout, type TagLayout } from '../text/fixedCellText';
import { priceTagHeight, tagStackTops } from './tagStack';

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
 * So the tags are price-axis labels drawn here in the library's label style,
 * spaced by the two prices so both stay readable, and only ever moving with the
 * scale.
 */

export interface PriceAxisTagsState {
  ask?: number;
  bid?: number;
}

/**
 * The tags are painted here, not by the library, because the library sizes a
 * label to its text and the chart font is proportional: the box breathed as the
 * digits changed, and its stack neighbour (the countdown) looked dynamic. The
 * digits are drawn in fixed cells (see `fixedCellText`), so the width depends
 * only on the number of characters.
 */
interface TagTexts {
  key: string;
  ask: string;
  bid: string;
  font: string;
  layouts: { ask: TagLayout; bid: TagLayout };
  /** Box width shared by the pair. */
  width: number;
}

export interface PriceAxisTagsOptions {
  askColor: string;
  bidColor: string;
}

export class PriceAxisTagsPrimitive extends AttachedSeriesPrimitive {
  private readonly axisViews: readonly IPrimitivePaneView[];
  /** Axis coordinate of each tag's centre captured by `updateAllViews`; NaN while hidden. */
  private readonly shownY = { ask: NaN, bid: NaN };
  private options: PriceAxisTagsOptions;
  private readonly state: PriceAxisTagsState = {};
  /** Pending post-paint width read, so a burst of quotes schedules one. */
  private widthFrame = 0;
  /** The axis width the chart was configured with, restored on a symbol change. */
  private configuredMinimumWidth = 0;
  /** Widest axis width needed so far; never lowered while this series is shown. */
  private heldAxisWidth = 0;
  /** Formatted tag texts and layouts, kept until prices or font move. */
  private texts: TagTexts = {
    key: '',
    ask: '',
    bid: '',
    font: '',
    layouts: { ask: { width: 0, glyphs: [] }, bid: { width: 0, glyphs: [] } },
    width: 0,
  };

  constructor(options: PriceAxisTagsOptions) {
    super();
    this.options = { ...options };
    // The view list is stable: the library caches views by array identity. A
    // hidden tag has no renderer, so it costs nothing.
    this.axisViews = (['ask', 'bid'] as const).map((side) => {
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
      this.reserveAxisWidthForTags();
      this.requestUpdate?.();
      this.holdAxisWidthAfterPaint();
    }
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    super.attached(params);
    this.configuredMinimumWidth = params.series.priceScale().options().minimumWidth;
    this.heldAxisWidth = this.configuredMinimumWidth;
  }

  detached(): void {
    super.detached();
    this.shownY.ask = NaN;
    this.shownY.bid = NaN;
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
    this.shownY.ask = this.visible(this.state.ask, 'ask') ? this.coordinate(this.state.ask, 'ask') : NaN;
    this.shownY.bid = this.visible(this.state.bid, 'bid') ? this.coordinate(this.state.bid, 'bid') : NaN;
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
    const shown = !Number.isNaN(this.shownY.ask) || !Number.isNaN(this.shownY.bid);
    const width = Math.max(scale.width(), shown ? this.texts.width : 0);
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
    const { width } = this.tagTexts();
    this.raiseAxisWidth(scale, width);
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

  private coordinate(price: number | undefined, side: 'ask' | 'bid'): number {
    if (this.coordinateOf(price) === null) {
      return NaN;
    }
    // Ask above its price, Bid below its price: the pair grows outwards, so one
    // tag never covers the other however tight the spread gets, and with a wide
    // spread they sit on their prices like native labels. The box tops are whole
    // pixels shared with the countdown (see `tagStackTops`).
    const height = priceTagHeight(this.labelFontSize());
    const tops = tagStackTops(this.coordinateOf(this.state.ask), this.coordinateOf(this.state.bid), height);
    return tops[side] + height / 2;
  }

  private text(price: number | undefined, side: 'ask' | 'bid'): string {
    if (price === undefined || this.series === null) {
      return '';
    }
    return this.tagTexts()[side];
  }

  /**
   * Both tag texts and their fixed-cell layouts, kept until a price or the font
   * changes. The pair shares one box width: with the same number of characters
   * it is already equal, and a price that gains a digit widens both.
   */
  private tagTexts(): TagTexts {
    const formatter = this.series?.priceFormatter();
    const ask = formatter === undefined || this.state.ask === undefined ? '' : formatter.format(this.state.ask);
    const bid = formatter === undefined || this.state.bid === undefined ? '' : formatter.format(this.state.bid);
    const fontSize = this.labelFontSize();
    const font = `${fontSize}px ${this.labelFontFamily()}`;
    const key = `${ask}|${bid}|${font}`;
    if (this.texts.key === key) {
      return this.texts;
    }
    const layouts = { ask: tagLayout(ask, font, fontSize), bid: tagLayout(bid, font, fontSize) };
    const width = Math.max(layouts.ask.width, layouts.bid.width);
    this.texts = { key, ask, bid, font, layouts, width };
    return this.texts;
  }

  private visible(price: number | undefined, side: 'ask' | 'bid'): boolean {
    const y = this.coordinate(price, side);
    return this.text(price, side) !== '' && Number.isFinite(y) && y >= 0 && y <= this.paneHeight;
  }

  /** Box and fixed-cell digits, in the axis canvas' own coordinates. */
  private draw(target: RenderTarget, side: 'ask' | 'bid'): void {
    const centre = this.shownY[side];
    if (Number.isNaN(centre)) {
      return;
    }
    const texts = this.tagTexts();
    const height = priceTagHeight(this.labelFontSize());
    target.useMediaCoordinateSpace(({ context }) => {
      paintTag(context, {
        layout: texts.layouts[side],
        width: texts.width,
        font: texts.font,
        backColor: side === 'ask' ? this.options.askColor : this.options.bidColor,
        textColor: palette.text,
        top: Math.round(centre - height / 2),
        height,
      });
    });
  }
}
