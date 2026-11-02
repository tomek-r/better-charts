import { LineStyle, type IPriceLine, type ISeriesApi } from 'lightweight-charts';
import type { ChartOverlayState } from '../surface/buildChartPlugins';
import { orderOverlayId } from '../trading/overlayIds';
import { TRADING_COLORS } from '../trading/tradingOverlayDrawing';
import {
  DEFAULT_CHART_SCALES_APPEARANCE,
  drawsBidAskLabels,
  drawsBidAskLines,
  sameBidAskAppearance,
  type BidAskDrawingState,
  type ChartBidAskAppearance,
} from '../surface/chartScalesAppearance';
import type { PriceAxisTagsPrimitive } from './priceAxisTagsPrimitive';
import { isPositiveFinite } from '../../../../shared/finiteNumber';
import { palette } from '../../../../shared/theme/palette';

/** The ids the Bid/Ask pair is drawn under, so the setting can take the two away again. */
const ASK_QUOTE_LINE_ID = 'bid-ask:ask';
const BID_QUOTE_LINE_ID = 'bid-ask:bid';

/**
 * Owns the native Lightweight Charts price lines: the Bid/Ask pair, the staged
 * draft and every position and order bracket. The desired set is rebuilt on each
 * sync and then diffed against the live lines, so a line is created once and
 * afterwards only re-priced.
 *
 * The Bid/Ask lines stay native, but their axis tags come from the price-axis
 * tags primitive: the library's label alignment restacks a pair this close on
 * every tick, because it splits its labels around the series' last price and
 * that price alternates between the two sides of the spread.
 *
 * What is drawn of the pair, and in which colours, is the Bid and ask setting's:
 * the trading overlays keep the palette colours the trading rows give them.
 */
export class PriceLineController {
  private readonly nativePriceLines = new Map<string, IPriceLine>();
  private bidAsk: ChartBidAskAppearance = DEFAULT_CHART_SCALES_APPEARANCE.bidAsk;

  constructor(
    private readonly candles: ISeriesApi<'Candlestick'>,
    private readonly state: ChartOverlayState,
    private readonly priceTags: PriceAxisTagsPrimitive,
  ) {}

  setBidAsk(ask?: number, bid?: number): void {
    this.state.priceLines.ask = ask;
    this.state.priceLines.bid = bid;
    this.syncQuoteTags(ask, bid);
  }

  /** What the Bid and ask setting asks: which of the line and the tag are drawn, and in which colours. */
  setBidAskAppearance(appearance: ChartBidAskAppearance): void {
    if (sameBidAskAppearance(appearance, this.bidAsk)) {
      return;
    }
    this.bidAsk = appearance;
    this.priceTags.applyOptions({ askColor: appearance.ask, bidColor: appearance.bid });
    const { ask, bid } = this.state.priceLines;
    this.syncQuoteTags(ask, bid);
    this.sync();
  }

  /** What is drawn of the quote right now, which the dev test hook reads back. */
  bidAskState(): BidAskDrawingState {
    const { mode, bid, ask } = this.bidAsk;
    return { linesVisible: drawsBidAskLines(mode), labelsVisible: drawsBidAskLabels(mode), bid, ask };
  }

  /** The tags follow the prices only while the setting draws them; hidden, they leave the axis alone. */
  private syncQuoteTags(ask: number | undefined, bid: number | undefined): void {
    if (drawsBidAskLabels(this.bidAsk.mode)) {
      this.priceTags.update({ ask, bid });
      return;
    }
    this.priceTags.update({ ask: undefined, bid: undefined });
  }

  sync(): void {
    const desired = new Map<string, { price: number; color: string; label: boolean }>();
    const add = (id: string, price: number | undefined | null, color: string, label = true) => {
      if (isPositiveFinite(price)) {
        desired.set(id, { price, color, label });
      }
    };
    /** A quote line carries no axis tag of its own: the tags primitive paints those. */
    const addQuoteLine = (id: string, price: number | undefined, color: string): void => {
      add(id, price, color, false);
    };
    const { priceLines, staged, positions } = this.state;
    if (drawsBidAskLines(this.bidAsk.mode)) {
      addQuoteLine(ASK_QUOTE_LINE_ID, priceLines.ask, this.bidAsk.ask);
      addQuoteLine(BID_QUOTE_LINE_ID, priceLines.bid, this.bidAsk.bid);
    }

    const draft = staged.order;
    if (draft) {
      if (Number.isFinite(draft.entry)) {
        add('staged:entry', draft.entry, draft.side === 'buy' ? TRADING_COLORS.buy : TRADING_COLORS.sell);
      }
      add('staged:sl', draft.stopLoss, TRADING_COLORS.sl);
      add('staged:tp', draft.takeProfit, TRADING_COLORS.tp);
    }
    const drag = positions.drag;
    for (const position of positions.positions) {
      add(
        `position:${position.id}:entry`,
        position.entry,
        position.side === 'buy' ? TRADING_COLORS.buy : TRADING_COLORS.sell,
      );
      add(
        `position:${position.id}:sl`,
        drag?.kind === 'sl' && drag.id === position.id ? drag.price : position.stopLoss,
        TRADING_COLORS.sl,
      );
      add(
        `position:${position.id}:tp`,
        drag?.kind === 'tp' && drag.id === position.id ? drag.price : position.takeProfit,
        TRADING_COLORS.tp,
      );
    }
    for (const order of positions.orders) {
      const orderId = orderOverlayId(order.id);
      const orderDrag = drag?.kind === 'order' && drag.id === order.id ? drag : undefined;
      add(
        `${orderId}:entry`,
        drag?.kind === 'order' && drag.id === order.id ? drag.price : order.price,
        order.side === 'buy' ? TRADING_COLORS.buy : TRADING_COLORS.sell,
      );
      let stopLoss = order.stopLoss;
      if (orderDrag?.exitPreview) {
        stopLoss = orderDrag.stopLoss;
      }
      if (drag?.kind === 'sl' && drag.id === orderId) {
        stopLoss = drag.price;
      }
      add(`${orderId}:sl`, stopLoss, TRADING_COLORS.sl);
      let takeProfit = order.takeProfit;
      if (orderDrag?.exitPreview) {
        takeProfit = orderDrag.takeProfit;
      }
      if (drag?.kind === 'tp' && drag.id === orderId) {
        takeProfit = drag.price;
      }
      add(`${orderId}:tp`, takeProfit, TRADING_COLORS.tp);
    }

    for (const [id, line] of this.nativePriceLines) {
      if (desired.has(id)) {
        continue;
      }
      this.candles.removePriceLine(line);
      this.nativePriceLines.delete(id);
    }
    for (const [id, { price, color, label }] of desired) {
      const existing = this.nativePriceLines.get(id);
      if (existing) {
        const options = existing.options();
        if (
          options.price !== price ||
          options.color !== color ||
          options.axisLabelColor !== color ||
          options.axisLabelVisible !== label
        ) {
          existing.applyOptions({
            price,
            color,
            axisLabelColor: color,
            axisLabelTextColor: palette.text,
            axisLabelVisible: label,
          });
        }
      } else {
        this.nativePriceLines.set(
          id,
          this.candles.createPriceLine({
            id,
            price,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            lineVisible: true,
            axisLabelVisible: label,
            axisLabelColor: color,
            axisLabelTextColor: palette.text,
            title: '',
          }),
        );
      }
    }
  }
}
