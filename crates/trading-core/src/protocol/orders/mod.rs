use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::{bounded_id, bounded_text, order_decimal, OrderKind, OrderSide};

mod risk_quote;
pub use risk_quote::{RiskQuoteError, RiskQuoteRequest, RiskQuoteResult};

/// Time-in-force of an order submission/preflight (bridge-v1 additive
/// extension). Wire spelling is snake_case (`gtc`/`day`/`ioc`/`fok`); an
/// absent field means [`TimeInForce::Gtc`] — the pre-extension behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeInForce {
    Gtc,
    Day,
    Ioc,
    Fok,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCheckRequest {
    pub draft_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_kind: OrderKind,
    pub volume: String,
    pub entry: String,
    /// Optional Stop Loss; absent or `null` = no stop loss (SL-specific
    /// rules — level side, min-distance preflight — apply only when present).
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    /// Optional time-in-force passed through to the EA preflight;
    /// absent ≡ `gtc` (byte-compatible with the pre-extension payload).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_in_force: Option<TimeInForce>,
    /// Resting limit price; required iff `order_kind == StopLimit`, ignored
    /// (when present) for the other kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_price: Option<String>,
}

impl OrderCheckRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.draft_id.trim().is_empty()
            || self.account_login.trim().is_empty()
            || self.broker_server.trim().is_empty()
            || self.symbol.trim().is_empty()
            || self.draft_id.len() > 128
            || self.account_login.len() > 128
            || self.broker_server.len() > 128
            || self.symbol.len() > 128
            || self.draft_id.trim() != self.draft_id
            || self.account_login.trim() != self.account_login
            || self.broker_server.trim() != self.broker_server
            || self.symbol.trim() != self.symbol
        {
            return Err("invalid order check identity");
        }
        order_decimal(&self.volume, true)?;
        let entry = order_decimal(&self.entry, true)?;
        validate_limit_price(self.order_kind, self.limit_price.as_deref())?;
        let entry = if self.order_kind == OrderKind::StopLimit {
            let limit_price = self
                .limit_price
                .as_deref()
                .ok_or("stop_limit requires limit_price (resting limit price)")?;
            order_decimal(limit_price, true)?
        } else {
            entry
        };
        let stop = self
            .stop_loss
            .as_deref()
            .map(|value| order_decimal(value, true))
            .transpose()?;
        let take = self
            .take_profit
            .as_ref()
            .map(|value| order_decimal(value, true))
            .transpose()?;
        match self.side {
            OrderSide::Buy
                if stop.is_some_and(|stop| stop >= entry)
                    || take.is_some_and(|value| value <= entry) =>
            {
                return Err("invalid buy geometry")
            }
            OrderSide::Sell
                if stop.is_some_and(|stop| stop <= entry)
                    || take.is_some_and(|value| value >= entry) =>
            {
                return Err("invalid sell geometry")
            }
            _ => {}
        }
        Ok(())
    }
}

/// Protective levels follow the price at which a pending order will rest.
pub fn protective_price<'a>(
    kind: OrderKind,
    entry: &'a str,
    limit_price: Option<&'a str>,
) -> Result<&'a str, &'static str> {
    if kind == OrderKind::StopLimit {
        limit_price.ok_or("stop_limit requires limit_price (resting limit price)")
    } else {
        Ok(entry)
    }
}

