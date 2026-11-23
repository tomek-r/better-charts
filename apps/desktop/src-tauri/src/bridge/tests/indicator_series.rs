//! The indicator series route: the caller key, the "newest bars" anchor, the
//! bounded latest-per-key slots and the command boundary.
use super::*;

const WALL_CLOCK_MS: i64 = 1_760_000_000_000;

/// A connected session on `NAS100`, showing `M1` and advertising `H1` too.
fn connected_state() -> BridgeState {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-1".into());
    state.status.lock().unwrap().supported_timeframes = vec!["M1".into(), "H1".into()];
    *state.market.lock().unwrap() = MarketSnapshot {
        symbol: Some("NAS100".into()),
        timeframe: Some("M1".into()),
        complete: true,
        candles: Vec::new(),
    };
    state
}

fn series_request(key: &str, before_ms: Option<i64>) -> IndicatorSeriesRequest {
    IndicatorSeriesRequest::build(
        key.to_owned(),
        "NAS100".into(),
        "H1".into(),
        200,
        before_ms,
        WALL_CLOCK_MS,
    )
    .expect("valid series request")
}

#[test]
fn series_keys_accept_the_documented_charset_only() {
    let longest = "a".repeat(MAX_INDICATOR_SERIES_KEY_CHARS);
    let too_long = "a".repeat(MAX_INDICATOR_SERIES_KEY_CHARS + 1);
    for accepted in ["k", "macd-h1", "ema:5", "RSI_14", longest.as_str()] {
        assert!(is_valid_series_key(accepted), "{accepted} is a valid key");
    }
    for refused in [
        "",
        too_long.as_str(),
        "has space",
        "semi;colon",
        "slash/path",
        "zażółć",
    ] {
        assert!(!is_valid_series_key(refused), "{refused} is not a key");
    }
}

#[test]
fn newest_bars_are_anchored_one_year_past_the_wall_clock() {
    let newest = series_request("newest", None);
    assert_eq!(newest.before_ms, None, "the caller's own anchor is echoed");
    assert_eq!(
        newest.page.before_ms,
        Some(WALL_CLOCK_MS + NEWEST_SERIES_ANCHOR_LEAD_MS)
    );

    let anchored = series_request("older", Some(1_000));
    assert_eq!(anchored.before_ms, Some(1_000));
    assert_eq!(anchored.page.before_ms, Some(1_000));
    assert!(anchored.page.is_page());
}

#[test]
fn at_most_sixteen_keys_are_kept_and_the_oldest_drops_out() {
    let state = BridgeState::default();
    let keys: Vec<String> = (0..=MAX_INDICATOR_SERIES_KEYS)
        .map(|index| format!("key-{index}"))
        .collect();
    for key in &keys {
        series_slots(&state).queue(series_request(key, Some(1_000)));
    }
    let waiting = series_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(waiting.len(), MAX_INDICATOR_SERIES_KEYS);
    let kept: Vec<&str> = waiting
        .iter()
        .map(|series| series.request.key.as_str())
        .collect();
    assert!(
        !kept.contains(&keys[0].as_str()),
        "the oldest key is dropped"
    );
    assert!(kept.contains(&keys[MAX_INDICATOR_SERIES_KEYS].as_str()));
}

#[test]
fn a_newer_request_for_a_key_drops_the_response_it_awaited() {
    let state = BridgeState::default();
    series_slots(&state).queue(series_request("macd-h1", Some(1_000)));
    let first = series_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(first.len(), 1);

    series_slots(&state).queue(series_request("macd-h1", Some(500)));
    let second = series_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].request_id, second[0].request_id);

    let mut slots = series_slots(&state);
    assert!(
        slots.take_awaited(&first[0].request_id).is_none(),
        "the replaced request is no longer awaited"
    );
    let awaited = slots
        .take_awaited(&second[0].request_id)
        .expect("the newest request is awaited");
    assert_eq!(awaited.before_ms, Some(500));
    assert!(slots.take_awaited(&second[0].request_id).is_none());
}

