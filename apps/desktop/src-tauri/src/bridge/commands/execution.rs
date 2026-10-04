//! Gated order submission surface: the dispatch gate, the session
//! account-binding check, the durable intent builders and the four
//! submit/modify/close/cancel command families, plus the execution
//! safety, queue and recovery readers.

use super::super::{
    now_ms, BridgeConnectionState, BridgeState, ExecutionAdapterState, ExecutionQueueView,
    ExecutionRecoverySnapshot, ExecutionSafetyState, ExecutionSafetyStatus, MessageType,
    OrderCancelRequest, OrderCloseRequest, OrderModifyRequest, OrderSubmitRequest, PendingCommand,
    State,
};
use super::parse_time_in_force;

#[tauri::command]
pub(crate) fn get_execution_safety_status(
    state: State<'_, ExecutionSafetyState>,
    adapter: State<'_, ExecutionAdapterState>,
) -> ExecutionSafetyStatus {
    adapter.with_trading_permission(state.status())
}

#[tauri::command]
pub(crate) fn get_execution_queue_status(
    state: State<'_, ExecutionAdapterState>,
) -> ExecutionQueueView {
    state.queue_status()
}

/// Session + account identity check shared by the four gated submission
/// commands; runs after the dispatch gate so the validation path stays
/// exercised whenever the gate is (or becomes) open.
pub(crate) fn require_active_session_account(
    bridge: &BridgeState,
    account_login: &str,
    broker_server: &str,
) -> Result<String, String> {
    let status = bridge
        .status
        .lock()
        .map_err(|_| "bridge status unavailable".to_string())?
        .clone();
    let session_id = bridge
        .current_session
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?
        .clone()
        .ok_or_else(|| "bridge is not connected".to_string())?;
    let account = bridge
        .account
        .lock()
        .map_err(|_| "account snapshot unavailable".to_string())?
        .clone()
        .ok_or_else(|| "account snapshot is unavailable".to_string())?;
    if status.state != BridgeConnectionState::Connected
        || status.account.as_deref() != Some(account_login)
        || status.server.as_deref() != Some(broker_server)
        || account.account_login != account_login
        || account.broker_server != broker_server
    {
        return Err("requested account does not match account snapshot".into());
    }
    Ok(session_id)
}

/// Market-session gate for order submission (scope A: submit only). Requires
/// the most recent EA observation to be for the same symbol and to report an
/// open trade session. A missing, stale-after-session-end, or mismatched
/// observation fails closed. Modify/close/cancel are intentionally not
/// gated here: they reduce or adjust existing exposure, and their targets are
/// not bound to the active chart symbol.
pub(crate) fn require_market_open(bridge: &BridgeState, symbol: &str) -> Result<(), String> {
    let status = bridge
        .status
        .lock()
        .map_err(|_| "bridge status unavailable".to_string())?;
    let Some(session) = status.market_session.as_ref() else {
        return Err("market session is unavailable".into());
    };
    if session.symbol != symbol {
        return Err("market session is unavailable for this symbol".into());
    }
    if session.is_open {
        Ok(())
    } else {
        Err("market is closed for this symbol".into())
    }
}

/// Builds the durable registry intent for one submit request.
pub(crate) fn execution_intent(
    command_id: &str,
    request: &OrderSubmitRequest,
) -> Result<trading_core::execution::ExecutionIntent, String> {
    use trading_core::execution::{
        ExecutionIntent, ExecutionOperation, OrderKind as ExecutionOrderKind,
        OrderSide as ExecutionOrderSide, PlaceOrder,
    };
    let side = match request.side.as_str() {
        "buy" => ExecutionOrderSide::Buy,
        "sell" => ExecutionOrderSide::Sell,
        _ => return Err("invalid order side".into()),
    };
    let kind = match request.order_kind.as_str() {
        "market" => ExecutionOrderKind::Market,
        "limit" => ExecutionOrderKind::Limit,
        "stop" => ExecutionOrderKind::Stop,
        "stop_limit" => ExecutionOrderKind::StopLimit,
        _ => return Err("invalid order kind".into()),
    };
    ExecutionIntent::new(
        command_id,
        request.account_login.clone(),
        request.broker_server.clone(),
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: request.symbol.clone(),
            side,
            kind,
            volume: request.volume.clone(),
            entry: request.entry.clone(),
            stop_loss: request.stop_loss.clone(),
            take_profit: request.take_profit.clone(),
            time_in_force: parse_time_in_force(request.time_in_force.clone())?,
            limit_price: request.limit_price.clone(),
        }),
    )
    .map_err(|error| error.to_string())
}

