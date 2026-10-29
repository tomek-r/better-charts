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
  /** Broker UTC offset in minutes from the latest heartbeat; absent or null = unknown (display only). */
  brokerUtcOffsetMinutes?: number | null;
  /** Periods advertised by the connected EA. */
  supportedTimeframes?: string[];
  /** Negotiated `partial_close` capability; absent or false = partial close is never offered. */
  partialClose?: boolean;
  /** Algo-trading permission the EA advertised for this session (display only); absent or false = disabled in MT5. */
  tradingEnabled?: boolean;
  /**
   * True only when the connection was refused because the installed EA or tick reader is not the version the app
   * requires, so reinstalling the bundled files fixes it. Absent or false for every other error.
   */
  componentOutdated?: boolean;
  /** The EA presented a token other than the one in App settings; installing through the guide hands it the current one. */
  tokenMismatch?: boolean;
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

/** camelCase payload of the `execution-command-update` Tauri event. */
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

/** camelCase payload of the `execution-command-error` Tauri event. */
export interface CommandError {
  commandId: string;
  code: string;
  message: string;
}

/** camelCase view returned by the `get_execution_queue_status` command. */
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

/**
 * Payload of the `history-unavailable` event: the EA could not synchronize the
 * requested series before its deadline, so no candles will arrive for it.
 */
export interface HistoryUnavailable {
  symbol: string;
  timeframe: string;
}

/**
 * A reconnect could not reopen the selection the user was viewing, so the
 * bridge requested `shownSymbol` (the EA's chart symbol) in its place.
 */
export interface SelectionFallback {
  symbol: string;
  timeframe: string;
  shownSymbol: string;
}

export interface BarUpdate {
  symbol: string;
  timeframe: string;
  candle: Candle;
}

export interface TickProfileBin {
  low: string;
  high: string;
  /** Decimal-string weights: total = 1 per valid tick, bid/ask = per-side flags. */
  total: string;
  bid: string;
  ask: string;
}

export interface ProfileLevels {
  poc: string;
  vah: string;
  val: string;
}

/** Where a profile's volumes come from; bar profiles are an approximation. */
export type ProfileSource = 'ticks' | 'bars';

export interface ProfileResult {
  /**
   * `bars`: approximate profile built from OHLC bars because the tick load was too large. Its `bid` series holds
   * DOWN volume and its `ask` series UP volume (a bar has no quote sides).
   */
  source: ProfileSource;
  /** Timeframe code of the bars behind a `bars` profile (e.g. "M1"); null for ticks. */
  barTimeframe: string | null;
  /**
   * Open time (UTC ms) of the oldest bar behind a `bars` profile when the broker's history starts inside the
   * requested range, so the profile does not cover its beginning. null when the whole range is covered (always for
   * ticks).
   */
  coveredFromMs: number | null;
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
  /** Per-lot tick estimates in tickValueCurrency, supplied by MT5. */
  tickValueProfit?: string | null;
  tickValueLoss?: string | null;
  tickValueCurrency?: string | null;
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
  /** ACCOUNT_CURRENCY_DIGITS; older peers default to two decimals. */
  currencyDigits?: number;
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
  /** ACCOUNT_MARGIN_SO_CALL: percent or account currency per `marginLevelsUnit`; null/absent = not reported. */
  marginCallLevel?: string | null;
  /** ACCOUNT_MARGIN_SO_SO, same unit as `marginCallLevel`; null/absent = not reported. */
  stopOutLevel?: string | null;
  /** Raw ACCOUNT_MARGIN_SO_MODE (0 percent / 1 money); null/absent = not reported. */
  marginLevelsMode?: number | null;
  /** "percent" | "money" | "unknown"; absent from older backends. */
  marginLevelsUnit?: string;
  /** ACCOUNT_COMPANY, the broker's company name; null/absent = not reported. */
  accountCompany?: string | null;
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
  /** Estimated margin the order adds once filled (order priced in isolation); null/absent = unknown. */
  marginAtFill?: string | null;
  /** Account free margin minus `marginAtFill`; may be negative; null/absent = unknown. */
  freeMarginAfterFill?: string | null;
  /** Projected margin level in percent after the fill; null/absent = unknown. */
  marginLevelAfterFill?: string | null;
  /** Position against the broker's margin-call / stop-out thresholds; absent = unknown. */
  marginRisk?: MarginRisk;
}

export type MarginRisk = 'ok' | 'below_margin_call' | 'below_stop_out' | 'unknown';

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
  stopLossProfit?: string | null;
  takeProfitProfit?: string | null;
  /** Broker minimum lot and lot step for the symbol; absent = partial close is not offered. */
  volumeMin?: string | null;
  volumeStep?: string | null;
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
  stopLossProfit?: string | null;
  takeProfitProfit?: string | null;
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

/** One MT5 installation the setup guide offers, as `list_mt5_installations` reports it. */
export interface Mt5InstallationView {
  /** Windows path of `terminal64.exe`, in the form the install command accepts back. */
  terminalPath: string;
  /** Name of the install folder, e.g. `MetaTrader 5`. */
  label: string;
  /** Whether the `MT5_*` environment variables configured this installation. */
  configured: boolean;
  /** Every `MQL5` folder the installation uses; empty when it has not created one yet. */
  dataFolders: Mt5DataFolderView[];
}

/** One `MQL5` folder of an installation. */
export interface Mt5DataFolderView {
  /** Host path of the folder, which the install command accepts back verbatim. */
  mql5Path: string;
  /** `portable`: inside the install folder; `standard`: in the user profile. */
  layout: 'portable' | 'standard';
  /** Whether the bridge EA's source sits in `Experts/Advisors` below this folder, where restart loads it from. */
  expertAdvisorInstalled: boolean;
}

/** The bundled file, named by the role it plays in MT5. */
export type Mt5InstallFile = 'expertAdvisor' | 'indicator';

/** What the install step did to one file. */
export type Mt5InstallOutcome = 'installed' | 'updated' | 'unchanged';

/** MetaEditor's result for one file. */
export interface Mt5CompiledView {
  errors: number;
  warnings: number;
  /** The log's error and warning lines, already capped by the compiler. */
  messages: string[];
}

/** What happened to one bundled file. */
export interface Mt5FileReport {
  file: Mt5InstallFile;
  /** Host path of the installed copy. */
  path: string;
  outcome: Mt5InstallOutcome;
  /** Null when the file was not compiled: a broken indicator ends the run, so the EA is never compiled. */
  compiled: Mt5CompiledView | null;
}

/** `install_to_mt5` report: what installing and compiling the two bundled files produced. */
export interface Mt5InstallReport {
  /** One entry per installed file, indicator first as the install step writes it. */
  files: Mt5FileReport[];
}

/** What the process inspection found; `unknown` is a failed inspection, never a stopped terminal. */
export type TerminalProcess = 'running' | 'not_running' | 'unknown';

/** `get_mt5_backend_status`: the MetaTrader 5 process, apart from the bridge connection. */
export interface Mt5BackendStatus {
  /** Legacy flag: `unknown` reads as false. Prefer `terminalProcess`. */
  running: boolean;
  terminalProcess: TerminalProcess;
  configured: boolean;
  autoStartEnabled: boolean;
}

/** `restart_mt5_with_ea` report: the terminal is starting again with the EA attached. */
export interface Mt5RestartReport {
  /** True once MT5 was relaunched; the session itself arrives later as a bridge status. */
  restarted: boolean;
}
