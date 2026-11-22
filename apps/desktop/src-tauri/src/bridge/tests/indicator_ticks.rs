//! The indicator ticks route: the caller key, the range and page bounds, the
//! bounded latest-per-key slots, the published wire shape and the command
//! boundary.
use super::*;
use trading_core::protocol::MarketTick;

/// Page size a default handshake negotiates.
const NEGOTIATED_PAGE_TICKS: u32 = 5_000;

/// A connected session showing `NAS100` on `M1`.
fn chart_state() -> BridgeState {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-1".into());
    *state.market.lock().unwrap() = MarketSnapshot {
        symbol: Some("NAS100".into()),
        timeframe: Some("M1".into()),
        complete: true,
        candles: Vec::new(),
    };
    state
}

fn ticks_request(
    key: &str,
    from_ms: i64,
    to_ms: i64,
    max_ticks: u32,
) -> Result<IndicatorTicksRequest, String> {
    IndicatorTicksRequest::build(
        key.to_owned(),
        "NAS100".into(),
        from_ms,
        to_ms,
        max_ticks,
        NEGOTIATED_PAGE_TICKS,
    )
}

fn valid_ticks_request(key: &str, from_ms: i64, to_ms: i64) -> IndicatorTicksRequest {
    ticks_request(key, from_ms, to_ms, NEGOTIATED_PAGE_TICKS).expect("valid ticks request")
}

#[test]
fn ticks_keys_use_the_indicator_series_charset() {
    let longest = "k".repeat(MAX_INDICATOR_SERIES_KEY_CHARS);
    let too_long = "k".repeat(MAX_INDICATOR_SERIES_KEY_CHARS + 1);
    for accepted in ["k", "volume-100", "atr:14", "SAR_3", longest.as_str()] {
        assert_eq!(
            valid_ticks_request(accepted, 1_000, 2_000).key,
            accepted,
            "{accepted} is a valid key"
        );
    }
    for refused in [
        "",
        too_long.as_str(),
        "has space",
        "semi;colon",
        "slash/path",
        "zażółć",
    ] {
        assert_eq!(
            ticks_request(refused, 1_000, 2_000, NEGOTIATED_PAGE_TICKS),
            Err("invalid indicator ticks key".to_owned()),
            "{refused} is not a key"
        );
    }
}

#[test]
fn the_range_and_the_page_follow_the_tick_history_bounds() {
    let refused = || Err("invalid tick history request".to_owned());
    assert_eq!(
        ticks_request("k", 1_000, 1_000, 10),
        refused(),
        "an empty range"
    );
    assert_eq!(
        ticks_request("k", 2_000, 1_000, 10),
        refused(),
        "an inverted range"
    );
    assert_eq!(
        ticks_request("k", -1, 1_000, 10),
        refused(),
        "a negative start"
    );
    assert_eq!(
        ticks_request("k", 1_000, 2_000, 0),
        refused(),
        "a zero page"
    );
    assert_eq!(
        ticks_request("k", 1_000, 2_000, NEGOTIATED_PAGE_TICKS + 1),
        refused(),
        "a page beyond the negotiated bound"
    );

    let accepted = valid_ticks_request("k", 1_000, 2_000);
    assert_eq!(accepted.key, "k");
    assert_eq!(accepted.page.symbol, "NAS100");
    assert_eq!(accepted.page.from_ms, 1_000);
    assert_eq!(accepted.page.to_ms, 2_000);
    assert_eq!(accepted.page.max_ticks, NEGOTIATED_PAGE_TICKS);
}

#[test]
fn at_most_eight_keys_are_kept_and_the_oldest_drops_out() {
    let state = BridgeState::default();
    let keys: Vec<String> = (0..=MAX_INDICATOR_TICK_KEYS)
        .map(|index| format!("key-{index}"))
        .collect();
    for key in &keys {
        ticks_slots(&state).queue(valid_ticks_request(key, 1_000, 2_000));
    }
    let waiting = ticks_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(waiting.len(), MAX_INDICATOR_TICK_KEYS);
    let kept: Vec<&str> = waiting
        .iter()
        .map(|ticks| ticks.request.key.as_str())
        .collect();
    assert!(
        !kept.contains(&keys[0].as_str()),
        "the oldest key is dropped"
    );
    assert!(kept.contains(&keys[MAX_INDICATOR_TICK_KEYS].as_str()));
    assert!(waiting[0].request_id.starts_with(INDICATOR_TICKS_ID_PREFIX));
}

#[test]
fn a_newer_request_for_a_key_drops_the_response_it_awaited() {
    let state = BridgeState::default();
    ticks_slots(&state).queue(valid_ticks_request("volume-100", 1_000, 2_000));
    let first = ticks_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(first.len(), 1);

    ticks_slots(&state).queue(valid_ticks_request("volume-100", 3_000, 4_000));
    let second = ticks_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].request_id, second[0].request_id);

    let mut slots = ticks_slots(&state);
    assert!(
        slots.take_awaited(&first[0].request_id).is_none(),
        "the replaced request is no longer awaited"
    );
    let awaited = slots
        .take_awaited(&second[0].request_id)
        .expect("the newest request is awaited");
    assert_eq!(awaited.page.from_ms, 3_000);
    assert_eq!(awaited.page.to_ms, 4_000);
}