/// Durable registry intent for one modify request.
pub(crate) fn modify_execution_intent(
    command_id: &str,
    request: &OrderModifyRequest,
) -> Result<trading_core::execution::ExecutionIntent, String> {
    use trading_core::execution::{ExecutionIntent, ExecutionOperation, ModifyOrder, TargetKind};
    let target_kind = match request.target_kind.as_str() {
        "position" => TargetKind::Position,
        "pending_order" => TargetKind::PendingOrder,
        _ => return Err("invalid order modify target".into()),
    };
    ExecutionIntent::new(
        command_id,
        request.account_login.clone(),
        request.broker_server.clone(),
        ExecutionOperation::ModifyOrder(ModifyOrder {
            target_kind,
            target_id: request.target_id.clone(),
            stop_loss: request.stop_loss.clone(),
            take_profit: request.take_profit.clone(),
            price: request.price.clone(),
        }),
    )
    .map_err(|error| error.to_string())
}

/// Durable registry intent for one close request (`None` volume = full close).
pub(crate) fn close_execution_intent(
    command_id: &str,
    request: &OrderCloseRequest,
) -> Result<trading_core::execution::ExecutionIntent, String> {
    use trading_core::execution::{CloseOrder, ExecutionIntent, ExecutionOperation};
    ExecutionIntent::new(
        command_id,
        request.account_login.clone(),
        request.broker_server.clone(),
        ExecutionOperation::CloseOrder(CloseOrder {
            position_id: request.position_id.clone(),
            volume: request.volume.clone(),
        }),
    )
    .map_err(|error| error.to_string())
}

