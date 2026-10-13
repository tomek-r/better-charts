use super::ExecutionSafetyStatus;
use serde::Serialize;
use trading_core::{
    execution::RecoveryEntry,
    margin_projection::MarginRisk,
    protocol::{
        AccountSnapshot, BrokerSymbol, MarketCandle, OpenPosition, OrderCommandError,
        OrderCommandUpdate, OrderKind, OrderSide, PendingOrder, PortfolioSnapshot, QuoteUpdate,
        TimeInForce,
    },
};

/// One page of older candles. Published on its own event rather than as a market
/// snapshot: the market snapshot is what the order ticket reads and what
/// `bar_update` staleness is judged against, so a page of old bars must never
/// replace it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPageView {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
    /// False when the broker had fewer candles left than the page asked for,
    /// which is how the frontend learns it reached the end of history.
    pub(crate) complete: bool,
    /// Echo of the anchor the page was requested from, so a page that arrives
    /// after a selection change cannot be prepended to the new series.
    pub(crate) before_ms: i64,
    pub(crate) candles: Vec<MarketCandle>,
}

/// The EA could not synchronize the requested chart series before its
/// deadline, so no candles will arrive for this selection. Non-fatal: the
/// session stays up and the frontend only reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryUnavailableView {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TickProfileBin {
    pub(crate) low: String,
    pub(crate) high: String,
    pub(crate) total: u64,
    pub(crate) bid: u64,
    pub(crate) ask: u64,
}

/// Where a profile's volumes come from: exact ticks, or the approximation
/// built from bars (bid series = down volume, ask series = up volume).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProfileSource {
    Ticks,
    Bars,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TickProfileResult {
    pub(crate) source: ProfileSource,
    /// Timeframe code of the bars behind a `bars` profile; `null` for ticks.
    pub(crate) bar_timeframe: Option<String>,
    /// Open time of the oldest bar behind a `bars` profile when the broker's
    /// history starts inside the requested range, so the profile does not
    /// cover its beginning; `null` when the whole range is covered (always
    /// for ticks).
    pub(crate) covered_from_ms: Option<i64>,
    pub(crate) symbol: String,
    pub(crate) from_ms: i64,
    pub(crate) end_ms: i64,
    pub(crate) complete: bool,
    pub(crate) rejected_ticks: u64,
    pub(crate) actual_rows: usize,
    pub(crate) total_weight: u64,
    pub(crate) poc: Option<String>,
    pub(crate) vah: Option<String>,
    pub(crate) val: Option<String>,
    pub(crate) bid_levels: Option<TickProfileLevels>,
    pub(crate) ask_levels: Option<TickProfileLevels>,
    pub(crate) bins: Vec<TickProfileBin>,
}

