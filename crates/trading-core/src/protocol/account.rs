use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::{bounded_id, bounded_text, order_decimal, OrderSide};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountSnapshot {
    pub account_login: String,
    pub broker_server: String,
    pub currency: String,
    pub balance: String,
    pub equity: String,
    pub margin: String,
    pub free_margin: String,
    pub margin_level: String,
    pub leverage: u32,
    pub margin_mode: u32,
    pub trade_allowed: bool,
    pub expert_allowed: bool,
    /// Raw `AccountInfoInteger(ACCOUNT_TRADE_MODE)` value
    /// (`ENUM_ACCOUNT_TRADE_MODE`, sourced from the terminal). `-1` is the
    /// "not reported" sentinel: payloads from older EAs omit the field.
    #[serde(default = "unknown_account_trade_mode")]
    pub account_trade_mode: i64,
    /// `demo` | `contest` | `real` | `unknown` — resolved by the EA from the
    /// `ENUM_ACCOUNT_TRADE_MODE` switch; `unknown` also covers payloads from
    /// older EAs and unrecognized raw values. Deliberately distinct from the
    /// instrument-level `trade_mode` of `symbol_info`.
    #[serde(default = "unknown_account_trade_mode_name")]
    pub account_trade_mode_name: String,
}

fn unknown_account_trade_mode() -> i64 {
    -1
}