/// Durable registry intent for one cancel request.
pub(crate) fn cancel_execution_intent(
    command_id: &str,
    request: &OrderCancelRequest,
) -> Result<trading_core::execution::ExecutionIntent, String> {
    use trading_core::execution::{CancelOrder, ExecutionIntent, ExecutionOperation};
    ExecutionIntent::new(
        command_id,
        request.account_login.clone(),
        request.broker_server.clone(),
        ExecutionOperation::CancelOrder(CancelOrder {
            order_id: request.order_id.clone(),
        }),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn submit_order(
    bridge: State<'_, BridgeState>,
    adapter: State<'_, ExecutionAdapterState>,
    draft_id: String,
    account_login: String,
    broker_server: String,
    symbol: String,
    side: String,
    order_kind: String,
    volume: String,
    entry: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    time_in_force: Option<String>,
    limit_price: Option<String>,
) -> Result<(), String> {
    submit_order_inner(
        &bridge,
        &adapter,
        draft_id,
        account_login,
        broker_server,
        symbol,
        side,
        order_kind,
        volume,
        entry,
        stop_loss,
        take_profit,
        time_in_force,
        limit_price,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn submit_order_inner(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    draft_id: String,
    account_login: String,
    broker_server: String,
    symbol: String,
    side: String,
    order_kind: String,
    volume: String,
    entry: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    time_in_force: Option<String>,
    limit_price: Option<String>,
) -> Result<(), String> {
    adapter.submission_gate()?;
    queue_submit_order(
        bridge,
        adapter,
        draft_id,
        account_login,
        broker_server,
        symbol,
        side,
        order_kind,
        volume,
        entry,
        stop_loss,
        take_profit,
        time_in_force,
        limit_price,
    )
}

/// Validation + durable registration + enqueue for one submit command.
/// Reached only after the app submission gate passes.
#[allow(clippy::too_many_arguments)]
pub(crate) fn queue_submit_order(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    draft_id: String,
    account_login: String,
    broker_server: String,
    symbol: String,
    side: String,
    order_kind: String,
    volume: String,
    entry: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    time_in_force: Option<String>,
    limit_price: Option<String>,
) -> Result<(), String> {
    let _session_work = bridge
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let session_id = require_active_session_account(bridge, &account_login, &broker_server)?;
    let active_symbol = bridge
        .market
        .lock()
        .map_err(|_| "market snapshot unavailable".to_string())?
        .symbol
        .clone()
        .ok_or_else(|| "market snapshot is unavailable".to_string())?;
    if active_symbol != symbol {
        return Err("order symbol does not match active chart".into());
    }
    // Market-session gate: never open new exposure while the broker's trade
    // session for this symbol is closed (weekends, outside trading hours).
    require_market_open(bridge, &symbol)?;
    // F-7: one clock sample per enqueue keeps `at_ms` and the id's
    // unix-ms component consistent.
    let now = now_ms();
    let at_ms = now.max(0) as u64;
    let command_id = adapter.next_command_id(now);
    let request = OrderSubmitRequest {
        command_id: command_id.clone(),
        draft_id,
        account_login,
        broker_server,
        symbol,
        side,
        order_kind,
        volume,
        entry,
        stop_loss,
        take_profit,
        time_in_force,
        limit_price,
    };
    request.validate().map_err(str::to_owned)?;
    let intent = execution_intent(&command_id, &request)?;
    let payload = serde_json::to_value(&request).map_err(|error| error.to_string())?;
    adapter
        .enqueue_for_session(
            &session_id,
            PendingCommand {
                command_id,
                message_type: MessageType::OrderSubmitRequest,
                payload,
            },
            Some(intent),
            at_ms,
        )
        .map_err(|error| error.to_string())?;
    bridge.wake_outbound();
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn modify_order(
    bridge: State<'_, BridgeState>,
    adapter: State<'_, ExecutionAdapterState>,
    account_login: String,
    broker_server: String,
    target_kind: String,
    target_id: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    price: Option<String>,
) -> Result<(), String> {
    modify_order_inner(
        &bridge,
        &adapter,
        account_login,
        broker_server,
        target_kind,
        target_id,
        stop_loss,
        take_profit,
        price,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn modify_order_inner(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    account_login: String,
    broker_server: String,
    target_kind: String,
    target_id: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    price: Option<String>,
) -> Result<(), String> {
    adapter.submission_gate()?;
    queue_modify_order(
        bridge,
        adapter,
        account_login,
        broker_server,
        target_kind,
        target_id,
        stop_loss,
        take_profit,
        price,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn queue_modify_order(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    account_login: String,
    broker_server: String,
    target_kind: String,
    target_id: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    price: Option<String>,
) -> Result<(), String> {
    let _session_work = bridge
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let session_id = require_active_session_account(bridge, &account_login, &broker_server)?;
    // F-7: one clock sample per enqueue (id and durable registration time).
    let now = now_ms();
    let command_id = adapter.next_command_id(now);
    let request = OrderModifyRequest {
        command_id: command_id.clone(),
        account_login,
        broker_server,
        target_kind,
        target_id,
        stop_loss,
        take_profit,
        price,
    };
    request.validate().map_err(str::to_owned)?;
    let intent = modify_execution_intent(&command_id, &request)?;
    let payload = serde_json::to_value(&request).map_err(|error| error.to_string())?;
    adapter
        .enqueue_for_session(
            &session_id,
            PendingCommand {
                command_id,
                message_type: MessageType::OrderModifyRequest,
                payload,
            },
            Some(intent),
            now.max(0) as u64,
        )
        .map_err(|error| error.to_string())?;
    bridge.wake_outbound();
    Ok(())
}

#[tauri::command]
pub(crate) fn close_position(
    bridge: State<'_, BridgeState>,
    adapter: State<'_, ExecutionAdapterState>,
    account_login: String,
    broker_server: String,
    position_id: String,
    volume: Option<String>,
) -> Result<(), String> {
    close_position_inner(
        &bridge,
        &adapter,
        account_login,
        broker_server,
        position_id,
        volume,
    )
}

pub(crate) fn close_position_inner(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    account_login: String,
    broker_server: String,
    position_id: String,
    volume: Option<String>,
) -> Result<(), String> {
    adapter.submission_gate()?;
    queue_close_position(
        bridge,
        adapter,
        account_login,
        broker_server,
        position_id,
        volume,
    )
}

pub(crate) fn queue_close_position(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    account_login: String,
    broker_server: String,
    position_id: String,
    volume: Option<String>,
) -> Result<(), String> {
    let _session_work = bridge
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let session_id = require_active_session_account(bridge, &account_login, &broker_server)?;
    // F-7: one clock sample per enqueue (id and durable registration time).
    let now = now_ms();
    let command_id = adapter.next_command_id(now);
    let request = OrderCloseRequest {
        command_id: command_id.clone(),
        account_login,
        broker_server,
        position_id,
        volume,
    };
    request.validate().map_err(str::to_owned)?;
    let intent = close_execution_intent(&command_id, &request)?;
    let payload = serde_json::to_value(&request).map_err(|error| error.to_string())?;
    adapter
        .enqueue_for_session(
            &session_id,
            PendingCommand {
                command_id,
                message_type: MessageType::OrderCloseRequest,
                payload,
            },
            Some(intent),
            now.max(0) as u64,
        )
        .map_err(|error| error.to_string())?;
    bridge.wake_outbound();
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_order(
    bridge: State<'_, BridgeState>,
    adapter: State<'_, ExecutionAdapterState>,
    account_login: String,
    broker_server: String,
    order_id: String,
) -> Result<(), String> {
    cancel_order_inner(&bridge, &adapter, account_login, broker_server, order_id)
}

pub(crate) fn cancel_order_inner(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    account_login: String,
    broker_server: String,
    order_id: String,
) -> Result<(), String> {
    adapter.submission_gate()?;
    queue_cancel_order(bridge, adapter, account_login, broker_server, order_id)
}

pub(crate) fn queue_cancel_order(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    account_login: String,
    broker_server: String,
    order_id: String,
) -> Result<(), String> {
    let _session_work = bridge
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let session_id = require_active_session_account(bridge, &account_login, &broker_server)?;
    // F-7: one clock sample per enqueue (id and durable registration time).
    let now = now_ms();
    let command_id = adapter.next_command_id(now);
    let request = OrderCancelRequest {
        command_id: command_id.clone(),
        account_login,
        broker_server,
        order_id,
    };
    request.validate().map_err(str::to_owned)?;
    let intent = cancel_execution_intent(&command_id, &request)?;
    let payload = serde_json::to_value(&request).map_err(|error| error.to_string())?;
    adapter
        .enqueue_for_session(
            &session_id,
            PendingCommand {
                command_id,
                message_type: MessageType::OrderCancelRequest,
                payload,
            },
            Some(intent),
            now.max(0) as u64,
        )
        .map_err(|error| error.to_string())?;
    bridge.wake_outbound();
    Ok(())
}

#[tauri::command]
pub(crate) fn get_execution_recovery_snapshot(
    state: State<'_, ExecutionSafetyState>,
    adapter: State<'_, ExecutionAdapterState>,
) -> Result<ExecutionRecoverySnapshot, String> {
    let (safety, entries) = state.recovery_snapshot().map_err(|_| {
        "execution journal unavailable; recovery snapshot is unavailable".to_string()
    })?;
    Ok(ExecutionRecoverySnapshot {
        safety: adapter.with_trading_permission(safety),
        entries,
    })
}
