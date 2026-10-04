use serde::Serialize;

use super::registry::ExecutionRecord;
use super::types::*;

/// Read-only presentation of a persisted execution record. The lifecycle
/// state uses its stable snake_case wire spelling while the rest of this DTO
/// follows the desktop camelCase contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub command_id: String,
    pub account_login: String,
    pub broker_server: String,
    pub state: String,
    pub recovery_status: &'static str,
    pub operation: RecoveryOperation,
    pub updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broker_order_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retcode: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecoveryOperation {
    PlaceOrder {
        symbol: String,
        side: OrderSide,
        #[serde(rename = "orderKind")]
        order_kind: OrderKind,
        volume: String,
        entry: String,
        #[serde(rename = "stopLoss")]
        stop_loss: Option<String>,
        #[serde(rename = "takeProfit")]
        take_profit: Option<String>,
    },
    ModifyOrder {
        #[serde(rename = "targetKind")]
        target_kind: TargetKind,
        #[serde(rename = "targetId")]
        target_id: String,
        #[serde(rename = "stopLoss")]
        stop_loss: Option<String>,
        #[serde(rename = "takeProfit")]
        take_profit: Option<String>,
        price: Option<String>,
    },
    CloseOrder {
        #[serde(rename = "positionId")]
        position_id: String,
        volume: Option<String>,
    },
    CancelOrder {
        #[serde(rename = "orderId")]
        order_id: String,
    },
}

impl RecoveryEntry {
    pub(super) fn from_record(record: &ExecutionRecord) -> Self {
        let intent = &record.intent;
        let state = record.state();
        let latest = record
            .events
            .last()
            .expect("registered records have an event");
        let latest_value = |select: fn(&ExecutionEvent) -> Option<&String>| {
            record.events.iter().rev().find_map(select).cloned()
        };
        let latest_retcode = record.events.iter().rev().find_map(|event| event.retcode);
        let recovery_status = recovery_status(state);
        let operation = match intent.operation() {
            ExecutionOperation::PlaceOrder(order) => RecoveryOperation::PlaceOrder {
                symbol: order.symbol.clone(),
                side: order.side,
                order_kind: order.kind,
                volume: order.volume.clone(),
                entry: order.entry.clone(),
                stop_loss: order.stop_loss.clone(),
                take_profit: order.take_profit.clone(),
            },
            ExecutionOperation::ModifyOrder(modify) => RecoveryOperation::ModifyOrder {
                target_kind: modify.target_kind,
                target_id: modify.target_id.clone(),
                stop_loss: modify.stop_loss.clone(),
                take_profit: modify.take_profit.clone(),
                price: modify.price.clone(),
            },
            ExecutionOperation::CloseOrder(close) => RecoveryOperation::CloseOrder {
                position_id: close.position_id.clone(),
                volume: close.volume.clone(),
            },
            ExecutionOperation::CancelOrder(cancel) => RecoveryOperation::CancelOrder {
                order_id: cancel.order_id.clone(),
            },
        };
        Self {
            command_id: intent.command_id().to_owned(),
            account_login: intent.account_login().to_owned(),
            broker_server: intent.broker_server().to_owned(),
            state: state.as_snake_case().to_owned(),
            recovery_status,
            operation,
            updated_at_ms: latest.at_ms,
            broker_order_id: latest_value(|event| event.broker_order_id.as_ref()),
            deal_id: latest_value(|event| event.broker_deal_id.as_ref()),
            position_id: latest_value(|event| event.broker_position_id.as_ref()),
            retcode: latest_retcode,
        }
    }
}

fn recovery_status(state: ExecutionState) -> &'static str {
    match state {
        ExecutionState::Prepared => "recovery_required",
        ExecutionState::Validated => "validated_local",
        ExecutionState::Dispatching | ExecutionState::Unknown => "recovery_required",
        ExecutionState::ServerAccepted => "broker_accepted",
        ExecutionState::PartiallyFilled => "partially_filled",
        ExecutionState::Filled => "filled",
        ExecutionState::Rejected => "rejected",
    }
}

impl ExecutionState {
    pub(super) fn as_snake_case(self) -> &'static str {
        match self {
            Self::Prepared => "prepared",
            Self::Validated => "validated",
            Self::Dispatching => "dispatching",
            Self::ServerAccepted => "server_accepted",
            Self::PartiallyFilled => "partially_filled",
            Self::Filled => "filled",
            Self::Rejected => "rejected",
            Self::Unknown => "unknown",
        }
    }
}
