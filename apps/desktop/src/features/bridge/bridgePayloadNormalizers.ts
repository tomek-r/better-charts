import { toRenderBar } from '../chart/engine/bars/mt5DataAdapter';
import type {
  AccountSnapshot,
  BarUpdate,
  Candle,
  HistoryPage,
  MarketSnapshot,
  OpenPosition,
  PendingOrder,
  PortfolioSnapshot,
  QuoteSnapshot,
} from '../../shared/bridge/types';

export type RawCandle = Partial<Candle> & { time_ms?: number; tick_volume?: number; real_volume?: number };

export function normalizeCandle(raw: RawCandle): Candle {
  return {
    timeMs: Number(raw.timeMs ?? raw.time_ms ?? 0),
    open: String(raw.open ?? ''),
    high: String(raw.high ?? ''),
    low: String(raw.low ?? ''),
    close: String(raw.close ?? ''),
    tickVolume: Number(raw.tickVolume ?? raw.tick_volume ?? 0),
    spread: Number(raw.spread ?? 0),
    realVolume: Number(raw.realVolume ?? raw.real_volume ?? 0),
  };
}
export function normalizeSnapshot(raw: MarketSnapshot & { candles?: RawCandle[] }): MarketSnapshot {
  return {
    symbol: raw.symbol,
    timeframe: raw.timeframe,
    complete: Boolean(raw.complete),
    candles: (raw.candles ?? []).map(normalizeCandle),
  };
}

export function normalizeHistoryPage(
  raw: Partial<HistoryPage> & { candles?: RawCandle[]; before_ms?: number },
): HistoryPage {
  return {
    symbol: String(raw.symbol ?? ''),
    timeframe: String(raw.timeframe ?? ''),
    complete: Boolean(raw.complete),
    beforeMs: Number(raw.beforeMs ?? raw.before_ms ?? 0),
    candles: (raw.candles ?? []).map(normalizeCandle),
  };
}
// Reject malformed rendering data before it reaches the chart or realtime state.
export function isValidCandle(candle: Candle) {
  return toRenderBar(candle) !== null;
}

export function validCandlesOf(candles: Candle[]): Candle[] {
  return candles.filter(isValidCandle);
}

/**
 * A live update is either a full `BarUpdate` naming its series or a bare candle
 * of the series on screen; a bare candle takes the selection that is current now.
 */
export function normalizeBarUpdate(
  payload: BarUpdate | Candle,
  current: { symbol: string | undefined; timeframe: string | undefined },
) {
  return {
    candle: normalizeCandle('candle' in payload ? payload.candle : payload),
    symbol: 'symbol' in payload ? payload.symbol : current.symbol,
    timeframe: 'timeframe' in payload ? payload.timeframe : current.timeframe,
  };
}

export type RawQuote = Partial<QuoteSnapshot> & { time_ms?: number; volume_real?: string | number };
export function normalizeQuote(raw: RawQuote): QuoteSnapshot {
  return {
    symbol: String(raw.symbol ?? ''),
    timeMs: Number(raw.timeMs ?? raw.time_ms ?? 0),
    bid: String(raw.bid ?? ''),
    ask: String(raw.ask ?? ''),
    last: String(raw.last ?? ''),
    volume: Number(raw.volume ?? 0),
    volumeReal: String(raw.volumeReal ?? raw.volume_real ?? ''),
    flags: Number(raw.flags ?? 0),
  };
}

