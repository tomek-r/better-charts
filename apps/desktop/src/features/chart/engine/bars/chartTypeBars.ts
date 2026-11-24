import type { Candle } from '../../../../shared/bridge/types';
import type { BarStyleAppearance } from '../barStyle/barStyleAppearance';
import { chartTypeAppearanceOf, type ChartTypeAppearance } from '../barStyle/chartTypeAppearance';
import { olderCandles, onlyNewestChanged, sameCandles, sameChartType, withLiveCandle } from './chartTypeBaseCandles';
import { HistoryViewportMode } from './historyViewportMode';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * How long a burst of live candles waits before it asks for the chart type's bars again. A tick storm costs one
 * request per window, and the request reads the candles the chart holds at that moment, so the newest candle of
 * the burst is always the one drawn.
 */
const LIVE_REQUEST_DELAY_MS = 250;

/** What the app gives the engine for a chart type: the bars it draws from the chart's own candles. */
export interface ChartTypeBarsPort {
  /**
   * The bars `appearance` draws from `candles`, as candles the chart can draw: their times order the bars, and
   * the prices stay the broker's own decimal text.
   */
  transform(candles: readonly Candle[], appearance: ChartTypeAppearance): Promise<readonly Candle[]>;
}

/** Where a replacement of the chart's history puts the pane afterwards. */
export interface ChartTypeReplaceOptions {
  readonly timeframe?: string;
  readonly viewportMode: HistoryViewportMode;
}

/** Where the source writes the bars it got: the chart's own history seams. */
export interface ChartTypeBarSink {
  /** Replaces the chart's whole history, exactly as an accepted snapshot does. */
  replace(candles: readonly Candle[], options: ChartTypeReplaceOptions): void;
  /** Writes the newest bar only, which an answer that moved nothing older needs. */
  writeLastBar(candle: Candle): void;
  /** Reports that no older base candles are left, so the chart stops asking for pages. */
  historyEnded(): void;
}

interface ChartTypeBarSourceOptions {
  /** The app's transform; without one the chart keeps drawing its base candles. */
  readonly port: ChartTypeBarsPort | undefined;
  readonly sink: ChartTypeBarSink;
}

/**
 * The chart's base candles, and the bars a chart type draws from them while one is the bar style.
 *
 * The chart keeps the candles the broker sent, because the command that draws bricks or lines reads them; the
 * bars the chart shows are the answer, and every history seam of the chart (a replaced window, a page of older
 * candles, a live candle) is routed here first. The last request wins: an answer a later request replaced is
 * dropped, and a failed answer leaves the base candles standing rather than a bar nobody drew.
 */
export class ChartTypeBarSource {
  private base: readonly Candle[] = [];
  private timeframe: string | undefined;
  /** The chart type on screen, or null while the chart draws its own candles. */
  private appearance: ChartTypeAppearance | null = null;
  /** The bars the chart holds, which decide whether an answer replaces them or moves the newest one. */
  private drawn: readonly Candle[] = [];
  /** Set by a new window, a page or a style change: the next answer rewrites the whole history. */
  private replacePending = false;
  /** Where the base replacement put the pane, which the answer that replaces it first carries over. */
  private viewportMode: HistoryViewportMode = HistoryViewportMode.BarsFromEnd;
  private requestId = 0;
  private timer: number | undefined;
  private loggedFailure = false;

  constructor(private readonly options: ChartTypeBarSourceOptions) {}

  /** Whether the chart shows a chart type's bars rather than its base candles. */
  get drawsOwnBars(): boolean {
    return this.appearance !== null;
  }

  /** The oldest base candle in the chart's own seconds, which the paging asks its next page before. */
  oldestBarTimeSeconds(): number | undefined {
    const oldest = this.base[0];
    return oldest === undefined ? undefined : Math.floor(oldest.timeMs / MILLISECONDS_PER_SECOND);
  }

  /** The chart's bar style changed; a chart type asks for its bars and a standard style brings the candles back. */
  setAppearance(appearance: BarStyleAppearance): void {
    // Without the app's transform the chart keeps drawing its own candles, whatever style the settings ask for.
    const next = this.options.port === undefined ? null : chartTypeAppearanceOf(appearance);
    if (sameChartType(next, this.appearance)) {
      return;
    }
    const wasChartType = this.appearance !== null;
    this.appearance = next;
    this.cancelTimer();
    // An answer still in flight draws the style that just left.
    this.requestId += 1;
    if (next === null) {
      if (wasChartType) {
        this.showBaseCandles();
      }
      return;
    }
    // The style changed under the bars on screen, so the answer keeps the view where the user left it.
    this.viewportMode = HistoryViewportMode.BarsFromEnd;
    this.replacePending = true;
    this.request();
  }