/// One histogram's POC/VAH/VAL prices for the frontend view; serialized as
/// JSON `null` when the mode carries no weight.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TickProfileLevels {
    pub(crate) poc: String,
    pub(crate) vah: String,
    pub(crate) val: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TickProfileProgress {
    pub(crate) symbol: String,
    pub(crate) from_ms: i64,
    pub(crate) end_ms: i64,
    pub(crate) completed_pages: usize,
    pub(crate) pending_pages: usize,
    pub(crate) loaded_ticks: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TickProfileError {
    pub(crate) symbol: String,
    pub(crate) from_ms: i64,
    pub(crate) end_ms: i64,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TickProfileCancelledView {
    pub(crate) symbol: String,
    pub(crate) from_ms: i64,
    pub(crate) end_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerSymbolView {
    pub(crate) symbol: String,
    pub(crate) description: String,
    pub(crate) digits: u32,
    pub(crate) tick_size: String,
    pub(crate) point_size: String,
    pub(crate) contract_size: String,
    pub(crate) tick_value_profit: Option<String>,
    pub(crate) tick_value_loss: Option<String>,
    pub(crate) tick_value_currency: Option<String>,
    pub(crate) volume_min: String,
    pub(crate) volume_max: String,
    pub(crate) volume_step: String,
    pub(crate) trade_mode: u32,
    pub(crate) stops_level: u32,
    pub(crate) freeze_level: u32,
    pub(crate) filling_mode: u32,
    pub(crate) order_mode: u32,
    pub(crate) expiration_mode: u32,
    pub(crate) trade_execution: u32,
}

impl From<BrokerSymbol> for BrokerSymbolView {
    fn from(value: BrokerSymbol) -> Self {
        Self {
            symbol: value.symbol,
            description: value.description,
            digits: value.digits,
            tick_size: value.tick_size,
            point_size: value.point_size,
            contract_size: value.contract_size,
            tick_value_profit: value.tick_value_profit,
            tick_value_loss: value.tick_value_loss,
            tick_value_currency: value.tick_value_currency,
            volume_min: value.volume_min,
            volume_max: value.volume_max,
            volume_step: value.volume_step,
            trade_mode: value.trade_mode,
            stops_level: value.stops_level,
            freeze_level: value.freeze_level,
            filling_mode: value.filling_mode,
            order_mode: value.order_mode,
            expiration_mode: value.expiration_mode,
            trade_execution: value.trade_execution,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SymbolSearchResultView {
    pub(crate) source: String,
    pub(crate) query: String,
    pub(crate) symbols: Vec<BrokerSymbolView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuoteView {
    pub(crate) symbol: String,
    pub(crate) time_ms: i64,
    pub(crate) bid: String,
    pub(crate) ask: String,
    pub(crate) last: String,
    pub(crate) volume: u64,
    pub(crate) volume_real: String,
    pub(crate) flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountView {
    pub(crate) account_login: String,
    pub(crate) broker_server: String,
    pub(crate) currency: String,
    pub(crate) currency_digits: u32,
    pub(crate) balance: String,
    pub(crate) equity: String,
    pub(crate) margin: String,
    pub(crate) free_margin: String,
    pub(crate) margin_level: String,
    pub(crate) leverage: u32,
    pub(crate) margin_mode: u32,
    pub(crate) trade_allowed: bool,
    pub(crate) expert_allowed: bool,
    /// Raw `ACCOUNT_TRADE_MODE` integer (`-1` = not reported by an older EA).
    pub(crate) account_trade_mode: i64,
    /// `demo` | `contest` | `real` | `unknown`; distinct from the
    /// instrument-level `trade_mode` of `symbol_info`.
    pub(crate) account_trade_mode_name: String,
    /// Margin-call level (`ACCOUNT_MARGIN_SO_CALL`): percent or account
    /// currency per `margin_levels_unit`; `null` when not reported.
    pub(crate) margin_call_level: Option<String>,
    /// Stop-out level (`ACCOUNT_MARGIN_SO_SO`), same unit as the call level.
    pub(crate) stop_out_level: Option<String>,
    /// Raw `ACCOUNT_MARGIN_SO_MODE`; `null` when not reported.
    pub(crate) margin_levels_mode: Option<i64>,
    /// `percent` | `money` | `unknown`.
    pub(crate) margin_levels_unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortfolioView {
    account_login: String,
    captured_at_ms: i64,
    positions: Vec<OpenPositionView>,
    orders: Vec<PendingOrderView>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenPositionView {
    position_id: String,
    ticket: String,
    symbol: String,
    side: OrderSide,
    volume: String,
    price_open: String,
    price_current: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    stop_loss_profit: Option<String>,
    take_profit_profit: Option<String>,
    profit: String,
    swap: String,
    time_ms: i64,
    magic: String,
    volume_min: Option<String>,
    volume_step: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingOrderView {
    order_id: String,
    symbol: String,
    order_type: String,
    state: String,
    volume_initial: String,
    volume_current: String,
    price_open: String,
    price_current: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    stop_loss_profit: Option<String>,
    take_profit_profit: Option<String>,
    time_setup_ms: i64,
    expiration_ms: Option<i64>,
    magic: String,
}
impl From<OpenPosition> for OpenPositionView {
    fn from(v: OpenPosition) -> Self {
        Self {
            position_id: v.position_id,
            ticket: v.ticket,
            symbol: v.symbol,
            side: v.side,
            volume: v.volume,
            price_open: v.price_open,
            price_current: v.price_current,
            stop_loss: v.stop_loss,
            take_profit: v.take_profit,
            stop_loss_profit: v.stop_loss_profit,
            take_profit_profit: v.take_profit_profit,
            profit: v.profit,
            swap: v.swap,
            time_ms: v.time_ms,
            magic: v.magic,
            volume_min: v.volume_min,
            volume_step: v.volume_step,
        }
    }
}
impl From<PendingOrder> for PendingOrderView {
    fn from(v: PendingOrder) -> Self {
        Self {
            order_id: v.order_id,
            symbol: v.symbol,
            order_type: v.order_type,
            state: v.state,
            volume_initial: v.volume_initial,
            volume_current: v.volume_current,
            price_open: v.price_open,
            price_current: v.price_current,
            stop_loss: v.stop_loss,
            take_profit: v.take_profit,
            stop_loss_profit: v.stop_loss_profit,
            take_profit_profit: v.take_profit_profit,
            time_setup_ms: v.time_setup_ms,
            expiration_ms: v.expiration_ms,
            magic: v.magic,
        }
    }
}
impl PortfolioView {
    /// Volume constraints of one cached position; `None` when the position is
    /// unknown or its EA did not report (valid) limits, so callers fail closed.
    pub(crate) fn partial_close_limits(
        &self,
        position_id: &str,
    ) -> Option<trading_core::partial_close::PartialCloseLimits> {
        let position = self
            .positions
            .iter()
            .find(|position| position.position_id == position_id)?;
        trading_core::partial_close::PartialCloseLimits::parse(
            &position.volume,
            position.volume_min.as_deref()?,
            position.volume_step.as_deref()?,
        )
        .ok()
    }
}
impl From<PortfolioSnapshot> for PortfolioView {
    fn from(v: PortfolioSnapshot) -> Self {
        Self {
            account_login: v.account_login,
            captured_at_ms: v.captured_at_ms,
            positions: v.positions.into_iter().map(Into::into).collect(),
            orders: v.orders.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RiskPreviewView {
    pub(crate) draft_version: u64,
    pub(crate) symbol: String,
    pub(crate) side: OrderSide,
    pub(crate) currency: String,
    pub(crate) entry: String,
    pub(crate) stop_loss: String,
    pub(crate) take_profit: Option<String>,
    pub(crate) risk_budget: String,
    pub(crate) volume: String,
    pub(crate) estimated_risk: String,
    pub(crate) estimated_margin: String,
    pub(crate) estimated_reward: Option<String>,
    pub(crate) rr: Option<String>,
    pub(crate) quoted_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RiskPreviewErrorView {
    pub(crate) draft_version: u64,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrderCheckResultView {
    pub(crate) draft_version: u64,
    pub(crate) draft_id: String,
    pub(crate) account_login: String,
    pub(crate) broker_server: String,
    pub(crate) symbol: String,
    pub(crate) side: OrderSide,
    pub(crate) order_kind: OrderKind,
    pub(crate) volume: String,
    pub(crate) requested_entry: String,
    pub(crate) check_price: String,
    /// Absent/null stop loss surfaces as `null` in the camelCase view.
    pub(crate) stop_loss: Option<String>,
    pub(crate) take_profit: Option<String>,
    pub(crate) check_passed: bool,
    pub(crate) retcode: u32,
    pub(crate) last_error: i32,
    pub(crate) balance: String,
    pub(crate) equity: String,
    pub(crate) profit: String,
    pub(crate) margin: String,
    pub(crate) free_margin: String,
    pub(crate) margin_level: String,
    pub(crate) comment: String,
    pub(crate) checked_at_ms: i64,
    /// Echo of the draft's time-in-force; `null` when the draft had none.
    pub(crate) time_in_force: Option<TimeInForce>,
    /// Echo of the draft's `limit_price`; `null` when the draft had none.
    pub(crate) limit_price: Option<String>,
    /// Estimated margin the order adds once filled (`OrderCalcMargin`, order
    /// priced in isolation); `null` when unknown.
    pub(crate) margin_at_fill: Option<String>,
    /// Account free margin minus `margin_at_fill`, as of the check; `null` when
    /// either is unknown.
    pub(crate) free_margin_after_fill: Option<String>,
    /// Projected margin level in percent (2 decimals); `null` when unknown or
    /// no margin would be in use.
    pub(crate) margin_level_after_fill: Option<String>,
    pub(crate) margin_risk: MarginRiskView,
}

/// Position of the projected state relative to the broker's thresholds.
/// Display-only: never feeds a dispatch gate.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MarginRiskView {
    Ok,
    BelowMarginCall,
    BelowStopOut,
    Unknown,
}

impl From<MarginRisk> for MarginRiskView {
    fn from(value: MarginRisk) -> Self {
        match value {
            MarginRisk::Ok => Self::Ok,
            MarginRisk::BelowMarginCall => Self::BelowMarginCall,
            MarginRisk::BelowStopOut => Self::BelowStopOut,
            MarginRisk::Unknown => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrderCheckErrorView {
    pub(crate) draft_version: u64,
    pub(crate) draft_id: String,
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionRecoverySnapshot {
    pub(crate) safety: ExecutionSafetyStatus,
    pub(crate) entries: Vec<RecoveryEntry>,
}

/// camelCase payload of the `execution-command-update` Tauri event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionCommandUpdateView {
    command_id: String,
    status: String,
    retcode: Option<i64>,
    broker_order_id: Option<String>,
    deal_id: Option<String>,
    position_id: Option<String>,
    filled_volume: Option<String>,
    message: Option<String>,
    updated_at_ms: i64,
    at_update: u64,
}

impl From<&OrderCommandUpdate> for ExecutionCommandUpdateView {
    fn from(value: &OrderCommandUpdate) -> Self {
        Self {
            command_id: value.command_id.clone(),
            status: value.status.clone(),
            retcode: value.retcode,
            broker_order_id: value.broker_order_id.clone(),
            deal_id: value.deal_id.clone(),
            position_id: value.position_id.clone(),
            filled_volume: value.filled_volume.clone(),
            message: value.message.clone(),
            updated_at_ms: value.updated_at_ms,
            at_update: value.at_update,
        }
    }
}

/// camelCase payload of the `execution-command-error` Tauri event. Command
/// errors are bound to their command and never tear the session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionCommandErrorView {
    command_id: String,
    code: String,
    message: String,
}

impl From<&OrderCommandError> for ExecutionCommandErrorView {
    fn from(value: &OrderCommandError) -> Self {
        Self {
            command_id: value.command_id.clone(),
            code: value.code.clone(),
            message: value.message.clone(),
        }
    }
}

impl From<AccountSnapshot> for AccountView {
    fn from(value: AccountSnapshot) -> Self {
        Self {
            account_login: value.account_login,
            broker_server: value.broker_server,
            currency: value.currency,
            currency_digits: value.currency_digits,
            balance: value.balance,
            equity: value.equity,
            margin: value.margin,
            free_margin: value.free_margin,
            margin_level: value.margin_level,
            leverage: value.leverage,
            margin_mode: value.margin_mode,
            trade_allowed: value.trade_allowed,
            expert_allowed: value.expert_allowed,
            account_trade_mode: value.account_trade_mode,
            account_trade_mode_name: value.account_trade_mode_name,
            margin_call_level: value.margin_call_level,
            stop_out_level: value.stop_out_level,
            margin_levels_mode: value.margin_levels_mode,
            margin_levels_unit: value.margin_levels_unit,
        }
    }
}

impl From<QuoteUpdate> for QuoteView {
    fn from(value: QuoteUpdate) -> Self {
        Self {
            symbol: value.symbol,
            time_ms: value.time_ms,
            bid: value.bid,
            ask: value.ask,
            last: value.last,
            volume: value.volume,
            volume_real: value.volume_real,
            flags: value.flags,
        }
    }
}
