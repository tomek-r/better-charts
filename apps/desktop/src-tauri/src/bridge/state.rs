use super::{
    AccountView, MarketCandle, PortfolioView, QuoteView, SymbolCacheState, TickCacheController,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{atomic::AtomicU64, Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;
use tokio::sync::watch;
use trading_core::protocol::{
    HistoryRequest, OrderCheckRequest, OrderCheckResult, RiskQuoteRequest, SymbolInfoRequest,
    SymbolSearchRequest, TickHistoryRequest, TickHistorySnapshot, PROTOCOL_VERSION,
};

pub(crate) const DEFAULT_ADDR: &str = "127.0.0.1:8765";
pub(crate) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
pub(crate) const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(6);
pub(crate) type PendingRisk = (RiskQuoteRequest, rust_decimal::Decimal, u64);
pub(crate) type ExpectedRisk = (String, RiskQuoteRequest, rust_decimal::Decimal, u64);
pub(crate) type PendingOrderCheck = (OrderCheckRequest, u64);
pub(crate) type ExpectedOrderCheck = (String, OrderCheckRequest, u64);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReconciliationStateKind {
    Pending,
    Complete,
    Incomplete,
    Error,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconciliationStatus {
    pub(crate) state: ReconciliationStateKind,
    pub(crate) request_id: Option<String>,
    pub(crate) snapshot_id: Option<String>,
    pub(crate) account_login: Option<String>,
    pub(crate) broker_server: Option<String>,
    pub(crate) captured_at_ms: Option<i64>,
    pub(crate) history_from_ms: Option<i64>,
    pub(crate) history_to_ms: Option<i64>,
    pub(crate) sequence_before: Option<u64>,
    pub(crate) sequence_after: Option<u64>,
    pub(crate) position_count: usize,
    pub(crate) active_order_count: usize,
    pub(crate) history_order_count: usize,
    pub(crate) history_deal_count: usize,
    pub(crate) message: Option<String>,
}

impl ReconciliationStatus {
    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self {
            state: ReconciliationStateKind::Unavailable,
            request_id: None,
            snapshot_id: None,
            account_login: None,
            broker_server: None,
            captured_at_ms: None,
            history_from_ms: None,
            history_to_ms: None,
            sequence_before: None,
            sequence_after: None,
            position_count: 0,
            active_order_count: 0,
            history_order_count: 0,
            history_deal_count: 0,
            message: Some(message.into()),
        }
    }
}

/// CamelCase view of one EA market-session observation, carried inside
/// [`BridgeStatus`] and published on the existing `bridge-status` event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct MarketSessionView {
    pub symbol: String,
    #[serde(rename = "isOpen")]
    pub is_open: bool,
    #[serde(rename = "tradeMode")]
    pub trade_mode: u32,
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: i64,
}

impl From<trading_core::protocol::MarketSessionStatus> for MarketSessionView {
    fn from(value: trading_core::protocol::MarketSessionStatus) -> Self {
        Self {
            symbol: value.symbol,
            is_open: value.is_open,
            trade_mode: value.trade_mode,
            server_time_ms: value.server_time_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct BridgeStatus {
    pub state: BridgeConnectionState,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
    pub terminal: Option<String>,
    pub account: Option<String>,
    pub server: Option<String>,
    #[serde(rename = "lastHeartbeat")]
    pub last_heartbeat: Option<i64>,
    pub message: Option<String>,
    /// Most recent EA market-session observation for the active symbol; `None`
    /// until the first heartbeat that carries one (fail closed).
    #[serde(rename = "marketSession", default)]
    pub market_session: Option<MarketSessionView>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BridgeConnectionState {
    Disconnected,
    Connecting,
    Connected,
    ProtocolError,
}

impl Default for BridgeStatus {
    fn default() -> Self {
        Self {
            state: BridgeConnectionState::Connecting,
            protocol_version: PROTOCOL_VERSION.to_string(),
            terminal: None,
            account: None,
            server: None,
            last_heartbeat: None,
            message: None,
            market_session: None,
        }
    }
}

/// Seam over outbound app events. Production uses [`TauriBridgeEvents`]; the
/// protocol tests substitute a recording double so the full
/// `handle_connection` loop can run without a live Tauri app. Fire-and-forget:
/// emit failures are ignored, exactly like the raw `AppHandle::emit` calls
/// this replaces.
pub(crate) trait BridgeEvents: Send + Sync {
    /// Object-safe core: payloads are lowered to `serde_json::Value` by
    /// [`bridge_emit`] before they reach this method.
    fn emit_value(&self, event: &str, payload: &serde_json::Value);
}

pub(crate) struct TauriBridgeEvents(pub tauri::AppHandle);

impl BridgeEvents for TauriBridgeEvents {
    fn emit_value(&self, event: &str, payload: &serde_json::Value) {
        let _ = self.0.emit(event, payload);
    }
}

/// Fire-and-forget typed event emission. Serialization or emit failures are
/// ignored — exactly what the raw `AppHandle::emit` calls this replaces did.
pub(crate) fn bridge_emit<T: serde::Serialize + Clone>(
    events: &Arc<dyn BridgeEvents>,
    event: &str,
    payload: T,
) {
    if let Ok(value) = serde_json::to_value(&payload) {
        events.emit_value(event, &value);
    }
}

#[derive(Clone)]
pub(crate) struct BridgeState {
    pub(crate) status: Arc<Mutex<BridgeStatus>>,
    pub(crate) current_session: Arc<Mutex<Option<String>>>,
    /// Serializes synchronous session replacement/reset with session-bound
    /// command producers, outbound claims, and inbound state application.
    /// Lock order is session_work → bridge state / adapter → journal; adapter
    /// code never acquires this lock. Never hold it across an `.await`.
    pub(crate) session_work: Arc<Mutex<()>>,
    pub(crate) transfer_limits: Arc<Mutex<trading_core::protocol::TransferLimits>>,
    pub(crate) tick_price_counts: Arc<Mutex<bool>>,
    pub(crate) market: Arc<Mutex<MarketSnapshot>>,
    pub(crate) pending_history: Arc<Mutex<Option<HistoryRequest>>>,
    pub(crate) expected_history: Arc<Mutex<Option<(String, HistoryRequest)>>>,
    /// One older-history page, kept apart from [`Self::pending_history`] so lazy
    /// loading can never displace the in-flight window request (and vice versa).
    pub(crate) pending_history_page: Arc<Mutex<Option<HistoryRequest>>>,
    pub(crate) expected_history_page: Arc<Mutex<Option<(String, HistoryRequest)>>>,
    pub(crate) pending_tick_profile: Arc<Mutex<Option<TickProfileRequest>>>,
    pub(crate) expected_tick_profile: Arc<Mutex<Option<(u64, String, TickProfileRequest)>>>,
    pub(crate) tick_controller: Arc<Mutex<TickCacheController>>,
    pub(crate) pending_symbol_search: Arc<Mutex<Option<SymbolSearchRequest>>>,
    pub(crate) expected_symbol_search: Arc<Mutex<Option<(String, SymbolSearchRequest)>>>,
    pub(crate) pending_symbol_info: Arc<Mutex<Option<SymbolInfoRequest>>>,
    pub(crate) expected_symbol_info: Arc<Mutex<Option<(String, SymbolInfoRequest)>>>,
    pub(crate) symbol_cache: Arc<Mutex<SymbolCacheState>>,
    pub(crate) quote: Arc<Mutex<Option<QuoteView>>>,
    pub(crate) account: Arc<Mutex<Option<AccountView>>>,
    pub(crate) portfolio: Arc<Mutex<Option<PortfolioView>>>,
    pub(crate) pending_risk: Arc<Mutex<Option<PendingRisk>>>,
    pub(crate) expected_risk: Arc<Mutex<Option<ExpectedRisk>>>,
    pub(crate) pending_order_check: Arc<Mutex<Option<PendingOrderCheck>>>,
    pub(crate) expected_order_check: Arc<Mutex<Option<ExpectedOrderCheck>>>,
    pub(crate) validated_order_check: Arc<Mutex<Option<ValidatedOrderCheck>>>,
    pub(crate) pending_reconciliation: Arc<Mutex<Option<PendingReconciliation>>>,
    pub(crate) expected_reconciliation: Arc<Mutex<Option<ExpectedReconciliation>>>,
    pub(crate) reconciliation_status: Arc<Mutex<ReconciliationStatus>>,
    pub(crate) next_request_id: Arc<AtomicU64>,
    /// Broadcasts a generation change whenever a Tauri command queues work.
    /// `watch` wakes every overlapping connection task, so a superseded
    /// session cannot consume the only notification intended for the current
    /// session.
    pub(crate) outbound_signal: watch::Sender<u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct PendingReconciliation {
    pub(crate) session_id: String,
    pub(crate) request: trading_core::protocol::ReconcileRequest,
}

#[derive(Debug, Clone)]
pub(crate) struct ExpectedReconciliation {
    pub(crate) session_id: String,
    pub(crate) request: trading_core::protocol::ReconcileRequest,
}

// The fields are written on acceptance and read by unit tests only; production
// code treats the slot as a presence marker. Kept for the pending UI readout.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct ValidatedOrderCheck {
    pub(crate) result: OrderCheckResult,
    pub(crate) draft_version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct MarketSnapshot {
    pub symbol: Option<String>,
    pub timeframe: Option<String>,
    pub complete: bool,
    pub candles: Vec<MarketCandle>,
}

#[derive(Debug, Clone)]
pub(crate) struct TickProfileRequest {
    pub(crate) wire: TickHistoryRequest,
    pub(crate) rows: u16,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct CachedTickRange {
    pub(crate) range: trading_core::volume_profile::TickRange,
    pub(crate) snapshot: TickHistorySnapshot,
}

#[derive(Debug)]
pub(crate) struct ActiveTickProfile {
    pub(crate) generation: u64,
    pub(crate) request: TickProfileRequest,
    pub(crate) gaps: Vec<trading_core::volume_profile::TickRange>,
    pub(crate) parts: Vec<TickHistorySnapshot>,
    pub(crate) compact: Option<CompactTickProfile>,
    pub(crate) incomplete: bool,
    pub(crate) completed_pages: usize,
    pub(crate) loaded_ticks: usize,
}

#[derive(Debug)]
pub(crate) struct CompactTickProfile {
    pub(crate) tick_size: String,
    pub(crate) complete: bool,
    pub(crate) counts: trading_core::volume_profile::FixedRangeProfileAccumulator,
}

#[derive(Debug)]
pub(crate) enum TickPageResult {
    Stale,
    Next(TickProfileRequest),
    Final(TickHistorySnapshot, TickProfileRequest),
    Streamed(CompactTickProfile, TickProfileRequest),
    Limit(TickProfileRequest),
    Error(&'static str),
}

pub(crate) const MAX_ACTIVE_TICK_PAGES: usize = 512;
pub(crate) const MAX_RETAINED_PROFILE_TICKS: usize = 250_000;
pub(crate) const MAX_PROFILE_PRICES: usize = 250_000;
