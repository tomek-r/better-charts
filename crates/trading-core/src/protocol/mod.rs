//! Wire models and length-prefixed framing for bridge protocol v1.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_SIZE: usize = 1024 * 1024;

mod account;
mod control;
mod framing;
mod limits;
mod market;
mod orders;
mod timeframes;
mod versions;
pub use account::{
    AccountSnapshot, HistoryDeal, HistoryOrder, OpenPosition, PendingOrder, PortfolioSnapshot,
    ReconcileError, ReconcileRequest, ReconcileSnapshot,
};
pub use control::{
    Envelope, ErrorCode, ErrorPayload, HeartbeatAckPayload, HeartbeatPayload, HelloAckPayload,
    HelloPayload, MarketSessionStatus,
};
pub use framing::{
    decode_json, encode_frame, encode_frame_with_limit, encode_json, FrameDecoder, FrameError,
};
pub use limits::{
    default_frame_bytes, history_bars, initial_history_bars, max_frame_bytes, min_frame_bytes,
};
pub use market::{
    BarUpdate, BrokerSymbol, HistoryRequest, HistorySnapshot, MarketCandle, MarketTick,
    QuoteUpdate, SymbolInfoRequest, SymbolInfoResult, SymbolSearchRequest, SymbolSearchResult,
    TickHistoryRequest, TickHistorySnapshot, TickPriceCount, TickPriceHistoryRequest,
    TickPriceHistorySnapshot,
};
pub use orders::{
    protective_price, validate_stop_distances, OrderCancelRequest, OrderCheckError,
    OrderCheckRequest, OrderCheckResult, OrderCloseRequest, OrderCommandError, OrderCommandUpdate,
    OrderModifyRequest, OrderSubmitRequest, RiskQuoteError, RiskQuoteRequest, RiskQuoteResult,
    TimeInForce,
};
pub use timeframes::{
    default_timeframe, is_supported_timeframe, supported_timeframes, timeframe_seconds,
};
pub use versions::{expert_adviser_version, tick_reader_version};
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferLimits {
    pub max_frame_bytes: u32,
    pub max_ticks_per_page: u16,
}

impl Default for TransferLimits {
    fn default() -> Self {
        Self {
            max_frame_bytes: MAX_FRAME_SIZE as u32,
            max_ticks_per_page: 5000,
        }
    }
}

impl TransferLimits {
    pub fn measured_default() -> Self {
        Self {
            max_frame_bytes: default_frame_bytes(),
            max_ticks_per_page: u16::MAX,
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if !(min_frame_bytes()..=max_frame_bytes()).contains(&self.max_frame_bytes)
            || self.max_ticks_per_page == 0
        {
            return Err("invalid transfer limits");
        }
        Ok(())
    }

    pub fn negotiate(self, peer: Self) -> Result<Self, &'static str> {
        self.validate()?;
        peer.validate()?;
        Ok(Self {
            max_frame_bytes: self.max_frame_bytes.min(peer.max_frame_bytes),
            max_ticks_per_page: self.max_ticks_per_page.min(peer.max_ticks_per_page),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageType {
    Hello,
    HelloAck,
    Heartbeat,
    HeartbeatAck,
    HistoryRequest,
    HistorySnapshot,
    BarUpdate,
    SymbolSearchRequest,
    SymbolSearchResult,
    SymbolInfoRequest,
    SymbolInfoResult,
    QuoteUpdate,
    AccountSnapshot,
    PortfolioSnapshot,
    RiskQuoteRequest,
    RiskQuoteResult,
    RiskQuoteError,
    OrderCheckRequest,
    OrderCheckResult,
    OrderCheckError,
    OrderSubmitRequest,
    OrderModifyRequest,
    OrderCloseRequest,
    OrderCancelRequest,
    OrderCommandUpdate,
    OrderCommandError,
    TickHistoryRequest,
    TickHistorySnapshot,
    TickPriceHistorySnapshot,
    ReconcileRequest,
    ReconcileSnapshot,
    ReconcileError,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderKind {
    Market,
    Limit,
    Stop,
    /// MT5 `ORDER_TYPE_STOP_LIMIT`: `entry` carries the stop trigger price,
    /// `limit_price` the resting limit price placed once the trigger fires.
    StopLimit,
}

pub(super) fn bounded_text(value: &str, max_chars: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.trim() == value
        && value.chars().count() <= max_chars
}

/// Identity fields (all `*_id`s, logins, servers, `symbol`, `magic`) are
/// bounded in UTF-8 **bytes** — the contract specifies "bajty", not chars —
/// and must be non-empty and trimmed. Free text (`message`, `comment`) keeps
/// the char-based [`bounded_text`] bound.
pub(super) fn bounded_id(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && value.trim() == value && value.len() <= max_bytes
}

pub(crate) fn order_decimal(value: &str, positive: bool) -> Result<Decimal, &'static str> {
    if value.is_empty() || value.len() > 64 || value.trim() != value {
        return Err("invalid order check decimal");
    }
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let mut pieces = unsigned.split('.');
    let integer = pieces.next().unwrap_or_default();
    let fraction = pieces.next();
    if integer.is_empty()
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.is_some_and(|digits| {
            digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit())
        })
        || pieces.next().is_some()
    {
        return Err("invalid order check decimal");
    }
    let parsed = value
        .parse::<Decimal>()
        .map_err(|_| "invalid order check decimal")?;
    if positive && parsed <= Decimal::ZERO {
        return Err("invalid order check decimal");
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests;
