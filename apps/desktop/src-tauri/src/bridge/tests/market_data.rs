//! Quote acceptance and bar-update history mutation tests.
use super::*;

#[test]
fn quote_acceptance_is_bound_to_current_session_and_market_symbol() {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-1".into());
    *state.market.lock().unwrap() = MarketSnapshot {
        symbol: Some("NAS100".into()),
        timeframe: Some("M1".into()),
        complete: true,
        candles: Vec::new(),
    };
    let quote = QuoteUpdate {
        symbol: "NAS100".into(),
        time_ms: 1,
        bid: "1".into(),
        ask: "2".into(),
        last: "0".into(),
        volume: 0,
        volume_real: "0".into(),
        flags: 6,
    };
    assert!(accept_quote(&state, "session-1", quote.clone()).is_some());
    assert!(accept_quote(&state, "old-session", quote.clone()).is_none());
    assert!(accept_quote(
        &state,
        "session-1",
        QuoteUpdate {
            symbol: "EURUSD".into(),
            ..quote
        }
    )
    .is_none());
}

fn market_candle_for_test(time_ms: i64, close: &str) -> MarketCandle {
    MarketCandle {
        time_ms,
        open: "1".into(),
        high: "2".into(),
        low: "0.5".into(),
        close: close.into(),
        tick_volume: 1,
        spread: 1,
        real_volume: 0,
    }
}

#[test]
fn bar_updates_mutate_history_in_place_and_keep_the_bound() {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-1".into());
    *state.market.lock().unwrap() = MarketSnapshot {
        symbol: Some("NAS100".into()),
        timeframe: Some("M1".into()),
        complete: true,
        candles: (0..1000)
            .map(|time_ms| market_candle_for_test(time_ms, "1"))
            .collect(),
    };
    let allocation = state.market.lock().unwrap().candles.as_ptr() as usize;
    let current = BarUpdate {
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        candle: market_candle_for_test(999, "1.5"),
    };
    assert_eq!(
        accept_bar_update(&state, "session-1", &current),
        BarUpdateAcceptance::Applied
    );
    let market = state.market.lock().unwrap();
    assert_eq!(market.candles.as_ptr() as usize, allocation);
    assert_eq!(market.candles.len(), 1000);
    assert_eq!(market.candles.last().unwrap().close, "1.5");
    drop(market);

    let next = BarUpdate {
        candle: market_candle_for_test(1000, "2"),
        ..current.clone()
    };
    assert_eq!(
        accept_bar_update(&state, "session-1", &next),
        BarUpdateAcceptance::Applied
    );
    let market = state.market.lock().unwrap();
    assert_eq!(market.candles.len(), 1000);
    assert_eq!(market.candles.first().unwrap().time_ms, 1);
    assert_eq!(market.candles.last().unwrap().time_ms, 1000);
    drop(market);

    assert_eq!(
        accept_bar_update(
            &state,
            "session-1",
            &BarUpdate {
                symbol: "OTHER".into(),
                ..next.clone()
            }
        ),
        BarUpdateAcceptance::Invalid
    );
    assert_eq!(
        accept_bar_update(&state, "old-session", &next),
        BarUpdateAcceptance::Stale
    );
}
