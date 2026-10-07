//! Test fixtures shared across the bridge test modules.

use super::*;

pub(super) fn broker_symbol(symbol: &str) -> BrokerSymbol {
    BrokerSymbol {
        symbol: symbol.into(),
        description: "Nasdaq".into(),
        digits: 1,
        tick_size: "0.1".into(),
        point_size: "0.1".into(),
        contract_size: "1".into(),
        tick_value_profit: None,
        tick_value_loss: None,
        tick_value_currency: None,
        volume_min: "0.01".into(),
        volume_max: "100".into(),
        volume_step: "0.01".into(),
        trade_mode: 4,
        stops_level: 10,
        freeze_level: 5,
        filling_mode: 3,
        order_mode: 127,
        expiration_mode: 15,
        trade_execution: 2,
    }
}

pub(super) fn order_check_result_for_test() -> OrderCheckResult {
    OrderCheckResult {
        draft_id: "draft-7-1".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Limit,
        volume: "0.1".into(),
        requested_entry: "100".into(),
        check_price: "100".into(),
        stop_loss: Some("90".into()),
        take_profit: None,
        check_passed: true,
        retcode: 0,
        last_error: 0,
        balance: "1000".into(),
        equity: "1000".into(),
        profit: "0".into(),
        margin: "10".into(),
        free_margin: "990".into(),
        margin_level: "10000".into(),
        comment: "OK".into(),
        checked_at_ms: 1,
        time_in_force: None,
        limit_price: None,
    }
}

pub(super) fn ready_state_with_result(result: OrderCheckResult) -> BridgeState {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-1".into());
    *state.status.lock().unwrap() = BridgeStatus {
        state: BridgeConnectionState::Connected,
        account: Some("123".into()),
        server: Some("Demo".into()),
        // Open session for the active chart symbol so submission tests reach
        // the queue; market-session gate tests override this explicitly.
        market_session: Some(MarketSessionView {
            symbol: "NAS".into(),
            is_open: true,
            trade_mode: 4,
            server_time_ms: 1_770_000_000_000,
        }),
        ..BridgeStatus::default()
    };
    *state.account.lock().unwrap() = Some(AccountView {
        account_login: "123".into(),
        broker_server: "Demo".into(),
        currency: "USD".into(),
        currency_digits: 2,
        balance: "1000".into(),
        equity: "1000".into(),
        margin: "10".into(),
        free_margin: "990".into(),
        margin_level: "10000".into(),
        leverage: 100,
        margin_mode: 0,
        trade_allowed: true,
        expert_allowed: true,
        account_trade_mode: 0,
        account_trade_mode_name: "demo".into(),
    });
    *state.market.lock().unwrap() = MarketSnapshot {
        symbol: Some("NAS".into()),
        ..MarketSnapshot::default()
    };
    *state.validated_order_check.lock().unwrap() = Some(ValidatedOrderCheck {
        result,
        draft_version: 7,
    });
    state
}
