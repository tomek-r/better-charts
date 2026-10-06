//! Frontend wire-shape tests for bridge status, symbol, quote, risk and account views.
use super::common::*;
use super::*;

#[test]
fn status_uses_frontend_wire_shape() {
    let value = serde_json::to_value(BridgeStatus::default()).unwrap();
    assert_eq!(value["state"], "connecting");
    assert_eq!(value["protocolVersion"], "1");
    assert!(value.get("current_session").is_none());
}

#[test]
fn symbol_search_view_uses_frontend_camel_case_shape() {
    let view = SymbolSearchResultView {
        source: "live".into(),
        query: "nas".into(),
        symbols: vec![BrokerSymbolView {
            symbol: "NAS100".into(),
            description: "Nasdaq".into(),
            digits: 1,
            tick_size: "0.1".into(),
            point_size: "0.1".into(),
            contract_size: "1".into(),
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
        }],
    };
    let json = serde_json::to_value(view).unwrap();
    assert_eq!(json["source"], "live");
    assert!(json["symbols"][0].get("volumeMin").is_some());
    assert!(json["symbols"][0].get("volume_min").is_none());
    assert_eq!(json["symbols"][0]["pointSize"], "0.1");
    assert_eq!(json["symbols"][0]["contractSize"], "1");
    assert_eq!(json["symbols"][0]["stopsLevel"], 10);
    assert_eq!(json["symbols"][0]["tradeExecution"], 2);
}

#[test]
fn symbol_info_accepts_only_the_current_expected_request() {
    let state = BridgeState::default();
    let request = SymbolInfoRequest {
        symbol: "NAS100".into(),
    };
    *state.expected_symbol_info.lock().unwrap() = Some(("info-1".into(), request.clone()));
    let result = SymbolInfoResult {
        request_id: "info-1".into(),
        symbol_info: broker_symbol("NAS100"),
    };
    let view = accept_symbol_info(&state, result.clone()).unwrap().unwrap();
    let json = serde_json::to_value(view).unwrap();
    assert_eq!(json["symbol"], "NAS100");
    assert_eq!(json["contractSize"], "1");
    assert!(state.expected_symbol_info.lock().unwrap().is_none());

    *state.expected_symbol_info.lock().unwrap() = Some(("info-2".into(), request));
    assert!(accept_symbol_info(&state, result).unwrap().is_none());
    assert!(state.expected_symbol_info.lock().unwrap().is_some());
    *state.pending_symbol_info.lock().unwrap() = Some(SymbolInfoRequest {
        symbol: "NAS100".into(),
    });
    assert!(accept_symbol_info(
        &state,
        SymbolInfoResult {
            request_id: "info-2".into(),
            symbol_info: broker_symbol("NAS100"),
        }
    )
    .unwrap()
    .is_none());
}

#[test]
fn quote_view_uses_frontend_camel_case_shape() {
    let value = serde_json::to_value(QuoteView::from(QuoteUpdate {
        symbol: "NAS100".into(),
        time_ms: 1,
        bid: "1".into(),
        ask: "2".into(),
        last: "0".into(),
        volume: 3,
        volume_real: "0".into(),
        flags: 6,
    }))
    .unwrap();
    assert!(value.get("timeMs").is_some());
    assert!(value.get("volumeReal").is_some());
    assert!(value.get("time_ms").is_none());
}

#[test]
fn risk_preview_serializes_estimated_margin_in_camel_case() {
    let value = serde_json::to_value(RiskPreviewView {
        draft_version: 1,
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        currency: "USD".into(),
        entry: "100".into(),
        stop_loss: "90".into(),
        take_profit: None,
        risk_budget: "100".into(),
        volume: "0.41".into(),
        estimated_risk: "98.4".into(),
        estimated_margin: "492".into(),
        estimated_reward: None,
        rr: None,
        quoted_at_ms: 1,
    })
    .unwrap();
    assert_eq!(value["estimatedMargin"], "492");
    assert!(value.get("estimated_margin").is_none());
}

#[test]
fn order_check_result_serializes_ui_event_in_camel_case() {
    let value = serde_json::to_value(OrderCheckResultView {
        draft_version: 7,
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
    })
    .unwrap();
    assert_eq!(value["draftVersion"], 7);
    assert!(
        value.get("timeInForce").is_some(),
        "new echo fields are camelCase"
    );
    assert!(value.get("time_in_force").is_none());
    assert!(value.get("limitPrice").is_some());
    assert_eq!(value["draftId"], "draft-7-1");
    assert_eq!(value["lastError"], 0);
    assert_eq!(value["freeMargin"], "990");
    assert!(value.get("draft_version").is_none());
    assert!(value.get("last_error").is_none());
    assert!(value.get("free_margin").is_none());
}

#[test]
fn account_view_uses_frontend_camel_case_shape_and_identity_is_checked() {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-1".into());
    *state.status.lock().unwrap() = BridgeStatus {
        state: BridgeConnectionState::Connected,
        protocol_version: "1".into(),
        terminal: None,
        account: Some("123".into()),
        server: Some("Demo".into()),
        last_heartbeat: None,
        message: None,
        market_session: None,
        supported_timeframes: vec!["M1".into(), "M5".into()],
    };
    let account = AccountSnapshot {
        account_login: "123".into(),
        broker_server: "Demo".into(),
        currency: "USD".into(),
        balance: "1".into(),
        equity: "1".into(),
        margin: "0".into(),
        free_margin: "1".into(),
        margin_level: "0".into(),
        leverage: 1,
        margin_mode: 0,
        trade_allowed: true,
        expert_allowed: false,
        account_trade_mode: 0,
        account_trade_mode_name: "demo".into(),
    };
    let view = accept_account(&state, "session-1", account.clone())
        .unwrap()
        .unwrap();
    let json = serde_json::to_value(view).unwrap();
    assert!(json.get("accountLogin").is_some());
    assert!(json.get("account_login").is_none());
    assert_eq!(json["accountTradeMode"], 0);
    assert_eq!(json["accountTradeModeName"], "demo");
    assert!(json.get("account_trade_mode").is_none());
    assert!(json.get("account_trade_mode_name").is_none());
    assert!(accept_account(&state, "old", account.clone())
        .unwrap()
        .is_none());
    assert!(accept_account(
        &state,
        "session-1",
        AccountSnapshot {
            broker_server: "Other".into(),
            ..account
        }
    )
    .is_err());
}
