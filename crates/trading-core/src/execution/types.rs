use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer, Serialize};

use super::error::*;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ValidationMode {
    Fresh,
    Replay,
}

/// The immutable request registered under one command ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecutionIntent {
    pub(super) command_id: String,
    pub(super) account_login: String,
    pub(super) broker_server: String,
    pub(super) operation: ExecutionOperation,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct RawExecutionIntent {
    command_id: String,
    account_login: String,
    broker_server: String,
    operation: ExecutionOperation,
}

impl<'de> Deserialize<'de> for ExecutionIntent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawExecutionIntent::deserialize(deserializer)?;
        Self::construct(
            raw.command_id,
            raw.account_login,
            raw.broker_server,
            raw.operation,
            ValidationMode::Replay,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl ExecutionIntent {
    pub fn new(
        command_id: impl Into<String>,
        account_login: impl Into<String>,
        broker_server: impl Into<String>,
        operation: ExecutionOperation,
    ) -> Result<Self, ExecutionError> {
        Self::construct(
            command_id,
            account_login,
            broker_server,
            operation,
            ValidationMode::Fresh,
        )
    }

    fn construct(
        command_id: impl Into<String>,
        account_login: impl Into<String>,
        broker_server: impl Into<String>,
        operation: ExecutionOperation,
        validation_mode: ValidationMode,
    ) -> Result<Self, ExecutionError> {
        let command_id = command_id.into();
        let account_login = account_login.into();
        let broker_server = broker_server.into();
        bounded_identity("command_id", &command_id, MAX_COMMAND_ID)?;
        bounded_identity("account_login", &account_login, MAX_COMMAND_ID)?;
        bounded_identity("broker_server", &broker_server, MAX_SERVER)?;
        if let Err(error) = operation.validate() {
            // Historical stop-limit journals used the trigger for geometry.
            // Replay accepts that established contract as well as fresh intents.
            match &operation {
                ExecutionOperation::PlaceOrder(order)
                    if validation_mode == ValidationMode::Replay
                        && order.kind == OrderKind::StopLimit =>
                {
                    order.validate_with_reference(ValidationMode::Replay)?;
                }
                _ => return Err(error),
            }
        }
        Ok(Self {
            command_id,
            account_login,
            broker_server,
            operation,
        })
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }
    pub fn account_login(&self) -> &str {
        &self.account_login
    }
    pub fn broker_server(&self) -> &str {
        &self.broker_server
    }
    pub fn operation(&self) -> &ExecutionOperation {
        &self.operation
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionOperation {
    PlaceOrder(PlaceOrder),
    ModifyOrder(ModifyOrder),
    CloseOrder(CloseOrder),
    CancelOrder(CancelOrder),
}

impl ExecutionOperation {
    fn validate(&self) -> Result<(), ExecutionError> {
        match self {
            Self::PlaceOrder(order) => order.validate(),
            Self::ModifyOrder(order) => order.validate(),
            Self::CloseOrder(order) => order.validate(),
            Self::CancelOrder(order) => order.validate(),
        }
    }
}

/// Values remain decimal strings so the command payload does not inherit a
/// floating-point representation or silently change its serialized spelling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PlaceOrder {
    pub symbol: String,
    pub side: OrderSide,
    pub kind: OrderKind,
    pub volume: String,
    pub entry: String,
    /// Optional Stop Loss; absent or `null` = no stop loss. SL-specific
    /// rules (direction vs entry) apply only when present. A journaled
    /// present value serializes byte-identically to the required-field era.
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    /// Time-in-force of the journaled submission; `None` (also what old
    /// journals deserialize to) means `gtc`, the pre-extension behavior.
    /// Serialized only when set, so a `gtc` intent keeps its old bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_in_force: Option<crate::protocol::TimeInForce>,
    /// Resting limit price, required iff `kind == StopLimit`; `entry` then
    /// carries the stop trigger price. Same absent-means-old-behavior rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_price: Option<String>,
}

impl PlaceOrder {
    pub fn validate(&self) -> Result<(), ExecutionError> {
        self.validate_with_reference(ValidationMode::Fresh)
    }

    fn validate_with_reference(
        &self,
        validation_mode: ValidationMode,
    ) -> Result<(), ExecutionError> {
        bounded_identity("symbol", &self.symbol, MAX_SYMBOL)?;
        let volume = positive_decimal("volume", &self.volume)?;
        positive_decimal("entry", &self.entry)?;
        let stop_loss = self
            .stop_loss
            .as_deref()
            .map(|value| positive_decimal("stop_loss", value))
            .transpose()?;
        let take_profit = self
            .take_profit
            .as_deref()
            .map(|s| positive_decimal("take_profit", s))
            .transpose()?;

        if volume <= Decimal::ZERO {
            return Err(ExecutionError::InvalidField(
                "volume must be greater than zero",
            ));
        }
        let reference =
            if self.kind == OrderKind::StopLimit && validation_mode == ValidationMode::Fresh {
                let limit_price =
                    self.limit_price
                        .as_deref()
                        .ok_or(ExecutionError::InvalidField(
                            "stop_limit requires limit_price (resting limit price)",
                        ))?;
                positive_decimal("limit_price", limit_price)?
            } else {
                positive_decimal("entry", &self.entry)?
            };
        // SL-specific direction rules apply only when a stop loss is present;
        // an absent stop loss means the order carries no SL level at all.
        if let Some(stop_loss) = stop_loss {
            let entry = reference;
            match self.side {
                OrderSide::Buy if stop_loss >= entry => {
                    return Err(ExecutionError::InvalidField(
                        "buy stop_loss must be below entry",
                    ))
                }
                OrderSide::Sell if stop_loss <= entry => {
                    return Err(ExecutionError::InvalidField(
                        "sell stop_loss must be above entry",
                    ))
                }
                _ => {}
            }
        }
        if let Some(tp) = take_profit {
            let entry = reference;
            match self.side {
                OrderSide::Buy if tp <= entry => {
                    return Err(ExecutionError::InvalidField(
                        "buy take_profit must be above entry",
                    ))
                }
                OrderSide::Sell if tp >= entry => {
                    return Err(ExecutionError::InvalidField(
                        "sell take_profit must be below entry",
                    ))
                }
                _ => {}
            }
        }
        // Market requests still carry an entry reference for validation/audit.
        // Limit/stop relative-to-market constraints require a live quote and are
        // therefore left to a broker-side preflight check.
        match self.kind {
            OrderKind::StopLimit => {
                let limit_price =
                    self.limit_price
                        .as_deref()
                        .ok_or(ExecutionError::InvalidField(
                            "stop_limit requires limit_price (resting limit price)",
                        ))?;
                positive_decimal("limit_price", limit_price)?;
            }
            _ => {
                // Ignored for the other kinds, but a present value must still
                // be a well-formed positive decimal.
                if let Some(limit_price) = &self.limit_price {
                    positive_decimal("limit_price", limit_price)?;
                }
            }
        }
        Ok(())
    }
}

/// Target of a modify command: an open position never carries a price change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    Position,
    PendingOrder,
}

/// Values remain decimal strings so the command payload does not inherit a
/// floating-point representation or silently change its serialized spelling.
/// `None` on `stop_loss`/`take_profit`/`price` means "leave that level
/// unchanged". A positive decimal string sets an SL/TP; the decimal string
/// "0" removes it. `price`, when supplied, must remain positive and applies
/// only to pending orders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ModifyOrder {
    pub target_kind: TargetKind,
    pub target_id: String,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub price: Option<String>,
}