#[test]
fn command_queues_ticks_without_touching_the_tick_profile_slots() {
    let state = chart_state();
    request_indicator_ticks_inner(
        &state,
        "volume-100".into(),
        "NAS100".into(),
        1_000,
        2_000,
        500,
    )
    .expect("connected bridge accepts the ticks");

    let waiting = ticks_slots(&state).claim_waiting(&state.next_request_id);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request.key, "volume-100");
    assert_eq!(waiting[0].request.page.symbol, "NAS100");
    assert_eq!(waiting[0].request.page.from_ms, 1_000);
    assert_eq!(waiting[0].request.page.to_ms, 2_000);
    assert_eq!(waiting[0].request.page.max_ticks, 500);

    assert!(state.pending_tick_profile.lock().unwrap().is_none());
    assert!(state.expected_tick_profile.lock().unwrap().is_none());
    assert!(state.tick_controller.lock().unwrap().active.is_none());
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.pending_history.lock().unwrap().is_none());
    assert!(state.pending_history_page.lock().unwrap().is_none());
    let series_waiting = state
        .indicator_series
        .lock()
        .unwrap()
        .claim_waiting(&state.next_request_id);
    assert!(series_waiting.is_empty(), "the series route is untouched");
}

#[test]
fn command_refuses_a_disconnected_bridge() {
    assert_eq!(
        request_indicator_ticks_inner(
            &BridgeState::default(),
            "volume-100".into(),
            "NAS100".into(),
            1_000,
            2_000,
            500,
        ),
        Err("bridge is not connected".to_owned())
    );
}

#[test]
fn command_refuses_other_symbols_and_pages_beyond_the_negotiated_bound() {
    let state = chart_state();
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1_000;
    for (key, symbol, from_ms, to_ms, max_ticks, expected) in [
        (
            "volume-100",
            "EURUSD",
            1_000,
            2_000,
            500,
            "symbol is not the chart's symbol",
        ),
        (
            "volume-100",
            "NAS100",
            1_000,
            2_000,
            1_001,
            "invalid tick history request",
        ),
        (
            "bad key",
            "NAS100",
            1_000,
            2_000,
            500,
            "invalid indicator ticks key",
        ),
    ] {
        assert_eq!(
            request_indicator_ticks_inner(
                &state,
                key.into(),
                symbol.into(),
                from_ms,
                to_ms,
                max_ticks,
            )
            .unwrap_err(),
            expected
        );
    }
    assert!(ticks_slots(&state)
        .claim_waiting(&state.next_request_id)
        .is_empty());
}

#[test]
fn clearing_the_ticks_slots_drops_queued_and_awaited_requests() {
    let state = BridgeState::default();
    ticks_slots(&state).queue(valid_ticks_request("volume-100", 1_000, 2_000));
    let waiting = ticks_slots(&state).claim_waiting(&state.next_request_id);
    clear_indicator_ticks(&state);
    let mut slots = ticks_slots(&state);
    assert!(slots.take_awaited(&waiting[0].request_id).is_none());
    assert!(slots.claim_waiting(&state.next_request_id).is_empty());
}

#[test]
fn the_published_page_keeps_the_decimal_strings_of_the_wire() {
    let view = IndicatorTicksView {
        key: "volume-100".into(),
        symbol: "NAS100".into(),
        from_ms: 1_000,
        to_ms: 2_000,
        complete: true,
        ticks: vec![IndicatorTickView::from(&MarketTick {
            time_ms: 1_500,
            bid: "25000.1".into(),
            ask: "25000.3".into(),
            last: "0".into(),
            volume: 7,
            volume_real: "0".into(),
            flags: 6,
        })],
    };
    let json = serde_json::to_value(view).unwrap();
    assert_eq!(json["key"], "volume-100");
    assert_eq!(json["symbol"], "NAS100");
    assert_eq!(json["fromMs"], 1_000);
    assert_eq!(json["toMs"], 2_000);
    assert_eq!(json["complete"], true);
    assert_eq!(json["ticks"][0]["timeMs"], 1_500);
    assert_eq!(json["ticks"][0]["bid"], "25000.1");
    assert_eq!(json["ticks"][0]["ask"], "25000.3");
    assert_eq!(json["ticks"][0]["last"], "0");
    assert_eq!(json["ticks"][0]["volume"], 7);
    // The profile-only wire fields stay out of this event.
    assert!(json["ticks"][0].get("volumeReal").is_none());
    assert!(json["ticks"][0].get("flags").is_none());
    assert!(json.get("from_ms").is_none());
}
