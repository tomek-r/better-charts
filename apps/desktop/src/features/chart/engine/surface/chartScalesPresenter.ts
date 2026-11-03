import type { CountdownController } from '../barCountdown/countdownController';
import type { ChartTimeZoneDisplay } from '../brokerTime/chartTimeZoneDisplay';
import type { PriceScaleController, PriceScaleState } from '../priceScale/priceScaleController';
import type { PriceAxisTagsPrimitive } from '../quotes/priceAxisTagsPrimitive';
import type { PriceLineController } from '../quotes/priceLineController';
import {
  drawsLogarithmicPrices,
  priceScaleModeOf,
  type ChartScalesAppearance,
  type ChartScalesState,
} from './chartScalesAppearance';

/** The collaborators that draw one part each of the chart's scales and lines. */
interface ScalesTargets {
  /** The A/L row of toggles and the native price scale they act on. */
  readonly priceScale: PriceScaleController;
  readonly countdown: Pick<CountdownController, 'setShown' | 'shown' | 'sync'>;
  readonly quotes: Pick<PriceLineController, 'setBidAskAppearance' | 'bidAskState' | 'sync'>;
  /** The price-axis tags: the Bid/Ask labels and the chart's symbol name. */
  readonly tags: Pick<PriceAxisTagsPrimitive, 'applyOptions' | 'symbolNameLabel' | 'setSymbol' | 'releaseAxisWidth'>;
  readonly timeLabels: Pick<ChartTimeZoneDisplay, 'setLabels' | 'labels'>;
  /** Whether the chart is gone: a disposed chart takes no write to its price scale. */
  readonly isDisposed: () => boolean;
}

/**
 * Owns what the chart's price axis shows, which is the Scales tab's set: the price scale's shape and
 * its A/L row, whether the countdown tag is drawn and what it mirrors, the Bid/Ask drawing, the
 * symbol tag, and how the axis, the pointer and the footer write time.
 *
 * One setting reaches several owners — the native scale, the axis primitives and the DOM row — and
 * reading it back crosses the same owners, so the fan-out lives here rather than in ChartController,
 * which only passes each setting through.
 */
export class ChartScalesPresenter {
  constructor(private readonly targets: ScalesTargets) {}

  /** Writes each part of `appearance` to the collaborator that draws it. */
  applyAppearance(appearance: ChartScalesAppearance): void {
    const { priceScale, countdown, quotes, tags, timeLabels } = this.targets;
    priceScale.setScaleModeButtons(appearance.scaleModeButtons);
    priceScale.setScaleShape({
      invertScale: appearance.invertScale,
      logarithmic: drawsLogarithmicPrices(appearance.priceScaleMode),
    });
    countdown.setShown(appearance.countdown);
    quotes.setBidAskAppearance(appearance.bidAsk);
    tags.applyOptions({ symbolNameLabel: appearance.symbolNameLabel });
    timeLabels.setLabels(appearance.timeLabels);
  }

  /** What the chart draws of its scales and lines, read back from the collaborator that owns each part. */
  drawnState(): ChartScalesState {
    const { priceScale, countdown, quotes, tags, timeLabels } = this.targets;
    const shape = priceScale.scaleShape();
    return {
      scaleModeButtons: priceScale.scaleModeButtons(),
      countdownVisible: countdown.shown(),
      bidAsk: quotes.bidAskState(),
      timeLabels: timeLabels.labels(),
      invertScale: shape.invertScale,
      priceScaleMode: priceScaleModeOf(shape.logarithmic),
      symbolNameLabelVisible: tags.symbolNameLabel(),
    };
  }

  /** The price scale as it is drawn now: whether it fits the data itself, its spacing and its direction. */
  priceScaleState(): PriceScaleState {
    return this.targets.priceScale.scaleShape();
  }

  /** Fits the price scale to the data it shows, or stops it doing so. */
  setAutoScale(on: boolean): void {
    if (this.targets.isDisposed()) {
      return;
    }
    this.targets.priceScale.setAutoScale(on);
  }

  /**
   * Another instrument formats its prices differently: the axis sizes itself for its own prices
   * instead of carrying the widest label of the previous one, and its symbol tag follows at once.
   */
  changeSymbolTag(symbol: string): void {
    this.targets.tags.releaseAxisWidth();
    this.targets.tags.setSymbol(symbol);
  }

  /** Puts the axis back in step with what it draws from: the price lines and the settings gear. */
  resyncAxis(): void {
    this.targets.quotes.sync();
    this.targets.priceScale.syncSettingsButton();
  }

  /**
   * The countdown primitive owns the broker-second alignment and the axis label; ChartController owns
   * the broker time, and CountdownController mirrors the controller's single copy of each input into
   * the primitive, so every input has one owner. Call this whenever one of those inputs changes:
   * quotes, bars, timeframe, Bid, symbol or connection.
   */
  syncCountdown(): void {
    this.targets.countdown.sync();
  }
}