impl ModifyOrder {
    pub fn validate(&self) -> Result<(), ExecutionError> {
        bounded_identity("target_id", &self.target_id, MAX_BROKER_ID)?;
        // SL/TP accept the "0" remove sentinel (see level_decimal).
        if let Some(stop_loss) = &self.stop_loss {
            level_decimal("stop_loss", stop_loss)?;
        }
        if let Some(take_profit) = &self.take_profit {
            level_decimal("take_profit", take_profit)?;
        }
        if let Some(price) = &self.price {
            // Repricing applies only to a resting pending order; an open
            // position has no price of its own to change.
            if self.target_kind == TargetKind::Position {
                return Err(ExecutionError::InvalidField(
                    "price requires a pending_order target",
                ));
            }
            positive_decimal("price", price)?;
        }
        if self.stop_loss.is_none() && self.take_profit.is_none() && self.price.is_none() {
            return Err(ExecutionError::InvalidField(
                "modify requires stop_loss, take_profit, or price",
            ));
        }
        Ok(())
    }
}

/// Closing volume for a position; `None` means the full position (the MVP
/// never sends a partial close).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CloseOrder {
    pub position_id: String,
    pub volume: Option<String>,
}

impl CloseOrder {
    pub fn validate(&self) -> Result<(), ExecutionError> {
        bounded_identity("position_id", &self.position_id, MAX_BROKER_ID)?;
        if let Some(volume) = &self.volume {
            positive_decimal("volume", volume)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CancelOrder {
    pub order_id: String,
}

impl CancelOrder {
    pub fn validate(&self) -> Result<(), ExecutionError> {
        bounded_identity("order_id", &self.order_id, MAX_BROKER_ID)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    /// MT5 `ORDER_TYPE_STOP_LIMIT` pending order (wire `stop_limit`).
    StopLimit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    Prepared,
    Validated,
    Dispatching,
    ServerAccepted,
    PartiallyFilled,
    Filled,
    Rejected,
    Unknown,
}

impl ExecutionState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Filled | Self::Rejected)
    }

    pub(super) fn permits(self, next: Self) -> bool {
        use ExecutionState::*;
        match self {
            Prepared => matches!(next, Validated | Rejected | Unknown),
            // Pre-dispatch failures stay accepted-with-error (bridge-v1), so
            // `rejected` is reachable only from dispatching onwards.
            Validated => matches!(next, Dispatching | Unknown),
            Dispatching => matches!(
                next,
                ServerAccepted | PartiallyFilled | Filled | Rejected | Unknown
            ),
            // Settled for the dispatch queue, but NOT terminal: later fills
            // of the resulting pending order may still advance the record.
            ServerAccepted => matches!(next, PartiallyFilled | Filled | Rejected | Unknown),
            PartiallyFilled => matches!(next, PartiallyFilled | Filled | Unknown),
            // Unknown is resolved only by new broker evidence; it never returns
            // to Dispatching, which would risk submitting the same order twice.
            Unknown => matches!(next, ServerAccepted | PartiallyFilled | Filled | Rejected),
            Filled | Rejected => false,
        }
    }
}

/// One journaled lifecycle fact of a command.
///
/// Forward compatibility: old journals must keep replaying, so journaled
/// field names are never renamed or removed — the wire names `deal_id` /
/// `position_id` live on [`ExecutionUpdate`] while this event keeps its
/// historical `broker_*` spellings. New [`ExecutionOperation`] variants break
/// old readers (serde rejects the unknown variant) and require bumping
/// [`SCHEMA_VERSION`] together with a journal migration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecutionEvent {
    pub at_ms: u64,
    pub state: ExecutionState,
    pub broker_order_id: Option<String>,
    pub broker_deal_id: Option<String>,
    pub broker_position_id: Option<String>,
    pub retcode: Option<i64>,
    /// Broker `last_error` code carried by one command update.
    #[serde(default)]
    pub last_error: Option<i64>,
    /// Filled volume of a partial-fill event/update, as a decimal string.
    #[serde(default)]
    pub filled_volume: Option<String>,
    pub message: Option<String>,
}