fn unknown_account_trade_mode_name() -> String {
    "unknown".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenPosition {
    pub position_id: String,
    pub ticket: String,
    pub symbol: String,
    pub side: OrderSide,
    pub volume: String,
    pub price_open: String,
    pub price_current: String,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub profit: String,
    pub swap: String,
    pub time_ms: i64,
    pub magic: String,
}

impl OpenPosition {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.position_id.is_empty()
            || self.ticket.is_empty()
            || self.symbol.trim().is_empty()
            || self.time_ms < 0
        {
            return Err("invalid position identity");
        }
        validate_positive(&self.volume)?;
        validate_positive(&self.price_open)?;
        validate_positive(&self.price_current)?;
        validate_optional_positive(&self.stop_loss)?;
        validate_optional_positive(&self.take_profit)?;
        validate_decimal(&self.profit)?;
        validate_decimal(&self.swap)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingOrder {
    pub order_id: String,
    pub symbol: String,
    pub order_type: String,
    pub state: String,
    pub volume_initial: String,
    pub volume_current: String,
    pub price_open: String,
    pub price_current: String,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub time_setup_ms: i64,
    pub expiration_ms: Option<i64>,
    pub magic: String,
}

impl PendingOrder {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.order_id.is_empty()
            || self.symbol.trim().is_empty()
            || !matches!(
                self.order_type.as_str(),
                "buy_limit"
                    | "sell_limit"
                    | "buy_stop"
                    | "sell_stop"
                    | "buy_stop_limit"
                    | "sell_stop_limit"
            )
            || self.state.trim().is_empty()
            || self.state.chars().count() > 64
            || self.time_setup_ms < 0
            || self.expiration_ms.is_some_and(|v| v < 0)
        {
            return Err("invalid order identity");
        }
        validate_positive(&self.volume_initial)?;
        validate_positive(&self.volume_current)?;
        validate_positive(&self.price_open)?;
        validate_nonnegative(&self.price_current)?;
        validate_optional_positive(&self.stop_loss)?;
        validate_optional_positive(&self.take_profit)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortfolioSnapshot {
    pub account_login: String,
    pub captured_at_ms: i64,
    pub positions: Vec<OpenPosition>,
    pub orders: Vec<PendingOrder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReconcileRequest {
    pub request_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub history_from_ms: i64,
    pub max_history_orders: usize,
    pub max_history_deals: usize,
}

impl ReconcileRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !bounded_id(&self.request_id, 128)
            || !bounded_id(&self.account_login, 128)
            || !bounded_id(&self.broker_server, 128)
            || self.history_from_ms < 0
            || !(1..=1000).contains(&self.max_history_orders)
            || !(1..=1000).contains(&self.max_history_deals)
        {
            return Err("invalid reconciliation request");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReconcileSnapshot {
    pub request_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub snapshot_id: String,
    pub history_from_ms: i64,
    pub history_to_ms: i64,
    pub sequence_before: u64,
    pub sequence_after: u64,
    pub complete: bool,
    pub captured_at_ms: i64,
    pub positions: Vec<OpenPosition>,
    pub active_orders: Vec<PendingOrder>,
    pub history_orders: Vec<HistoryOrder>,
    pub history_deals: Vec<HistoryDeal>,
}

impl ReconcileSnapshot {
    pub fn validate(&self, request: &ReconcileRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id != request.request_id
            || self.account_login != request.account_login
            || self.broker_server != request.broker_server
            || !bounded_id(&self.snapshot_id, 128)
            || self.history_from_ms != request.history_from_ms
            || self.history_to_ms < self.history_from_ms
            || self.captured_at_ms < self.history_to_ms
            || self.sequence_after < self.sequence_before
            || (self.complete && self.sequence_before != self.sequence_after)
            || self.positions.len() > 500
            || self.active_orders.len() > 500
            || self.history_orders.len() > request.max_history_orders
            || self.history_deals.len() > request.max_history_deals
            || self.history_orders.len() > 1000
            || self.history_deals.len() > 1000
        {
            return Err("invalid reconciliation snapshot");
        }

        let mut position_ids = std::collections::HashSet::new();
        for position in &self.positions {
            position.validate()?;
            if !bounded_id(&position.position_id, 128)
                || !bounded_id(&position.ticket, 128)
                || !bounded_id(&position.symbol, 128)
                || !bounded_id(&position.magic, 128)
                || !position_ids.insert(position.position_id.as_str())
            {
                return Err("invalid position identity");
            }
        }
        let mut active_order_ids = std::collections::HashSet::new();
        for order in &self.active_orders {
            order.validate()?;
            if !bounded_id(&order.order_id, 128)
                || !bounded_id(&order.symbol, 128)
                || !bounded_text(&order.order_type, 64, false)
                || !bounded_text(&order.state, 64, false)
                || !bounded_id(&order.magic, 128)
                || !active_order_ids.insert(order.order_id.as_str())
            {
                return Err("invalid active order identity");
            }
        }
        let mut history_order_ids = std::collections::HashSet::new();
        for order in &self.history_orders {
            order.validate(self.history_from_ms, self.history_to_ms)?;
            if !history_order_ids.insert(order.order_id.as_str()) {
                return Err("duplicate history order id");
            }
        }
        let mut history_deal_ids = std::collections::HashSet::new();
        for deal in &self.history_deals {
            deal.validate(self.history_from_ms, self.history_to_ms)?;
            if !history_deal_ids.insert(deal.deal_id.as_str()) {
                return Err("duplicate history deal id");
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryOrder {
    pub order_id: String,
    pub position_id: Option<String>,
    pub time_setup_ms: i64,
    pub time_done_ms: i64,
    pub symbol: String,
    pub magic: String,
    pub order_type: String,
    pub state: String,
    pub volume_initial: String,
    pub volume_current: String,
    pub price_open: String,
    pub price_current: String,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub comment: Option<String>,
}

impl HistoryOrder {
    fn validate(&self, from_ms: i64, to_ms: i64) -> Result<(), &'static str> {
        if !bounded_id(&self.order_id, 128)
            || self
                .position_id
                .as_ref()
                .is_some_and(|value| !bounded_id(value, 128))
            || !bounded_id(&self.symbol, 128)
            || !bounded_id(&self.magic, 128)
            || !bounded_text(&self.order_type, 64, false)
            || !bounded_text(&self.state, 64, false)
            || self
                .comment
                .as_ref()
                .is_some_and(|value| !bounded_text(value, 256, true))
            || self.time_setup_ms < 0
            || self.time_done_ms < self.time_setup_ms
            || self.time_done_ms < from_ms
            || self.time_done_ms > to_ms
        {
            return Err("invalid history order");
        }
        validate_positive_order_decimal(&self.volume_initial)?;
        validate_nonnegative_order_decimal(&self.volume_current)?;
        validate_positive_order_decimal(&self.price_open)?;
        validate_nonnegative_order_decimal(&self.price_current)?;
        validate_optional_positive_order_decimal(&self.stop_loss)?;
        validate_optional_positive_order_decimal(&self.take_profit)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryDeal {
    pub deal_id: String,
    pub order_id: String,
    pub position_id: Option<String>,
    pub time_ms: i64,
    pub symbol: String,
    pub magic: String,
    pub deal_type: String,
    pub entry: String,
    pub volume: String,
    pub price: String,
    pub profit: String,
    pub commission: String,
    pub swap: String,
    pub fee: String,
    pub comment: Option<String>,
}

impl HistoryDeal {
    fn validate(&self, from_ms: i64, to_ms: i64) -> Result<(), &'static str> {
        if !bounded_id(&self.deal_id, 128)
            || !bounded_id(&self.order_id, 128)
            || self
                .position_id
                .as_ref()
                .is_some_and(|value| !bounded_id(value, 128))
            || !bounded_id(&self.symbol, 128)
            || !bounded_id(&self.magic, 128)
            || !bounded_text(&self.deal_type, 64, false)
            || !bounded_text(&self.entry, 64, false)
            || self
                .comment
                .as_ref()
                .is_some_and(|value| !bounded_text(value, 256, true))
            || self.time_ms < from_ms
            || self.time_ms > to_ms
        {
            return Err("invalid history deal");
        }
        validate_positive_order_decimal(&self.volume)?;
        validate_positive_order_decimal(&self.price)?;
        validate_signed_order_decimal(&self.profit)?;
        validate_signed_order_decimal(&self.commission)?;
        validate_signed_order_decimal(&self.swap)?;
        validate_signed_order_decimal(&self.fee)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReconcileError {
    pub request_id: String,
    pub code: String,
    pub message: String,
}

impl ReconcileError {
    pub fn validate(&self, request: &ReconcileRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id != request.request_id
            || !bounded_text(&self.code, 64, false)
            || !bounded_text(&self.message, 256, false)
        {
            return Err("invalid reconciliation error");
        }
        Ok(())
    }
}

fn validate_positive_order_decimal(value: &str) -> Result<(), &'static str> {
    if unsigned_order_decimal(value)? > Decimal::ZERO {
        Ok(())
    } else {
        Err("decimal must be positive")
    }
}

fn validate_nonnegative_order_decimal(value: &str) -> Result<(), &'static str> {
    if unsigned_order_decimal(value)? >= Decimal::ZERO {
        Ok(())
    } else {
        Err("decimal must be nonnegative")
    }
}

fn validate_optional_positive_order_decimal(value: &Option<String>) -> Result<(), &'static str> {
    if let Some(value) = value {
        validate_positive_order_decimal(value)?;
    }
    Ok(())
}

fn validate_signed_order_decimal(value: &str) -> Result<(), &'static str> {
    order_decimal(value, false).map(|_| ())
}

fn unsigned_order_decimal(value: &str) -> Result<Decimal, &'static str> {
    if value.starts_with('-') {
        return Err("decimal must be unsigned");
    }
    order_decimal(value, false)
}

impl PortfolioSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.account_login.trim().is_empty()
            || self.captured_at_ms < 0
            || self.positions.len() > 500
            || self.orders.len() > 500
        {
            return Err("invalid portfolio snapshot");
        }
        let mut position_ids = std::collections::HashSet::new();
        for item in &self.positions {
            item.validate()?;
            if !position_ids.insert(&item.position_id) {
                return Err("duplicate position id");
            }
        }
        let mut order_ids = std::collections::HashSet::new();
        for item in &self.orders {
            item.validate()?;
            if !order_ids.insert(&item.order_id) {
                return Err("duplicate order id");
            }
        }
        Ok(())
    }
}

fn validate_decimal(value: &str) -> Result<(), &'static str> {
    value
        .parse::<Decimal>()
        .map(|_| ())
        .map_err(|_| "invalid decimal")
}
fn validate_positive(value: &str) -> Result<(), &'static str> {
    let value: Decimal = value.parse().map_err(|_| "invalid decimal")?;
    if value > Decimal::ZERO {
        Ok(())
    } else {
        Err("decimal must be positive")
    }
}
fn validate_nonnegative(value: &str) -> Result<(), &'static str> {
    let value: Decimal = value.parse().map_err(|_| "invalid decimal")?;
    if value >= Decimal::ZERO {
        Ok(())
    } else {
        Err("decimal must be nonnegative")
    }
}
fn validate_optional_positive(value: &Option<String>) -> Result<(), &'static str> {
    if let Some(value) = value {
        validate_positive(value)?;
    }
    Ok(())
}

impl AccountSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.account_login.trim().is_empty()
            || self.broker_server.trim().is_empty()
            || self.currency.trim().is_empty()
            || self.leverage == 0
        {
            return Err("invalid account identity");
        }
        let _: Decimal = self
            .balance
            .parse()
            .map_err(|_| "invalid account decimal")?;
        let _: Decimal = self.equity.parse().map_err(|_| "invalid account decimal")?;
        let margin: Decimal = self.margin.parse().map_err(|_| "invalid account decimal")?;
        let free_margin: Decimal = self
            .free_margin
            .parse()
            .map_err(|_| "invalid account decimal")?;
        let margin_level: Decimal = self
            .margin_level
            .parse()
            .map_err(|_| "invalid account decimal")?;
        if margin < Decimal::ZERO || free_margin < Decimal::ZERO || margin_level < Decimal::ZERO {
            return Err("invalid account values");
        }
        if !matches!(
            self.account_trade_mode_name.as_str(),
            "demo" | "contest" | "real" | "unknown"
        ) {
            return Err("invalid account trade mode name");
        }
        Ok(())
    }
}
