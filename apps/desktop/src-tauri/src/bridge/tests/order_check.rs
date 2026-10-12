//! OrderCheck acceptance, preflight and draft-queue tests.
use super::common::*;
use super::*;

#[test]
fn equity_ticks_preserve_the_current_order_check_but_permission_changes_invalidate_it() {
    let state = ready_state_with_result(order_check_result_for_test());
    *state.expected_order_check.lock().unwrap() = expected_order_check_for_test();
    let account = AccountSnapshot {
        account_login: "123".into(),
        broker_server: "Demo".into(),
        currency: "USD".into(),
        currency_digits: 2,
        balance: "1000".into(),
        equity: "999".into(),
        margin: "10".into(),
        free_margin: "989".into(),
        margin_level: "9990".into(),
        leverage: 100,
        margin_mode: 0,
        trade_allowed: true,
        expert_allowed: true,
        account_trade_mode: 0,
        account_trade_mode_name: "demo".into(),
        margin_call_level: None,
        stop_out_level: None,
        margin_levels_mode: None,
        margin_levels_unit: "unknown".into(),
    };
    accept_account(&state, "session-1", account.clone())
        .unwrap()
        .unwrap();
    assert!(state.validated_order_check.lock().unwrap().is_some());
    assert!(state.expected_order_check.lock().unwrap().is_some());
    assert!(
        accept_and_store_order_check_result(&state, false, order_check_result_for_test())
            .unwrap()
            .is_some()
    );
    accept_account(
        &state,
        "session-1",
        AccountSnapshot {
            expert_allowed: false,
            ..account
        },
    )
    .unwrap()
    .unwrap();
    assert!(state.validated_order_check.lock().unwrap().is_none());
    assert!(state.expected_order_check.lock().unwrap().is_none());
}

fn order_check_request_for_test() -> OrderCheckRequest {
    OrderCheckRequest {
        draft_id: "draft-7-1".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Limit,
        volume: "0.1".into(),
        entry: "100".into(),
        stop_loss: Some("90".into()),
        take_profit: None,
        time_in_force: None,
        limit_price: None,
    }
}

#[test]
fn order_check_preflight_rejects_stops_inside_the_local_margin() {
    let state = BridgeState::with_symbol_cache_path(None);
    let mut symbol = broker_symbol("NAS100");
    symbol.tick_size = "0.01".into();
    symbol.point_size = "0.01".into();
    symbol.stops_level = 0;
    state.remember_symbols([symbol]);
    *state.quote.lock().unwrap() = Some(QuoteView {
        symbol: "NAS100".into(),
        time_ms: 1,
        bid: "30459.64".into(),
        ask: "30460.64".into(),
        last: "30460.00".into(),
        volume: 1,
        volume_real: "0".into(),
        flags: 0,
    });
    let request = OrderCheckRequest {
        draft_id: "draft-9-1".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "NAS100".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Market,
        volume: "0.1".into(),
        entry: "30460.64".into(),
        stop_loss: Some("30459.50".into()),
        take_profit: None,
        time_in_force: None,
        limit_price: None,
    };
    // 0.14 from bid is inside the 0.20 (20-tick) margin: rejected locally
    // with the exact wording the EA preflight would journal.
    assert_eq!(
        preflight_stop_distance(&state, &request).unwrap_err(),
        "stop_loss too close: distance 0.14, required >= 0.20 (20 ticks margin)"
    );
    // Optional stop loss: without an SL level the SL leg of the preflight
    // is skipped entirely; a present SL keeps today's rule (checked via
    // `far` below).
    let mut no_sl = request.clone();
    no_sl.stop_loss = None;
    no_sl.take_profit = None;
    assert_eq!(preflight_stop_distance(&state, &no_sl), Ok(()));
    // A stop far beyond the margin passes the guard.
    let mut far = request;
    far.stop_loss = Some("30454.64".into());
    assert_eq!(preflight_stop_distance(&state, &far), Ok(()));
    // Without metadata/quote for the symbol the guard defers to the EA.
    let cold = BridgeState::with_symbol_cache_path(None);
    assert_eq!(preflight_stop_distance(&cold, &far), Ok(()));
}

