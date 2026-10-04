import { LineStyle, type IPriceLine, type ISeriesApi } from 'lightweight-charts';
import type { ChartOverlayState } from './overlays';
import { STAGED_COLORS } from './stagedOrderOverlay';
import type { PriceAxisTagsPrimitive } from './priceAxisTagsPrimitive';
import { palette } from '../../../shared/theme/palette';

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
 */
export class PriceLineController {
  private readonly nativePriceLines = new Map<string, IPriceLine>();

  constructor(
    private readonly candles: ISeriesApi<'Candlestick'>,
    private readonly state: ChartOverlayState,
    private readonly priceTags: PriceAxisTagsPrimitive,
  ) {}

  setBidAsk(ask?: number, bid?: number): void {
    this.state.priceLines.ask = ask;
    this.state.priceLines.bid = bid;
    this.priceTags.update({ ask, bid });
  }

  sync(): void {
    const desired = new Map<string, { price: number; color: string; label: boolean }>();
    const add = (id: string, price: number | undefined | null, color: string, label = true) => {
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        desired.set(id, { price, color, label });
      }
    };
    const { priceLines, staged, positions } = this.state;
    add('bid-ask:ask', priceLines.ask, STAGED_COLORS.buy, false);
    add('bid-ask:bid', priceLines.bid, STAGED_COLORS.sell, false);

    const draft = staged.order;
    if (draft) {
      if (Number.isFinite(draft.entry)) {
        add('staged:entry', draft.entry, draft.side === 'buy' ? STAGED_COLORS.buy : STAGED_COLORS.sell);
      }
      add('staged:sl', draft.stopLoss, STAGED_COLORS.sl);
      add('staged:tp', draft.takeProfit, STAGED_COLORS.tp);
    }
    const drag = positions.drag;
    for (const position of positions.positions) {
      add(
        `position:${position.id}:entry`,
        position.entry,
        position.side === 'buy' ? STAGED_COLORS.buy : STAGED_COLORS.sell,
      );
      add(
        `position:${position.id}:sl`,
        drag?.kind === 'sl' && drag.id === position.id ? drag.price : position.stopLoss,
        STAGED_COLORS.sl,
      );
      add(
        `position:${position.id}:tp`,
        drag?.kind === 'tp' && drag.id === position.id ? drag.price : position.takeProfit,
        STAGED_COLORS.tp,
      );
    }
    for (const order of positions.orders) {
      const orderId = `order:${order.id}`;
      const orderDrag = drag?.kind === 'order' && drag.id === order.id ? drag : undefined;
      add(
        `${orderId}:entry`,
        drag?.kind === 'order' && drag.id === order.id ? drag.price : order.price,
        order.side === 'buy' ? STAGED_COLORS.buy : STAGED_COLORS.sell,
      );
      let stopLoss = order.stopLoss;
      if (orderDrag?.exitPreview) {
        stopLoss = orderDrag.stopLoss;
      }
      if (drag?.kind === 'sl' && drag.id === orderId) {
        stopLoss = drag.price;
      }
      add(`${orderId}:sl`, stopLoss, STAGED_COLORS.sl);
      let takeProfit = order.takeProfit;
      if (orderDrag?.exitPreview) {
        takeProfit = orderDrag.takeProfit;
      }
      if (drag?.kind === 'tp' && drag.id === orderId) {
        takeProfit = drag.price;
      }
      add(`${orderId}:tp`, takeProfit, STAGED_COLORS.tp);
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
            id: `mt5-${id}`,
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