export type RawAccount = Partial<AccountSnapshot> & {
  account_login?: string;
  currency_digits?: number;
  broker_server?: string;
  free_margin?: string;
  margin_level?: string;
  margin_mode?: number;
  trade_allowed?: boolean;
  expert_allowed?: boolean;
  account_trade_mode?: number;
  account_trade_mode_name?: string;
  margin_call_level?: string | null;
  stop_out_level?: string | null;
  margin_levels_mode?: number | null;
  margin_levels_unit?: string;
  account_company?: string | null;
};
export function normalizeAccount(raw: RawAccount): AccountSnapshot {
  return {
    accountLogin: String(raw.accountLogin ?? raw.account_login ?? ''),
    brokerServer: String(raw.brokerServer ?? raw.broker_server ?? ''),
    currency: String(raw.currency ?? ''),
    currencyDigits: raw.currencyDigits ?? raw.currency_digits ?? 2,
    balance: String(raw.balance ?? ''),
    equity: String(raw.equity ?? ''),
    margin: String(raw.margin ?? ''),
    freeMargin: String(raw.freeMargin ?? raw.free_margin ?? ''),
    marginLevel: String(raw.marginLevel ?? raw.margin_level ?? ''),
    leverage: Number(raw.leverage ?? 0),
    marginMode: Number(raw.marginMode ?? raw.margin_mode ?? -1),
    tradeAllowed: Boolean(raw.tradeAllowed ?? raw.trade_allowed),
    expertAllowed: Boolean(raw.expertAllowed ?? raw.expert_allowed),
    accountTradeMode: raw.accountTradeMode ?? raw.account_trade_mode,
    accountTradeModeName: raw.accountTradeModeName ?? raw.account_trade_mode_name,
    // Absent and null both mean "not reported"; never coerced to 0.
    marginCallLevel: raw.marginCallLevel ?? raw.margin_call_level ?? null,
    stopOutLevel: raw.stopOutLevel ?? raw.stop_out_level ?? null,
    marginLevelsMode: raw.marginLevelsMode ?? raw.margin_levels_mode ?? null,
    marginLevelsUnit: raw.marginLevelsUnit ?? raw.margin_levels_unit ?? 'unknown',
    accountCompany: raw.accountCompany ?? raw.account_company ?? null,
  };
}

type RawPosition = Partial<OpenPosition> & { volume_min?: string | null; volume_step?: string | null };
function normalizePosition(raw: RawPosition): OpenPosition {
  return {
    ticket: String(raw.ticket ?? ''),
    positionId: String(raw.positionId ?? ''),
    symbol: String(raw.symbol ?? ''),
    timeMs: Number(raw.timeMs ?? 0),
    magic: String(raw.magic ?? ''),
    side: String(raw.side ?? ''),
    volume: String(raw.volume ?? ''),
    priceOpen: String(raw.priceOpen ?? ''),
    priceCurrent: String(raw.priceCurrent ?? ''),
    profit: String(raw.profit ?? ''),
    swap: String(raw.swap ?? ''),
    stopLoss: raw.stopLoss,
    takeProfit: raw.takeProfit,
    volumeMin: raw.volumeMin ?? raw.volume_min,
    volumeStep: raw.volumeStep ?? raw.volume_step,
  };
}
function normalizeOrder(raw: Partial<PendingOrder>): PendingOrder {
  return {
    orderId: String(raw.orderId ?? ''),
    symbol: String(raw.symbol ?? ''),
    timeSetupMs: Number(raw.timeSetupMs ?? 0),
    expirationMs: raw.expirationMs,
    magic: String(raw.magic ?? ''),
    orderType: String(raw.orderType ?? ''),
    state: String(raw.state ?? ''),
    volumeInitial: String(raw.volumeInitial ?? ''),
    volumeCurrent: String(raw.volumeCurrent ?? ''),
    priceOpen: String(raw.priceOpen ?? ''),
    priceCurrent: String(raw.priceCurrent ?? ''),
    stopLoss: raw.stopLoss,
    takeProfit: raw.takeProfit,
  };
}
export function normalizePortfolio(raw: PortfolioSnapshot): PortfolioSnapshot {
  return {
    accountLogin: String(raw.accountLogin ?? ''),
    capturedAtMs: Number(raw.capturedAtMs ?? 0),
    positions: (raw.positions ?? []).map(normalizePosition),
    orders: (raw.orders ?? []).map(normalizeOrder),
  };
}
