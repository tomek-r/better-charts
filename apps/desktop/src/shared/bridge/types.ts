export type BridgeState = 'disconnected' | 'connecting' | 'connected' | 'protocol_error';

/** Latest EA observation of the active symbol's broker trade session. */
export interface MarketSessionStatus {
  symbol: string;
  isOpen: boolean;
  /** Raw `ENUM_SYMBOL_TRADE_MODE` (`SYMBOL_TRADE_MODE_DISABLED = 0`). */
  tradeMode: number;
  /** Broker server time at which `isOpen` was evaluated (Unix milliseconds). */
  serverTimeMs: number;
}

export interface BridgeStatus {
  state: BridgeState;
  protocolVersion?: string;
  terminal?: string;
  account?: string;
  server?: string;
  lastHeartbeat?: string | number;
  message?: string;
  /** Absent until the first heartbeat carrying an observation (fail closed). */
  marketSession?: MarketSessionStatus;
  /** Periods advertised by the connected EA. */
  supportedTimeframes?: string[];
}

export interface ExecutionSafetyStatus {
  journalState: 'ready' | 'error';
  commandCount: number;
  dispatchEnabled: boolean;
  message: string;
}

export type ReconciliationState = 'pending' | 'complete' | 'incomplete' | 'error' | 'unavailable';

export interface ReconciliationStatus {
  state: ReconciliationState;
  requestId: string | null;
  snapshotId: string | null;
  accountLogin: string | null;
  brokerServer: string | null;
  capturedAtMs: number | null;
  historyFromMs: number | null;
  historyToMs: number | null;
  sequenceBefore: number | null;
  sequenceAfter: number | null;
  positionCount: number;
  activeOrderCount: number;
  historyOrderCount: number;
  historyDealCount: number;
  message: string | null;
}

export type RecoveryStatus =
  'recovery_required' | 'validated_local' | 'broker_accepted' | 'partially_filled' | 'filled' | 'rejected';

export interface RecoveryEntry {
  commandId: string;
  accountLogin: string;
  brokerServer: string;
  state: string;
  recoveryStatus: RecoveryStatus;
  operation: {
    kind: 'place_order';
    symbol: string;
    side: RiskSide;
    orderKind: OrderKind;
    volume: string;
    entry: string;
    stopLoss: string;
    takeProfit?: string | null;
  };
  updatedAtMs: number;
  brokerOrderId?: string;
  dealId?: string;
  positionId?: string;
  retcode?: number;
}

export interface ExecutionRecoverySnapshot {
  safety: ExecutionSafetyStatus;
  entries: RecoveryEntry[];
}

/** §11: camelCase payload of the `execution-command-update` Tauri event. */
export interface CommandUpdate {
  commandId: string;
  status: string;
  retcode?: number | null;
  brokerOrderId?: string | null;
  dealId?: string | null;
  positionId?: string | null;
  filledVolume?: string | null;
  message?: string | null;
  updatedAtMs: number;
  atUpdate: number;
}

/** §11: camelCase payload of the `execution-command-error` Tauri event. */
export interface CommandError {
  commandId: string;
  code: string;
  message: string;
}

/** §11: camelCase view returned by the `get_execution_queue_status` command. */
export interface ExecutionQueueView {
  pending: number;
  inFlight: string | null;
  dispatchEnabled: boolean;
}

export interface Candle {
  timeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  tickVolume: number;
  spread: number;
  realVolume: number;
}

export interface MarketSnapshot {
  symbol?: string;
  timeframe?: string;
  complete: boolean;
  candles: Candle[];
}

/**
 * One page of older candles, answered by `request_history_page` and published on
 * the `history-page` event. Kept apart from {@link MarketSnapshot} so a page of
 * old bars can never replace the live market snapshot.
 */
export interface HistoryPage {
  symbol: string;
  timeframe: string;
  /** False when the broker had fewer candles left than the page asked for. */
  complete: boolean;
  /** Echo of the anchor the page was requested from. */
  beforeMs: number;
  candles: Candle[];
}

export interface BarUpdate {
  symbol: string;
  timeframe: string;
  candle: Candle;
}

export interface TickProfileBin {
  low: string;
  high: string;
  /** Decimal-string weights (§8): total = 1 per valid tick, bid/ask = per-side flags. */
  total: string;
  bid: string;
  ask: string;
}

export interface ProfileLevels {
  poc: string;
  vah: string;
  val: string;
}

export interface ProfileResult {
  symbol: string;
  fromMs: number;
  endMs: number;
  complete: boolean;
  rejectedTicks: number;
  actualRows: number;
  totalWeight: number;
  /** POC/VAH/VAL of the TOTAL profile. */
  poc: string;
  vah: string;
  val: string;
  /** Per-mode levels; null = empty mode. */
  bidLevels: ProfileLevels | null;
  askLevels: ProfileLevels | null;
  bins: TickProfileBin[];
}

export interface ProfileProgress {
  symbol: string;
  fromMs: number;
  endMs: number;
  completedPages: number;
  pendingPages: number;
  loadedTicks: number;
}

export interface ProfileCancelled {
  symbol: string;
  fromMs: number;
  endMs: number;
}