/// Shared `limit_price` rule of the submit/check contracts: required (and a
/// positive decimal) iff `order_kind` is `stop_limit`; a value present for
/// another kind is ignored but must still be a well-formed positive decimal.
fn validate_limit_price(
    order_kind: OrderKind,
    limit_price: Option<&str>,
) -> Result<(), &'static str> {
    if order_kind == OrderKind::StopLimit {
        let limit_price =
            limit_price.ok_or("stop_limit requires limit_price (resting limit price)")?;
        order_decimal(limit_price, true).map_err(|_| "limit_price must be a positive decimal")?;
    } else if let Some(limit_price) = limit_price {
        order_decimal(limit_price, true).map_err(|_| "limit_price must be a positive decimal")?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCheckResult {
    pub draft_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_kind: OrderKind,
    pub volume: String,
    pub requested_entry: String,
    pub check_price: String,
    /// Echo of the draft's Stop Loss; `null` when the draft had none.
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub check_passed: bool,
    pub retcode: u32,
    pub last_error: i32,
    pub balance: String,
    pub equity: String,
    pub profit: String,
    pub margin: String,
    pub free_margin: String,
    pub margin_level: String,
    pub comment: String,
    pub checked_at_ms: i64,
    /// Echo of the draft's time-in-force; `null` when the draft had none.
    #[serde(default)]
    pub time_in_force: Option<TimeInForce>,
    /// Echo of the draft's `limit_price`; `null` when the draft had none.
    #[serde(default)]
    pub limit_price: Option<String>,
}

impl OrderCheckResult {
    pub fn validate(&self, request: &OrderCheckRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.draft_id != request.draft_id
            || self.account_login != request.account_login
            || self.broker_server != request.broker_server
            || self.symbol != request.symbol
            || self.side != request.side
            || self.order_kind != request.order_kind
            || self.volume != request.volume
            || self.requested_entry != request.entry
            || self.stop_loss != request.stop_loss
            || self.take_profit != request.take_profit
            || self.time_in_force != request.time_in_force
            || self.limit_price != request.limit_price
            || self.checked_at_ms < 0
            || self.comment.chars().count() > 256
        {
            return Err("order check mismatch");
        }
        order_decimal(&self.check_price, true)?;
        order_decimal(&self.balance, false)?;
        order_decimal(&self.equity, false)?;
        order_decimal(&self.profit, false)?;
        if order_decimal(&self.margin, false)? < Decimal::ZERO {
            return Err("invalid order check decimal");
        }
        order_decimal(&self.free_margin, false)?;
        order_decimal(&self.margin_level, false)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCheckError {
    pub draft_id: String,
    pub code: String,
    pub message: String,
}

impl OrderCheckError {
    pub fn validate(&self, request: &OrderCheckRequest) -> Result<(), &'static str> {
        if self.draft_id != request.draft_id
            || self.code.trim().is_empty()
            || self.code.chars().count() > 64
            || self.message.chars().count() > 256
        {
            return Err("order check error mismatch");
        }
        Ok(())
    }
}

/// Local stop-distance guard for order preflight, mirrored verbatim by the EA
/// before `OrderCheck`/`OrderSend` so a too-close level is rejected before the
/// MT5 roundtrip with the same reason text. The required distance is
/// `max(stops_level * point_size, 20 * tick_size)` in price units, and each
/// present level must sit strictly beyond it when measured from the live quote
/// sides — a BUY stop loss below bid / take profit above ask, a SELL the
/// mirror. A `None` level is skipped (an order without an SL/TP level has
/// nothing to check on that side). Violations return the shared
/// `stop_loss too close: …` /
/// `take_profit too close: …` wording; unusable sizes pass through (the EA
/// preflight remains the enforcement point).
#[allow(clippy::too_many_arguments)]
pub fn validate_stop_distances(
    side: OrderSide,
    stop_loss: Option<&Decimal>,
    take_profit: Option<Decimal>,
    stops_level: u32,
    point_size: Decimal,
    tick_size: Decimal,
    bid: Decimal,
    ask: Decimal,
) -> Result<(), String> {
    if point_size <= Decimal::ZERO || tick_size <= Decimal::ZERO {
        return Ok(());
    }
    let minimum = std::cmp::max(
        Decimal::from(stops_level) * point_size,
        Decimal::from(20u32) * tick_size,
    );
    let (stop_distance, take_distance) = match side {
        OrderSide::Buy => (
            stop_loss.map(|stop_loss| bid - *stop_loss),
            take_profit.map(|value| value - ask),
        ),
        OrderSide::Sell => (
            stop_loss.map(|stop_loss| *stop_loss - ask),
            take_profit.map(|value| bid - value),
        ),
    };
    if let Some(stop_distance) = stop_distance {
        if stop_distance <= minimum {
            return Err(format!(
                "stop_loss too close: distance {stop_distance}, required >= {minimum} (20 ticks margin)"
            ));
        }
    }
    if let Some(distance) = take_distance {
        if distance <= minimum {
            return Err(format!(
                "take_profit too close: distance {distance}, required >= {minimum} (20 ticks margin)"
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderSubmitRequest {
    pub command_id: String,
    pub draft_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub symbol: String,
    pub side: String,
    pub order_kind: String,
    pub volume: String,
    pub entry: String,
    /// Optional Stop Loss; absent or `null` = no stop loss. A present value
    /// keeps the original positive-decimal rules; serialization of a present
    /// value is byte-identical to the required-field era.
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    /// Optional time-in-force (`gtc`|`day`|`ioc`|`fok`); absent ≡ `gtc`,
    /// byte-compatible with the pre-extension payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_in_force: Option<String>,
    /// Resting limit price; required iff `order_kind == "stop_limit"`,
    /// ignored (when well-formed) for the other kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_price: Option<String>,
}

impl OrderSubmitRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.command_id, 128)
            || !bounded_id(&self.draft_id, 128)
            || !bounded_id(&self.account_login, 128)
            || !bounded_id(&self.broker_server, 128)
            || !bounded_id(&self.symbol, 128)
            || !matches!(self.side.as_str(), "buy" | "sell")
            || !matches!(
                self.order_kind.as_str(),
                "market" | "limit" | "stop" | "stop_limit"
            )
        {
            return Err("invalid order submit request");
        }
        if let Some(time_in_force) = &self.time_in_force {
            if !matches!(time_in_force.as_str(), "gtc" | "day" | "ioc" | "fok") {
                return Err("time_in_force must be gtc, day, ioc, or fok");
            }
        }
        order_decimal(&self.volume, true)?;
        order_decimal(&self.entry, true)?;
        if let Some(stop_loss) = &self.stop_loss {
            order_decimal(stop_loss, true)?;
        }
        if let Some(take_profit) = &self.take_profit {
            order_decimal(take_profit, true)?;
        }
        if self.order_kind == "stop_limit" {
            let limit_price = self
                .limit_price
                .as_deref()
                .ok_or("stop_limit requires limit_price (resting limit price)")?;
            order_decimal(limit_price, true)
                .map_err(|_| "limit_price must be a positive decimal")?;
        } else if let Some(limit_price) = &self.limit_price {
            // Ignored for the other kinds, but a present value must still be
            // a well-formed positive decimal.
            order_decimal(limit_price, true)
                .map_err(|_| "limit_price must be a positive decimal")?;
        }
        Ok(())
    }
}

/// Re-prices a resting pending order or sets its Stop Loss/Take Profit.
/// A `null` field means "leave that level unchanged"; removing an existing
/// SL/TP is out of MVP and requires an explicit encoding in a future version
/// of the protocol.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderModifyRequest {
    pub command_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub target_kind: String,
    pub target_id: String,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub price: Option<String>,
}

impl OrderModifyRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.command_id, 128)
            || !bounded_id(&self.account_login, 128)
            || !bounded_id(&self.broker_server, 128)
            || !bounded_id(&self.target_id, 128)
            || !matches!(self.target_kind.as_str(), "position" | "pending_order")
        {
            return Err("invalid order modify request");
        }
        // A price change re-prices a resting pending order only; an open
        // position has no price of its own to modify.
        if self.price.is_some() && self.target_kind != "pending_order" {
            return Err("order modify price requires a pending order target");
        }
        if self.stop_loss.is_none() && self.take_profit.is_none() && self.price.is_none() {
            return Err("order modify requires stop_loss, take_profit, or price");
        }
        // SL/TP accept 0 as the explicit "remove this level" sentinel (MT5
        // clears a stop at price 0 — PositionModify/OrderModify with sl=0);
        // negative or malformed values stay rejected. `null` still means
        // "leave unchanged" on the wire.
        if let Some(stop_loss) = &self.stop_loss {
            let level = order_decimal(stop_loss, false)?;
            if level < Decimal::ZERO {
                return Err("invalid order check decimal");
            }
        }
        if let Some(take_profit) = &self.take_profit {
            let level = order_decimal(take_profit, false)?;
            if level < Decimal::ZERO {
                return Err("invalid order check decimal");
            }
        }
        if let Some(price) = &self.price {
            order_decimal(price, true)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCloseRequest {
    pub command_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub position_id: String,
    pub volume: Option<String>,
}

impl OrderCloseRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.command_id, 128)
            || !bounded_id(&self.account_login, 128)
            || !bounded_id(&self.broker_server, 128)
            || !bounded_id(&self.position_id, 128)
        {
            return Err("invalid order close request");
        }
        // MVP sends `None` for a full close; a present volume must be positive.
        if let Some(volume) = &self.volume {
            order_decimal(volume, true)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCancelRequest {
    pub command_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub order_id: String,
}

impl OrderCancelRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.command_id, 128)
            || !bounded_id(&self.account_login, 128)
            || !bounded_id(&self.broker_server, 128)
            || !bounded_id(&self.order_id, 128)
        {
            return Err("invalid order cancel request");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCommandUpdate {
    pub command_id: String,
    pub status: String,
    pub retcode: Option<i64>,
    pub last_error: Option<i64>,
    pub broker_order_id: Option<String>,
    pub deal_id: Option<String>,
    pub position_id: Option<String>,
    pub filled_volume: Option<String>,
    pub message: Option<String>,
    pub updated_at_ms: i64,
    pub at_update: u64,
}

impl OrderCommandUpdate {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.command_id, 128)
            || !matches!(
                self.status.as_str(),
                "accepted"
                    | "dispatching"
                    | "server_accepted"
                    | "partially_filled"
                    | "filled"
                    | "rejected"
                    | "unknown"
            )
            || self
                .broker_order_id
                .as_ref()
                .is_some_and(|value| !bounded_id(value, 128))
            || self
                .deal_id
                .as_ref()
                .is_some_and(|value| !bounded_id(value, 128))
            || self
                .position_id
                .as_ref()
                .is_some_and(|value| !bounded_id(value, 128))
            || self
                .message
                .as_ref()
                .is_some_and(|value| !bounded_text(value, 256, true))
            || self.updated_at_ms < 0
        {
            return Err("invalid order command update");
        }
        if let Some(filled_volume) = &self.filled_volume {
            order_decimal(filled_volume, true)?;
        }
        Ok(())
    }
}

/// Closed `order_command_error.code` vocabulary from the bridge contract.
const ORDER_COMMAND_ERROR_CODES: [&str; 6] = [
    "UNKNOWN_COMMAND",
    "DUPLICATE_CONFLICT",
    "PREFLIGHT_FAILED",
    "INVALID_REQUEST",
    "BROKER_UNAVAILABLE",
    "JOURNAL_UNAVAILABLE",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderCommandError {
    pub command_id: String,
    pub code: String,
    pub message: String,
}

impl OrderCommandError {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.command_id, 128)
            || !bounded_text(&self.code, 64, false)
            || !bounded_text(&self.message, 256, false)
            || !ORDER_COMMAND_ERROR_CODES.contains(&self.code.as_str())
        {
            return Err("invalid order command error");
        }
        Ok(())
    }
}