impl ExecutionEvent {
    pub fn new(at_ms: u64, state: ExecutionState) -> Self {
        Self {
            at_ms,
            state,
            broker_order_id: None,
            broker_deal_id: None,
            broker_position_id: None,
            retcode: None,
            last_error: None,
            filled_volume: None,
            message: None,
        }
    }

    pub fn with_broker_ids(
        mut self,
        order: Option<String>,
        deal: Option<String>,
        position: Option<String>,
    ) -> Result<Self, ExecutionError> {
        for (name, value) in [
            ("broker_order_id", &order),
            ("broker_deal_id", &deal),
            ("broker_position_id", &position),
        ] {
            if let Some(value) = value {
                bounded_identity(name, value, MAX_BROKER_ID)?;
            }
        }
        self.broker_order_id = order;
        self.broker_deal_id = deal;
        self.broker_position_id = position;
        Ok(self)
    }

    pub fn with_result(
        mut self,
        retcode: Option<i64>,
        message: Option<String>,
    ) -> Result<Self, ExecutionError> {
        if let Some(message) = &message {
            validate_message(message)?;
        }
        self.retcode = retcode;
        self.message = message;
        Ok(self)
    }

    pub(super) fn has_broker_evidence(&self) -> bool {
        self.broker_order_id.is_some()
            || self.broker_deal_id.is_some()
            || self.broker_position_id.is_some()
            || self.retcode.is_some()
    }