#[test]
fn pending_protective_margin_uses_entry_or_resting_limit() {
    let state = BridgeState::with_symbol_cache_path(None);
    let mut symbol = broker_symbol("NAS");
    symbol.tick_size = "0.01".into();
    symbol.point_size = "0.01".into();
    symbol.stops_level = 0;
    state.remember_symbols([symbol]);
    *state.quote.lock().unwrap() = Some(QuoteView {
        symbol: "NAS".into(),
        time_ms: 1,
        bid: "110".into(),
        ask: "111".into(),
        last: "110".into(),
        volume: 1,
        volume_real: "0".into(),
        flags: 0,
    });
    for (side, entry, take, near) in [
        (OrderSide::Buy, "100", "105", "100.20"),
        (OrderSide::Sell, "120", "115", "119.80"),
    ] {
        for kind in [OrderKind::Limit, OrderKind::Stop, OrderKind::StopLimit] {
            let mut request = order_check_request_for_test();
            request.side = side;
            request.order_kind = kind;
            request.entry = if kind == OrderKind::StopLimit {
                "130"
            } else {
                entry
            }
            .into();
            request.limit_price = (kind == OrderKind::StopLimit).then(|| entry.into());
            request.stop_loss = None;
            request.take_profit = Some(take.into());
            request.validate().unwrap();
            assert_eq!(preflight_stop_distance(&state, &request), Ok(()));
            request.take_profit = Some(near.into());
            assert!(preflight_stop_distance(&state, &request).is_err());
            request.take_profit = Some(entry.into());
            assert!(request.validate().is_err());
        }
    }
}

fn expected_order_check_for_test() -> Option<ExpectedOrderCheck> {
    let request = order_check_request_for_test();
    Some((request.draft_id.clone(), request, 7))
}

#[test]
fn order_check_accepts_current_result_and_preserves_rejected_retcode() {
    let mut expected = expected_order_check_for_test();
    let view = accept_order_check_result(&mut expected, false, None, order_check_result_for_test())
        .unwrap()
        .unwrap();
    assert_eq!(view.draft_version, 7);
    assert!(view.check_passed);
    assert_eq!(view.retcode, 0);
    assert!(
        expected.is_none(),
        "accepted result clears expected request"
    );

    let mut rejected = order_check_result_for_test();
    rejected.check_passed = false;
    rejected.retcode = 10019;
    rejected.comment = "not enough money".into();
    let view =
        accept_order_check_result(&mut expected_order_check_for_test(), false, None, rejected)
            .unwrap()
            .unwrap();
    assert!(!view.check_passed);
    assert_eq!(view.retcode, 10019);
    assert_eq!(view.comment, "not enough money");
}

fn account_with_margin_levels(mode: Option<i64>, call: &str, stop_out: &str) -> AccountView {
    let state = ready_state_with_result(order_check_result_for_test());
    let mut account = state.account.lock().unwrap().clone().unwrap();
    account.margin_levels_mode = mode;
    account.margin_call_level = Some(call.into());
    account.stop_out_level = Some(stop_out.into());
    account
}

fn result_with_margin_at_fill(
    equity: &str,
    margin: &str,
    free: &str,
    fill: &str,
) -> OrderCheckResult {
    OrderCheckResult {
        equity: equity.into(),
        margin_at_fill: Some(fill.into()),
        account_margin_used: Some(margin.into()),
        account_free_margin: Some(free.into()),
        ..order_check_result_for_test()
    }
}

fn accepted_view(account: Option<&AccountView>, result: OrderCheckResult) -> OrderCheckResultView {
    accept_order_check_result(&mut expected_order_check_for_test(), false, account, result)
        .unwrap()
        .unwrap()
}

#[test]
fn order_check_projects_margin_after_fill_and_classifies_percent_mode() {
    let account = account_with_margin_levels(Some(0), "100", "50");
    let view = accepted_view(
        Some(&account),
        result_with_margin_at_fill("1000", "100", "900", "100"),
    );
    assert_eq!(view.margin_at_fill.as_deref(), Some("100"));
    assert_eq!(view.free_margin_after_fill.as_deref(), Some("800"));
    assert_eq!(view.margin_level_after_fill.as_deref(), Some("500"));
    assert_eq!(view.margin_risk, MarginRiskView::Ok);

    // 1000 / 1500 * 100 = 66.67 -> below the 100% call, above the 50% stop out.
    let view = accepted_view(
        Some(&account),
        result_with_margin_at_fill("1000", "500", "500", "1000"),
    );
    assert_eq!(view.margin_level_after_fill.as_deref(), Some("66.67"));
    assert_eq!(view.margin_risk, MarginRiskView::BelowMarginCall);

    // 1000 / 5000 * 100 = 20 -> below the 50% stop out.
    let view = accepted_view(
        Some(&account),
        result_with_margin_at_fill("1000", "1000", "0", "4000"),
    );
    assert_eq!(view.free_margin_after_fill.as_deref(), Some("-4000"));
    assert_eq!(view.margin_risk, MarginRiskView::BelowStopOut);
}