export interface ProfileError {
  symbol: string;
  fromMs: number;
  endMs: number;
  message: string;
}

export interface BrokerSymbol {
  symbol: string;
  description: string;
  digits: number;
  tickSize: string;
  pointSize: string;
  contractSize: string;
  volumeMin: string;
  volumeMax: string;
  volumeStep: string;
  stopsLevel: number;
  freezeLevel: number;
  fillingMode: number;
  orderMode: number;
  expirationMode: number;
  tradeExecution: number;
  tradeMode: number;
}

export interface SymbolSearchResult {
  source: 'live' | 'cached';
  query: string;
  symbols: BrokerSymbol[];
}

export interface QuoteSnapshot {
  symbol: string;
  timeMs: number;
  bid: string;
  ask: string;
  last: string;
  volume: number;
  volumeReal: string;
  flags: number;
}

export interface AccountSnapshot {
  accountLogin: string;
  brokerServer: string;
  currency: string;
  balance: string;
  equity: string;
  margin: string;
  freeMargin: string;
  marginLevel: string;
  leverage: number;
  marginMode: number;
  tradeAllowed: boolean;
  expertAllowed: boolean;
  /** Raw ACCOUNT_TRADE_MODE enum (0 demo / 1 contest / 2 real); optional for older backends. */
  accountTradeMode?: number;
  /** "demo" | "contest" | "real" | "unknown"; optional for older backends. */
  accountTradeModeName?: string;
}

export type RiskSide = '' | 'buy' | 'sell';

export interface RiskPreview {
  symbol: string;
  side: RiskSide;
  draftVersion: number;
  entry: string;
  stopLoss: string;
  takeProfit?: string | null;
  riskBudget: string;
  volume: string;
  estimatedRisk: string;
  estimatedReward?: string | null;
  estimatedMargin: string;
  rr?: string | null;
  currency: string;
  quotedAtMs: number;
}

export type OrderKind = 'market' | 'limit' | 'stop' | 'stop_limit';

/** Order time-in-force; absent on the wire = gtc (today's behavior). */
export type TimeInForce = 'gtc' | 'day' | 'ioc' | 'fok';

export interface OrderCheckResult {
  draftVersion: number;
  draftId: string;
  accountLogin: string;
  brokerServer: string;
  symbol: string;
  side: RiskSide;
  orderKind: OrderKind;
  volume: string;
  requestedEntry: string;
  checkPrice: string;
  stopLoss: string | null;
  takeProfit: string | null;
  /** Wire echoes (camelCase); optional so older/stub results stay valid. */
  timeInForce?: string | null;
  limitPrice?: string | null;
  checkPassed: boolean;
  retcode: number;
  lastError: number;
  balance: string;
  equity: string;
  profit: string;
  margin: string;
  freeMargin: string;
  marginLevel: string;
  comment: string;
  checkedAtMs: number;
}

export interface OrderCheckError {
  draftVersion: number;
  draftId: string;
  code: string;
  message: string;
}

export interface RiskPreviewError {
  draftVersion: number;
  message: string;
}

export interface OpenPosition {
  ticket: string;
  positionId: string;
  symbol: string;
  timeMs: number;
  magic: string;
  side: string;
  volume: string;
  priceOpen: string;
  priceCurrent: string;
  profit: string;
  swap: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
}

export interface PendingOrder {
  orderId: string;
  symbol: string;
  timeSetupMs: number;
  expirationMs?: number | null;
  magic: string;
  orderType: string;
  state: string;
  volumeInitial: string;
  volumeCurrent: string;
  priceOpen: string;
  priceCurrent: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
}

export interface PortfolioSnapshot {
  accountLogin: string;
  capturedAtMs: number;
  positions: OpenPosition[];
  orders: PendingOrder[];
}

export type PendingModificationKind = 'positionModify' | 'positionClose' | 'orderCancel' | 'orderModify';

/** Local draft captured from a chart drag intent. Position SL/TP drags and
 * pending Limit/Stop Limit price drags dispatch immediately while the owner's
 * dispatch gate is enabled (`sent` marks the accepted modify; the draft stays
 * so the overlay keeps staging the new level). Other drags remain chart-side. */
export interface PendingModification {
  kind: PendingModificationKind;
  summary: string;
  /** Position/order id the draft acts on (the chart drag payload target). */
  targetId?: string;
  stopLoss?: string;
  takeProfit?: string;
  /** New pending-order price for an `orderModify` draft. */
  price?: string;
  /** True once an auto-dispatched `positionModify` drag was accepted (accepted = journaled/queued — the command may still be pending or broker-rejected; execution updates are the source of truth). */
  sent?: boolean;
  /** True when a draft action was dropped (single-flight) or rejected — nothing reached MT5; the draft must read NOT SENT with retry copy. */
  sendFailed?: boolean;
}

export interface MT5BridgeSettings {
  token: string;
  address: string;
  maxFrameBytes: number;
  tradingEnabled: boolean;
  autoStartMt5: boolean;
  terminalPath: string;
  winePrefix: string;
  wineBinary: string;
  configPath: string;
}
