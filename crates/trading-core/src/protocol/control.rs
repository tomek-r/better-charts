use serde::{Deserialize, Serialize};

use super::{MessageType, TransferLimits};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u16,
    #[serde(rename = "type")]
    pub message_type: MessageType,
    pub id: String,
    pub session_id: Option<String>,
    pub sent_at_ms: i64,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloPayload {
    pub token: String,
    pub terminal_id: String,
    pub terminal_build: u32,
    pub account_login: String,
    pub broker_server: String,
    pub chart_symbol: String,
    pub expert_version: String,
    pub trading_enabled: bool,
    #[serde(default)]
    pub transfer_limits: TransferLimits,
    #[serde(default)]
    pub tick_price_counts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloAckPayload {
    pub heartbeat_interval_ms: u64,
    pub heartbeat_timeout_ms: u64,
    pub trading_enabled: bool,
    #[serde(default)]
    pub transfer_limits: TransferLimits,
    #[serde(default)]
    pub tick_price_counts: bool,
}

/// One EA observation of the **active symbol's** trading session, carried on
/// the 2-second heartbeat. The EA derives `is_open` from
/// `SymbolInfoSessionTrade` evaluated at `server_time_ms` (broker server time),
/// combined with the symbol's `SYMBOL_TRADE_MODE`. Rust treats an absent or
/// symbol-mismatched observation as unknown and fails closed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarketSessionStatus {
    pub symbol: String,
    /// True only while the broker's trade session for `symbol` is open.
    pub is_open: bool,
    /// Raw `ENUM_SYMBOL_TRADE_MODE` (`SYMBOL_TRADE_MODE_DISABLED = 0`).
    pub trade_mode: u32,
    /// Broker server time at which `is_open` was evaluated (Unix milliseconds).
    pub server_time_ms: i64,
}

impl MarketSessionStatus {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.symbol.trim().is_empty() || self.symbol.len() > 128 {
            return Err("invalid market session symbol");
        }
        if self.server_time_ms < 0 {
            return Err("invalid market session server time");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatPayload {
    pub sequence: u64,
    pub terminal_connected: bool,
    pub account_connected: bool,
    pub broker_server: String,
    /// Optional EA observation of the active symbol's trade session. Absent on
    /// older EAs, which Rust treats as unknown and fails closed.
    #[serde(default)]
    pub market_session: Option<MarketSessionStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatAckPayload {
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    MalformedFrame,
    FrameTooLarge,
    InvalidMessage,
    UnsupportedVersion,
    AuthFailed,
    HandshakeRequired,
    SessionMismatch,
    InternalError,
}
