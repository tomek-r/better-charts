import type {
  IPaneApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { AttachedSeriesPrimitive } from '../attachedPrimitive';
import type { RenderTarget } from '../drawTarget';
import { BrokerClock } from './clock';
import { priceTagHeight, priceTagOffset } from '../priceAxisTagsPrimitive';
import { tagLayout } from './tagLayout';
import { barCountdownDefaultOptions, type BarCountdownOptions, type BarCountdownState } from './types';
import { DEFAULT_TIMEFRAME } from '../../../../shared/bridge/timeframes';

/** Corner radius of the library's own labels, on the pane-facing side. */
const TAG_RADIUS = 2;

/**
 * Counts the current bar down on the price axis, under the Bid label.
 *
 * A series primitive whose only view paints on the price-axis canvas. It is
 * drawn here rather than as a library axis label because the library sizes a
 * label to its text and the chart font is proportional, so the tag changed width
 * as the digits changed. The tag sits one whole tag height under the Bid tag,
 * which is placed by `PriceAxisTagsPrimitive` with the same spacing helpers, and
 * its digits are drawn in fixed cells (see `tagLayout`).
 * The primitive owns no DOM node and runs no per-frame loop of its own.
 *
 * The library has no per-second animation hook, so a label only repaints when
 * something invalidates the chart. The countdown therefore drives its own
 * wake-up and calls `requestUpdate` when the broker second turns over, which is
 * the supported way to repaint content whose source is wall-clock time.
 */
export class BarCountdownPrimitive extends AttachedSeriesPrimitive {
  private readonly clock = new BrokerClock();
  private readonly axisViews: readonly IPrimitivePaneView[];
  private options: BarCountdownOptions;
  private readonly state: BarCountdownState = {
    symbol: '',
    timeframe: DEFAULT_TIMEFRAME,
    connected: false,
    suspended: false,
    connectionIdentity: '',
  };
  private pane: IPaneApi<Time> | null = null;
  /** Pane height the label must stay inside, re-read on every chart update. */
  private paneHeight = 0;
  /** Text the last chart update put on the axis; drives the repaint decision. */
  private shownText = '';
  /** Axis coordinate of the tag's centre, captured with `shownText`. */
  private shownY = NaN;
  private timer: number | undefined;
  private dueMs = 0;

  constructor(options: Partial<BarCountdownOptions> = {}) {
    super();
    this.options = { ...barCountdownDefaultOptions, ...options };
    // The view list is stable: the library caches views by array identity. The
    // renderer is null while the tag is hidden, so a hidden tag costs nothing.
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.axisViews = [{ zOrder: () => 'top', renderer: () => (this.shownText === '' ? null : renderer) }];
  }

  /** Mirror the owner's state in and re-arm the wake-up for the next change. */
  update(state: Readonly<BarCountdownState>): void {
    const next = this.state;
    const previousIdentity = next.connectionIdentity;
    next.symbol = state.symbol;
    next.timeframe = state.timeframe;
    next.barTimeSeconds = state.barTimeSeconds;
    next.anchorPrice = state.anchorPrice;
    next.askPrice = state.askPrice;
    next.connected = state.connected;
    next.suspended = state.suspended;
    next.connectionIdentity = state.connectionIdentity;
    next.quote = state.quote;
    // A session starts from cached last ticks, so its first quote must not be
    // trusted as live: drop the clock and let a newer tick re-establish it.
    if (!state.connected || state.connectionIdentity !== previousIdentity) {
      this.clock.clear();
    }
    if (state.quote) {
      this.clock.acceptQuote(state.quote);
    }
    // Quotes arrive far more often than the label changes; compare before
    // asking the chart for a frame.
    if (this.painted() !== this.shownText) {
      this.requestUpdate?.();
    }
    this.schedule();
  }

  applyOptions(options: Partial<BarCountdownOptions>): void {
    this.options = { ...this.options, ...options };
    this.requestUpdate?.();
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    super.attached(params);
    const { chart, series } = params;
    // The pane is only needed for the height the label must stay inside. It is
    // resolved once here and re-read in `updateAllViews`, so nothing walks the
    // pane list on the per-frame or per-tick paths.
    this.pane = chart.panes().find((candidate) => candidate.getSeries().includes(series)) ?? null;
    this.paneHeight = this.pane?.getHeight() ?? 0;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.schedule();
  }

  detached(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stopTimer();
    super.detached();
    this.pane = null;
    this.paneHeight = 0;
    this.shownText = '';
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.axisViews;
  }

  /** Runs on every chart update, before the axis is painted; the draw reads this snapshot. */
  updateAllViews(): void {
    this.paneHeight = this.pane?.getHeight() ?? 0;
    this.shownText = this.painted();
    this.shownY = this.coordinate();
  }

  /** Box and fixed-cell digits, in the axis canvas' own coordinates. */
  private draw(target: RenderTarget): void {
    const text = this.shownText;
    const fontSize = this.labelFontSize();
    const font = `${fontSize}px ${this.labelFontFamily()}`;
    const layout = tagLayout(text, font, fontSize);
    const height = Math.round(priceTagHeight(fontSize));
    const top = Math.round(this.shownY - height / 2);
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.fillStyle = this.options.backColor;
      context.beginPath();
      context.roundRect(0, top, layout.width, height, [0, TAG_RADIUS, TAG_RADIUS, 0]);
      context.fill();
      context.font = font;
      context.fillStyle = this.options.textColor;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const glyph of layout.glyphs) {
        context.fillText(glyph.char, glyph.centerX, top + height / 2);
      }
      context.restore();
    });
  }

  /** Countdown text for the current broker second, ignoring visibility. */
  private tagText(): string {
    const { connected, suspended, symbol, barTimeSeconds, timeframe } = this.state;
    return connected && !suspended ? this.clock.text(symbol, barTimeSeconds, timeframe) : '';
  }

  /** Anchor price to axis coordinate, below which the label is placed. */
  private coordinate(): number {
    const price = this.state.anchorPrice;
    const y = this.series === null || price === undefined ? null : this.series.priceToCoordinate(price);
    if (y === null) {
      return NaN;
    }
    // Sit one whole tag under the Bid tag, wherever the Bid/Ask tags put it:
    // their offset grows outwards when the spread is tighter than a tag, and the
    // countdown has to clear the Bid one in both cases.
    const height = priceTagHeight(this.labelFontSize());
    return y + this.tagsOffset(height) + height;
  }

  /** Same spacing the Bid/Ask tags use, so this tag never lands on the Bid one. */
  private tagsOffset(height: number): number {
    const ask = this.state.askPrice;
    const bid = this.state.anchorPrice;
    if (ask === undefined || bid === undefined || this.series === null) {
      return 0;
    }
    const askY = this.series.priceToCoordinate(ask);
    const bidY = this.series.priceToCoordinate(bid);
    if (askY === null || bidY === null) {
      return 0;
    }
    return priceTagOffset(bidY - askY, height);
  }

  private visible(): boolean {
    const y = this.coordinate();
    return this.tagText() !== '' && Number.isFinite(y) && y >= 0 && y <= this.paneHeight;
  }

  /** Text the axis shows right now: empty while the label is hidden. */
  private painted(): string {
    return this.visible() ? this.tagText() : '';
  }

  /**
   * Arm one wake-up for the moment the label next changes, counted from the
   * broker clock. A repeating interval instead starts at an arbitrary phase and
   * accumulates its own lateness, so the label drifts away from MT5's clock and
   * eventually skips a second.
   */
  private schedule(): void {
    const { connected, suspended, symbol, barTimeSeconds, timeframe } = this.state;
    if (!this.requestUpdate || !connected || suspended || document.hidden) {
      this.stopTimer();
      return;
    }
    const delay = this.clock.nextTickDelayMs(symbol, barTimeSeconds, timeframe);
    if (delay === null) {
      this.stopTimer();
      return;
    }
    const due = performance.now() + delay;
    // Quotes and candle updates arrive far faster than seconds; keep the timer
    // already armed unless the label now changes earlier than it will.
    if (this.timer !== undefined && due >= this.dueMs) {
      return;
    }
    this.stopTimer();
    this.dueMs = due;
    this.timer = window.setTimeout(this.tick, delay);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.dueMs = 0;
  }

  private readonly tick = (): void => {
    this.timer = undefined;
    this.dueMs = 0;
    if (this.painted() !== this.shownText) {
      this.requestUpdate?.();
    }
    this.schedule();
  };

  /** Background tabs throttle timers to seconds or minutes; resync on return. */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.stopTimer();
      return;
    }
    this.tick();
  };
}