  /**
   * Keeps a replaced window of base candles and asks for the bars it draws. Answers whether the chart type
   * draws the bars, which leaves the candles to the source instead of the chart.
   */
  replace(candles: readonly Candle[], options: ChartTypeReplaceOptions): boolean {
    this.base = candles;
    this.timeframe = options.timeframe;
    this.viewportMode = options.viewportMode;
    this.drawn = [];
    if (this.appearance === null) {
      return false;
    }
    this.replacePending = true;
    this.request();
    return true;
  }

  /**
   * Keeps a page of older base candles and asks for the bars again, because an older page can add lines or
   * bricks to the front. Answers whether the chart type draws the bars.
   */
  prepend(candles: readonly Candle[], complete: boolean): boolean {
    const older = olderCandles(this.base, candles);
    this.base = older.length === 0 ? this.base : [...older, ...this.base];
    if (this.appearance === null) {
      return false;
    }
    if (older.length === 0 || !complete) {
      this.options.sink.historyEnded();
    }
    if (older.length > 0) {
      this.replacePending = true;
      this.request();
    }
    return true;
  }

  /** Keeps one live base candle and asks for the bars again, once per burst. Answers whether it draws them. */
  update(candle: Candle): boolean {
    const base = withLiveCandle(this.base, candle);
    if (base === this.base) {
      return this.drawsOwnBars;
    }
    this.base = base;
    if (this.appearance === null) {
      return false;
    }
    this.scheduleRequest();
    return true;
  }

  destroy(): void {
    this.cancelTimer();
    this.requestId += 1;
    this.appearance = null;
    this.base = [];
    this.drawn = [];
  }

  /** Asks at once, which a new window, a page or a style change is worth: none of them arrives in a burst. */
  private request(): void {
    this.cancelTimer();
    this.send();
  }

  /** Asks once the burst of live candles is over: a request already scheduled reads the newest candles itself. */
  private scheduleRequest(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.send();
    }, LIVE_REQUEST_DELAY_MS);
  }

  private send(): void {
    const { port } = this.options;
    const appearance = this.appearance;
    if (port === undefined || appearance === null || this.base.length === 0) {
      return;
    }
    this.requestId += 1;
    const id = this.requestId;
    port.transform(this.base, appearance).then(
      (bars) => {
        if (id === this.requestId) {
          this.applyBars(bars);
        }
      },
      (error: unknown) => {
        if (id === this.requestId) {
          this.fail(error);
        }
      },
    );
  }

  /** Draws an answer: the whole history when older bars moved or appeared, the newest bar when only it moved. */
  private applyBars(bars: readonly Candle[]): void {
    this.loggedFailure = false;
    if (!this.replacePending && sameCandles(this.drawn, bars)) {
      return;
    }
    const wholeChart = this.replacePending || !onlyNewestChanged(this.drawn, bars);
    this.replacePending = false;
    this.drawn = bars;
    const newest = bars[bars.length - 1];
    if (wholeChart) {
      this.options.sink.replace(bars, { timeframe: this.timeframe, viewportMode: this.takeViewportMode() });
      return;
    }
    if (newest !== undefined) {
      this.options.sink.writeLastBar(newest);
    }
  }

  /** The mode the next replacement carries, after which the newer ones keep the view. */
  private takeViewportMode(): HistoryViewportMode {
    const mode = this.viewportMode;
    this.viewportMode = HistoryViewportMode.BarsFromEnd;
    return mode;
  }

  /** Puts the base candles back on the chart, which a standard style and a refused answer both ask for. */
  private showBaseCandles(): void {
    this.drawn = [];
    this.replacePending = false;
    if (this.base.length === 0) {
      return;
    }
    const viewportMode = HistoryViewportMode.BarsFromEnd;
    this.options.sink.replace(this.base, { timeframe: this.timeframe, viewportMode });
  }

  /** Leaves the base candles on the chart and reports the failure once per streak, never once per request. */
  private fail(error: unknown): void {
    if (!this.loggedFailure) {
      this.loggedFailure = true;
      console.error('Chart type bars could not be computed:', error);
    }
    this.showBaseCandles();
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
