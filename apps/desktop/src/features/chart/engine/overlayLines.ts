import { formatSignedMoney, normalizedPrice } from '../../../shared/format';
import type { OpenPosition, PendingOrder, PortfolioSnapshot, RiskSide } from '../../../shared/bridge/types';
import type { OrderLine, PositionLine, PositionOverlayState } from './positionOverlay';

/** `buy_limit`, `sell_stop_limit`, … — compiled once, not per order line. */
const ORDER_TYPE = /^(buy|sell)_(limit|stop|stop_limit)$/;

function chartPrice(value?: string | null) {
  const normalized = normalizedPrice(value);
  if (normalized === null) {
    return undefined;
  }
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

/** Signed money at a price level (account currency) — the SAME estimate basis
 *  as the ticket's levelMoney ("SL -$50"): (level − entry) × side × contractSize
 *  × volume. Mirrored for positions so their overlay rows match the preview. */
export function levelMoneyText(
  entry: number,
  level: number,
  volume: number,
  side: RiskSide,
  money: { contractSize: number; currency: string },
): string | undefined {
  const contract = money.contractSize;
  if (!Number.isFinite(contract) || contract <= 0) {
    return undefined;
  }
  const direction = side === 'buy' ? 1 : -1;
  const value = (level - entry) * direction * contract * volume;
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return formatSignedMoney(value, money.currency);
}
/** Signed money P&L in the ACCOUNT currency, the levelMoneyText format
 *  ("-$6.63" / "+$1.04") so the P&L box reads exactly like SL/TP money. */
export function pnlMoneyText(profit: string | undefined, currency: string | undefined): string | undefined {
  if (profit === undefined || profit.trim() === '' || !currency) {
    return undefined;
  }
  const value = Number(profit);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const absolute = Math.abs(value);
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(absolute);
  } catch {
    formatted = `${absolute.toFixed(2)} ${currency}`;
  }
  return `${value >= 0 ? '+' : '-'}${formatted}`;
}
export function toPositionLine(
  item: OpenPosition,
  money?: { contractSize: number; currency: string },
  accountCurrency = money?.currency,
): PositionLine | null {
  if (item.side !== 'buy' && item.side !== 'sell') {
    return null;
  }
  const side = item.side;
  const entry = Number(item.priceOpen);
  const quantity = Number(item.volume);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const level = (raw?: string | null) => {
    const price = chartPrice(raw);
    return price !== undefined && money ? levelMoneyText(entry, price, quantity, side, money) : undefined;
  };
  return {
    id: item.positionId || item.ticket,
    side,
    volume: String(quantity),
    entry,
    stopLoss: chartPrice(item.stopLoss),
    takeProfit: chartPrice(item.takeProfit),
    pnl: pnlMoneyText(item.profit, accountCurrency),
    slMoney: level(item.stopLoss),
    tpMoney: level(item.takeProfit),
  };
}
export function toOrderLine(item: PendingOrder, money?: { contractSize: number; currency: string }): OrderLine | null {
  const match = ORDER_TYPE.exec(item.orderType);
  const price = Number(item.priceOpen);
  if (!match || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const quantity = item.volumeCurrent || item.volumeInitial;
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
    return null;
  }
  const side = match[1] as PositionLine['side'];
  const volume = Number(quantity);
  let type: string;
  if (match[2] === 'limit') {
    type = 'LIMIT';
  } else if (match[2] === 'stop') {
    type = 'STOP';
  } else {
    type = 'STOP LIMIT';
  }
  const level = (raw?: string | null) => {
    const levelPrice = chartPrice(raw);
    return levelPrice !== undefined && money ? levelMoneyText(price, levelPrice, volume, side, money) : undefined;
  };
  return {
    id: item.orderId,
    side,
    price,
    quantity: String(volume),
    label: type,
    stopLoss: chartPrice(item.stopLoss),
    takeProfit: chartPrice(item.takeProfit),
    slMoney: level(item.stopLoss),
    tpMoney: level(item.takeProfit),
  };
}
// §13 source of truth: replace-style re-sync into OUR overlay (features/chart/engine/positionOverlay.ts). The library's built-in trading overlay is deliberately NEVER fed — chart.setPositions()/setOrders() stay empty, so it paints nothing and its drag hit-testing falls through to pan. Returns true when the painted content changed (or a drag preview was dropped) so the caller can repaint.
export function syncPositionOverlay(
  state: PositionOverlayState,
  portfolio: PortfolioSnapshot | undefined,
  symbol: string | undefined,
  digits: number,
  money?: { contractSize: number; currency: string },
  accountCurrency = money?.currency,
): boolean {
  const positions =
    !portfolio || !symbol
      ? []
      : portfolio.positions
          .filter((item) => item.symbol === symbol)
          .map((item) => toPositionLine(item, money, accountCurrency))
          .filter((item): item is PositionLine => item !== null);
  const orders =
    !portfolio || !symbol
      ? []
      : portfolio.orders
          .filter((item) => item.symbol === symbol)
          .map((item) => toOrderLine(item, money))
          .filter((item): item is OrderLine => item !== null);
  const changed =
    state.digits !== digits ||
    state.drag !== null ||
    state.positions.length !== positions.length ||
    state.orders.length !== orders.length ||
    JSON.stringify(state.positions) !== JSON.stringify(positions) ||
    JSON.stringify(state.orders) !== JSON.stringify(orders);
  state.positions = positions;
  state.orders = orders;
  state.digits = digits;
  state.money = money;
  // Drag preview policy: it SURVIVES syncs (the old snap-back to the snapshot
  // mid-drag was the SL/TP flicker) and settles INVISIBLY the moment the
  // synced level equals the dragged price (the modify payload rounded to the
  // instrument digits). A rejected modify drops it via runCloseCancel.
  const drag = state.drag;
  if (drag) {
    let level: number | undefined;
    if (drag.kind === 'order') {
      level = orders.find((item) => item.id === drag.id)?.price;
    } else {
      const position = positions.find((item) => item.id === drag.id);
      const order = orders.find((item) => `order:${item.id}` === drag.id);
      level =
        drag.kind === 'sl' ? (position?.stopLoss ?? order?.stopLoss) : (position?.takeProfit ?? order?.takeProfit);
    }
    if (level !== undefined && level === Number(drag.price.toFixed(digits))) {
      state.drag = null;
    }
  }
  return changed;
}