#[test]
fn order_check_money_mode_compares_equity_with_the_amounts() {
    let account = account_with_margin_levels(Some(1), "200", "100");
    let ok = accepted_view(
        Some(&account),
        result_with_margin_at_fill("500", "10", "490", "5"),
    );
    assert_eq!(ok.margin_risk, MarginRiskView::Ok);
    let call = accepted_view(
        Some(&account),
        result_with_margin_at_fill("150", "10", "140", "5"),
    );
    assert_eq!(call.margin_risk, MarginRiskView::BelowMarginCall);
    let stop_out = accepted_view(
        Some(&account),
        result_with_margin_at_fill("99", "10", "89", "5"),
    );
    assert_eq!(stop_out.margin_risk, MarginRiskView::BelowStopOut);
}

#[test]
fn order_check_margin_projection_is_unknown_without_matching_account_or_inputs() {
    // Old EA: no margin fields at all -> everything stays null, never 0.
    let view = accepted_view(None, order_check_result_for_test());
    assert_eq!(view.margin_at_fill, None);
    assert_eq!(view.free_margin_after_fill, None);
    assert_eq!(view.margin_level_after_fill, None);
    assert_eq!(view.margin_risk, MarginRiskView::Unknown);

    // Figures are projected, but a snapshot of another login gives no verdict.
    let mut foreign = account_with_margin_levels(Some(0), "100", "50");
    foreign.account_login = "999".into();
    let view = accepted_view(
        Some(&foreign),
        result_with_margin_at_fill("1000", "100", "900", "100"),
    );
    assert_eq!(view.margin_level_after_fill.as_deref(), Some("500"));
    assert_eq!(view.margin_risk, MarginRiskView::Unknown);
    let mut other_server = account_with_margin_levels(Some(0), "100", "50");
    other_server.broker_server = "Other".into();
    let view = accepted_view(
        Some(&other_server),
        result_with_margin_at_fill("1000", "100", "900", "100"),
    );
    assert_eq!(view.margin_risk, MarginRiskView::Unknown);

    // Unreported stop-out mode on a matching account is not guessed.
    let unknown_mode = account_with_margin_levels(None, "100", "50");
    let view = accepted_view(
        Some(&unknown_mode),
        result_with_margin_at_fill("1000", "100", "900", "100"),
    );
    assert_eq!(view.margin_risk, MarginRiskView::Unknown);
}