#[test]
fn command_queues_a_series_without_touching_the_chart_slots() {
    let state = connected_state();
    request_indicator_series_inner(
        &state,
        "macd-h1".into(),
        "NAS100".into(),
        "H1".into(),
        300,
        None,
    )
    .expect("connected bridge accepts the series");

    let waiting = series_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request.key, "macd-h1");
    assert_eq!(waiting[0].request.page.symbol, "NAS100");
    assert_eq!(waiting[0].request.page.timeframe, "H1");
    assert_eq!(waiting[0].request.page.bars, 300);
    assert_eq!(waiting[0].request.before_ms, None);
    assert!(waiting[0].request.page.is_page());

    assert!(state.pending_history.lock().unwrap().is_none());
    assert!(state.expected_history.lock().unwrap().is_none());
    assert!(state.pending_history_page.lock().unwrap().is_none());
    assert!(state.expected_history_page.lock().unwrap().is_none());
    assert!(state.pending_tick_profile.lock().unwrap().is_none());
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.market.lock().unwrap().candles.is_empty());
}

#[test]
fn command_refuses_a_disconnected_bridge() {
    assert_eq!(
        request_indicator_series_inner(
            &BridgeState::default(),
            "macd-h1".into(),
            "NAS100".into(),
            "H1".into(),
            200,
            None,
        ),
        Err("bridge is not connected".to_owned())
    );
}

#[test]
fn command_refuses_an_invalid_key_pages_beyond_the_bound_and_other_series() {
    let state = connected_state();
    for (key, symbol, timeframe, bars, expected) in [
        (
            "bad key",
            "NAS100",
            "H1",
            200,
            "invalid indicator series key",
        ),
        ("macd-h1", "NAS100", "H1", 0, "invalid history request"),
        (
            "macd-h1",
            "EURUSD",
            "H1",
            200,
            "symbol is not the chart's symbol",
        ),
        (
            "macd-h1",
            "NAS100",
            "M5",
            200,
            "timeframe is not supported by the connected EA",
        ),
    ] {
        assert_eq!(
            request_indicator_series_inner(
                &state,
                key.into(),
                symbol.into(),
                timeframe.into(),
                bars,
                None,
            )
            .unwrap_err(),
            expected
        );
    }
    assert!(series_slots(&state)
        .claim_waiting(&state.next_request_id)
        .is_empty());
}

#[test]
fn command_refuses_another_symbol_without_the_capability() {
    let state = connected_state();
    assert_eq!(
        request_indicator_series_inner(
            &state,
            "ema:5".into(),
            "EURUSD".into(),
            "H1".into(),
            200,
            None,
        ),
        Err("symbol is not the chart's symbol".to_owned())
    );
    assert!(series_slots(&state)
        .claim_waiting(&state.next_request_id)
        .is_empty());
}

#[test]
fn command_queues_another_symbol_once_the_capability_is_negotiated() {
    let state = connected_state();
    state.status.lock().unwrap().other_symbol_series = true;
    request_indicator_series_inner(
        &state,
        "ema:5".into(),
        "EURUSD".into(),
        "H1".into(),
        200,
        Some(1_000),
    )
    .expect("a negotiated EA serves another symbol");

    let waiting = series_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request.key, "ema:5");
    assert_eq!(waiting[0].request.page.symbol, "EURUSD");
    assert_eq!(waiting[0].request.page.timeframe, "H1");
    assert_eq!(waiting[0].request.page.bars, 200);
    assert_eq!(waiting[0].request.before_ms, Some(1_000));
    assert!(waiting[0].request.page.is_page());
    assert!(state.pending_history_page.lock().unwrap().is_none());
    assert!(state.pending_history.lock().unwrap().is_none());
    assert_eq!(
        state.market.lock().unwrap().symbol.as_deref(),
        Some("NAS100"),
        "another symbol's series leaves the chart's own selection alone"
    );
}
