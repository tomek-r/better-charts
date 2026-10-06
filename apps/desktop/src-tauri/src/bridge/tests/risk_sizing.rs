use super::common::*;
use super::*;
use crate::bridge::inbound_execution::size_risk_quote;
use rust_decimal::Decimal;
use trading_core::protocol::RiskQuoteResult;

fn quote() -> RiskQuoteResult {
    RiskQuoteResult {
        draft_id: "draft-7-1".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        entry: "100".into(),
        stop_loss: "90".into(),
        take_profit: None,
        reference_volume: "1".into(),
        loss_at_reference: "240".into(),
        reward_at_reference: None,
        margin_at_reference: "1200".into(),
        currency: "USD".into(),
        tick_size: "0.1".into(),
        volume_min: "0.01".into(),
        volume_max: "10".into(),
        volume_step: "0.01".into(),
        quoted_at_ms: 1,
    }
}

#[test]
fn risk_sizing_uses_latest_bound_account_free_margin() {
    let state = ready_state_with_result(order_check_result_for_test());
    assert_eq!(
        size_risk_quote(&state, Decimal::from(100), Decimal::from(100), &quote())
            .unwrap()
            .volume,
        "0.41"
    );
    state.account.lock().unwrap().as_mut().unwrap().free_margin = "100".into();
    let result = size_risk_quote(&state, Decimal::from(100), Decimal::from(100), &quote()).unwrap();
    assert_eq!(result.volume, "0.08");
    assert_eq!(result.estimated_margin, "96");
    state.account.lock().unwrap().as_mut().unwrap().free_margin = "-1".into();
    assert_eq!(
        size_risk_quote(&state, Decimal::from(100), Decimal::from(100), &quote()).unwrap_err(),
        "insufficient free margin for broker minimum volume"
    );
}

#[test]
fn risk_sizing_fails_closed_without_matching_account_currency_or_valid_margin() {
    let state = ready_state_with_result(order_check_result_for_test());
    let mut wrong_currency = quote();
    wrong_currency.currency = "EUR".into();
    assert_eq!(
        size_risk_quote(
            &state,
            Decimal::from(100),
            Decimal::from(100),
            &wrong_currency
        )
        .unwrap_err(),
        "risk quote currency does not match account"
    );
    state.account.lock().unwrap().as_mut().unwrap().free_margin = "NaN".into();
    assert_eq!(
        size_risk_quote(&state, Decimal::from(100), Decimal::from(100), &quote()).unwrap_err(),
        "invalid account free margin"
    );
    *state.account.lock().unwrap() = None;
    assert_eq!(
        size_risk_quote(&state, Decimal::from(100), Decimal::from(100), &quote()).unwrap_err(),
        "account snapshot unavailable"
    );
}

#[test]
fn equity_allocation_caps_actual_volume_and_uses_latest_equity() {
    let state = ready_state_with_result(order_check_result_for_test());
    {
        let mut account = state.account.lock().unwrap();
        let account = account.as_mut().unwrap();
        account.equity = "1000".into();
        account.free_margin = "900".into();
    }
    let result = size_risk_quote(&state, Decimal::from(1000), Decimal::from(40), &quote()).unwrap();
    assert_eq!(result.volume, "0.33");
    assert_eq!(result.estimated_margin, "396");
    let result = size_risk_quote(&state, Decimal::from(1000), Decimal::from(60), &quote()).unwrap();
    assert_eq!(result.volume, "0.5");
    assert_eq!(result.estimated_margin, "600");
    state.account.lock().unwrap().as_mut().unwrap().equity = "500".into();
    let result = size_risk_quote(&state, Decimal::from(1000), Decimal::from(60), &quote()).unwrap();
    assert_eq!(result.volume, "0.25");
    state.account.lock().unwrap().as_mut().unwrap().free_margin = "100".into();
    assert_eq!(
        size_risk_quote(&state, Decimal::from(1000), Decimal::from(60), &quote())
            .unwrap()
            .volume,
        "0.08"
    );
    state.account.lock().unwrap().as_mut().unwrap().equity = "NaN".into();
    assert!(size_risk_quote(&state, Decimal::from(1000), Decimal::from(60), &quote()).is_err());
}

#[test]
fn local_projection_requires_matching_session_symbol_side_and_preserves_check_slot() {
    let state = ready_state_with_result(order_check_result_for_test());
    let session = state.current_session.lock().unwrap().clone().unwrap();
    let request = trading_core::protocol::RiskQuoteRequest {
        draft_id: "projection-8".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        entry: "100".into(),
        stop_loss: "80".into(),
        take_profit: None,
    };
    state.market.lock().unwrap().symbol = Some("NAS".into());
    let project = |request: &trading_core::protocol::RiskQuoteRequest| {
        crate::bridge::commands::draft::project_cached_risk_preview(
            &state,
            request,
            Decimal::from(100),
            Decimal::from(100),
            8,
        )
    };
    assert!(project(&request).unwrap().is_none());
    *state.last_risk_quote.lock().unwrap() = Some(("old-session".into(), quote()));
    assert!(project(&request).unwrap().is_none());
    *state.last_risk_quote.lock().unwrap() = Some((session, quote()));
    let had_check = state.validated_order_check.lock().unwrap().is_some();
    let projected = project(&request).unwrap().unwrap();
    assert_eq!(projected.volume, "0.2");
    assert_eq!(projected.estimated_risk, "96");
    assert_eq!(
        state.validated_order_check.lock().unwrap().is_some(),
        had_check
    );
    let mut other = request.clone();
    other.symbol = "OTHER".into();
    assert!(project(&other).unwrap().is_none());
    other = request;
    other.side = OrderSide::Sell;
    other.stop_loss = "120".into();
    assert!(project(&other).unwrap().is_none());
}

#[test]
fn fitting_stop_uses_latest_margin_and_never_changes_cached_quote_or_check() {
    let state = ready_state_with_result(order_check_result_for_test());
    let session = state.current_session.lock().unwrap().clone().unwrap();
    state.market.lock().unwrap().symbol = Some("NAS".into());
    let mut seed = quote();
    seed.stop_loss = "99".into();
    seed.loss_at_reference = "24".into();
    *state.last_risk_quote.lock().unwrap() = Some((session, seed.clone()));
    state.account.lock().unwrap().as_mut().unwrap().free_margin = "600".into();
    state.account.lock().unwrap().as_mut().unwrap().equity = "10000".into();
    let request = trading_core::protocol::RiskQuoteRequest {
        draft_id: "projection-8".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        entry: "100".into(),
        stop_loss: "99".into(),
        take_profit: None,
    };
    let checked = state.validated_order_check.lock().unwrap().is_some();
    let fit = || {
        crate::bridge::commands::draft::project_cached_risk_preview_with_volume(
            &state,
            &request,
            Decimal::from(100),
            Decimal::from(100),
            8,
            Some(Decimal::ONE),
        )
    };
    let view = fit().unwrap().unwrap();
    assert_eq!(view.stop_loss, "91.7");
    assert_eq!(view.volume, "0.5");
    assert_eq!(view.estimated_risk, "99.6");
    assert_eq!(view.estimated_margin, "600");
    assert_eq!(
        state.validated_order_check.lock().unwrap().is_some(),
        checked
    );
    assert_eq!(
        state
            .last_risk_quote
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .1
            .stop_loss,
        seed.stop_loss
    );
    *state.last_risk_quote.lock().unwrap() = Some(("old-session".into(), seed));
    assert!(fit().unwrap().is_none());
}