#[test]
fn order_check_store_uses_the_stored_account_thresholds() {
    let state = ready_state_with_result(order_check_result_for_test());
    {
        let mut account = state.account.lock().unwrap();
        let account = account.as_mut().unwrap();
        account.margin_levels_mode = Some(0);
        account.margin_call_level = Some("100".into());
        account.stop_out_level = Some("50".into());
    }
    *state.expected_order_check.lock().unwrap() = expected_order_check_for_test();
    let view = accept_and_store_order_check_result(
        &state,
        false,
        result_with_margin_at_fill("1000", "500", "500", "1000"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(view.margin_risk, MarginRiskView::BelowMarginCall);
}

#[test]
fn order_check_store_and_new_request_are_atomic_and_errors_clear_stored_results() {
    let state = BridgeState::default();
    *state.expected_order_check.lock().unwrap() = expected_order_check_for_test();
    assert!(
        accept_and_store_order_check_result(&state, false, order_check_result_for_test())
            .unwrap()
            .is_some()
    );
    assert!(state.validated_order_check.lock().unwrap().is_some());

    // A new request serializes with result acceptance and clears its stored
    // result while replacing the expected request.
    let replacement = OrderCheckRequest {
        draft_id: "new-draft".into(),
        ..order_check_request_for_test()
    };
    queue_order_check(&state, replacement, 8);
    assert!(state.validated_order_check.lock().unwrap().is_none());

    // A delayed result from the old request can no longer repopulate it.
    assert!(
        accept_and_store_order_check_result(&state, false, order_check_result_for_test())
            .unwrap()
            .is_none()
    );
    assert!(state.validated_order_check.lock().unwrap().is_none());

    // An accepted OrderCheckError supersedes any previously passed result.
    *state.pending_order_check.lock().unwrap() = None;
    *state.expected_order_check.lock().unwrap() = expected_order_check_for_test();
    assert!(
        accept_and_store_order_check_result(&state, false, order_check_result_for_test())
            .unwrap()
            .is_some()
    );
    *state.expected_order_check.lock().unwrap() = expected_order_check_for_test();
    assert!(accept_and_clear_order_check_error(
        &state,
        false,
        OrderCheckError {
            draft_id: "draft-7-1".into(),
            code: "CHECK_FAILED".into(),
            message: "preflight unavailable".into(),
        }
    )
    .unwrap()
    .is_some());
    assert!(state.validated_order_check.lock().unwrap().is_none());
}

#[test]
fn stale_order_check_error_does_not_clear_current_passed_result() {
    let state = BridgeState::default();
    *state.expected_order_check.lock().unwrap() = expected_order_check_for_test();
    let passed = order_check_result_for_test();
    assert!(
        accept_and_store_order_check_result(&state, false, passed.clone())
            .unwrap()
            .is_some()
    );

    // A newer request is expected; a delayed error for another draft must
    // be ignored and must not erase the accepted result already stored.
    let newer_request = OrderCheckRequest {
        draft_id: "draft-8-1".into(),
        ..order_check_request_for_test()
    };
    *state.expected_order_check.lock().unwrap() =
        Some((newer_request.draft_id.clone(), newer_request, 8));
    assert!(accept_and_clear_order_check_error(
        &state,
        false,
        OrderCheckError {
            draft_id: "draft-7-1".into(),
            code: "STALE".into(),
            message: "late reply".into(),
        }
    )
    .unwrap()
    .is_none());
    assert_eq!(
        state
            .validated_order_check
            .lock()
            .unwrap()
            .as_ref()
            .map(|stored| &stored.result),
        Some(&passed)
    );
}

#[test]
fn order_check_ignores_stale_draft_and_reply_while_new_request_is_pending() {
    let mut stale_expected = expected_order_check_for_test();
    let mut stale_result = order_check_result_for_test();
    stale_result.draft_id = "older-draft".into();
    assert!(
        accept_order_check_result(&mut stale_expected, false, None, stale_result)
            .unwrap()
            .is_none()
    );
    assert!(stale_expected.is_some());

    let mut expected = expected_order_check_for_test();
    assert!(
        accept_order_check_result(&mut expected, true, None, order_check_result_for_test())
            .unwrap()
            .is_none()
    );
    assert!(expected.is_some());
}

#[test]
fn order_check_rejects_current_result_echo_mismatch_and_accepts_current_error() {
    let mut malformed = order_check_result_for_test();
    malformed.symbol = "OTHER".into();
    assert!(accept_order_check_result(
        &mut expected_order_check_for_test(),
        false,
        None,
        malformed
    )
    .is_err());

    let mut expected = expected_order_check_for_test();
    let view = accept_order_check_error(
        &mut expected,
        false,
        OrderCheckError {
            draft_id: "draft-7-1".into(),
            code: "CHECK_FAILED".into(),
            message: "preflight unavailable".into(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(view.draft_version, 7);
    assert_eq!(view.code, "CHECK_FAILED");
    assert!(expected.is_none());
}

#[test]
fn order_check_queue_is_last_wins_and_only_expects_sent_requests() {
    let state = BridgeState::default();
    let first = OrderCheckRequest {
        draft_id: "draft-1".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Market,
        volume: "1".into(),
        entry: "100".into(),
        stop_loss: Some("90".into()),
        take_profit: None,
        time_in_force: None,
        limit_price: None,
    };
    *state.expected_order_check.lock().unwrap() = Some(("old".into(), first.clone(), 1));
    queue_order_check(&state, first, 1);
    let latest = OrderCheckRequest {
        draft_id: "draft-2".into(),
        volume: "2".into(),
        ..OrderCheckRequest {
            draft_id: "draft-2".into(),
            account_login: "123".into(),
            broker_server: "Demo".into(),
            symbol: "NAS".into(),
            side: OrderSide::Buy,
            order_kind: OrderKind::Market,
            volume: "2".into(),
            entry: "100".into(),
            stop_loss: Some("90".into()),
            take_profit: None,
            time_in_force: None,
            limit_price: None,
        }
    };
    queue_order_check(&state, latest.clone(), 2);
    assert_eq!(
        state
            .pending_order_check
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .0,
        latest
    );
    assert_eq!(
        state
            .pending_order_check
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .1,
        2
    );
    assert!(
        state.expected_order_check.lock().unwrap().is_none(),
        "reply must not be accepted before send"
    );
    let latest = state.pending_order_check.lock().unwrap().take().unwrap();
    mark_order_check_sent(&state, latest.0.clone(), latest.1);
    assert_eq!(
        state
            .expected_order_check
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .0,
        "draft-2"
    );
    queue_order_check(
        &state,
        OrderCheckRequest {
            draft_id: "draft-3".into(),
            ..latest.0
        },
        3,
    );
    assert!(
        state.expected_order_check.lock().unwrap().is_none(),
        "new draft invalidates sent response immediately"
    );
}