    pub(super) fn validate(&self) -> Result<(), ExecutionError> {
        for (name, value) in [
            ("broker_order_id", &self.broker_order_id),
            ("broker_deal_id", &self.broker_deal_id),
            ("broker_position_id", &self.broker_position_id),
        ] {
            if let Some(value) = value {
                bounded_identity(name, value, MAX_BROKER_ID)?;
            }
        }
        if let Some(message) = &self.message {
            validate_message(message)?;
        }
        if let Some(volume) = &self.filled_volume {
            positive_decimal("filled_volume", volume)?;
        }
        Ok(())
    }
}

/// Wire status vocabulary of a single order command update. `Accepted` is the
/// command journaled and validated for dispatch, which this machine models as
/// [`ExecutionState::Validated`] (its local acceptance state).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Accepted,
    Dispatching,
    ServerAccepted,
    PartiallyFilled,
    Filled,
    Rejected,
    Unknown,
}

impl CommandStatus {
    pub fn execution_state(self) -> ExecutionState {
        match self {
            Self::Accepted => ExecutionState::Validated,
            Self::Dispatching => ExecutionState::Dispatching,
            Self::ServerAccepted => ExecutionState::ServerAccepted,
            Self::PartiallyFilled => ExecutionState::PartiallyFilled,
            Self::Filled => ExecutionState::Filled,
            Self::Rejected => ExecutionState::Rejected,
            Self::Unknown => ExecutionState::Unknown,
        }
    }
}

/// Field payload of one command update, minus `command_id` and `at_update`;
/// the registry owns the per-command ordering of those two.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecutionUpdate {
    pub status: CommandStatus,
    pub retcode: Option<i64>,
    pub last_error: Option<i64>,
    pub broker_order_id: Option<String>,
    /// Wire name matches `order_command_update`; the journaled
    /// [`ExecutionEvent`] keeps its historical `broker_deal_id` spelling.
    pub deal_id: Option<String>,
    /// Wire name matches `order_command_update`; the journaled
    /// [`ExecutionEvent`] keeps its historical `broker_position_id` spelling.
    pub position_id: Option<String>,
    pub filled_volume: Option<String>,
    pub message: Option<String>,
    pub updated_at_ms: i64,
}

/// Broker evidence gathered by reconciliation: broker IDs or a retcode the
/// terminal actually returned. Never fabricated locally; without it nothing
/// may leave `Unknown`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BrokerEvidence {
    pub broker_order_id: Option<String>,
    pub broker_deal_id: Option<String>,
    pub broker_position_id: Option<String>,
    pub retcode: Option<i64>,
}

/// Outcome a broker-evidence reconciliation may assign to a command stuck in
/// [`ExecutionState::Unknown`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnknownResolution {
    /// Evidence proves the command fully filled.
    Filled,
    /// Evidence proves the broker rejected the command.
    Rejected,
    /// Evidence proves a partial fill; `volume` is the filled part.
    Partial { volume: String },
    /// Evidence proves a limit/stop order is still resting at the server.
    Resting,
}

impl UnknownResolution {
    pub(super) fn execution_state(&self) -> ExecutionState {
        match self {
            Self::Filled => ExecutionState::Filled,
            Self::Rejected => ExecutionState::Rejected,
            Self::Partial { .. } => ExecutionState::PartiallyFilled,
            Self::Resting => ExecutionState::ServerAccepted,
        }
    }
}
