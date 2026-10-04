//! OrderCheck acceptance, preflight and draft-queue tests.
use super::common::*;
use super::*;

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
    let view = accept_order_check_result(&mut expected, false, order_check_result_for_test())
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
    let view = accept_order_check_result(&mut expected_order_check_for_test(), false, rejected)
        .unwrap()
        .unwrap();
    assert!(!view.check_passed);
    assert_eq!(view.retcode, 10019);
    assert_eq!(view.comment, "not enough money");
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
        accept_order_check_result(&mut stale_expected, false, stale_result)
            .unwrap()
            .is_none()
    );
    assert!(stale_expected.is_some());

    let mut expected = expected_order_check_for_test();
    assert!(
        accept_order_check_result(&mut expected, true, order_check_result_for_test())
            .unwrap()
            .is_none()
    );
    assert!(expected.is_some());
}

#[test]
fn order_check_rejects_current_result_echo_mismatch_and_accepts_current_error() {
    let mut malformed = order_check_result_for_test();
    malformed.symbol = "OTHER".into();
    assert!(
        accept_order_check_result(&mut expected_order_check_for_test(), false, malformed).is_err()
    );

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
