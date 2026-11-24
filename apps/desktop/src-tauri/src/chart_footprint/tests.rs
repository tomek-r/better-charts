//! The chart footprint's request validation, the automatic row size it resolves from a window, and
//! the payload it publishes on the wire.

use super::events::{ChartFootprintEvent, CHART_FOOTPRINT_EVENT};
use super::{
    auto_row_size, average_true_range, footprint_settings, is_on, resolve_row_size, set_request,
    ChartFootprintRequest, ChartFootprintRowSize,
};
use crate::bridge::state::BridgeState;
use rust_decimal::Decimal;
use trading_core::footprint::{
    bar_footprint, FootprintSettings, FootprintTick, TICK_FLAG_BUY, TICK_FLAG_SELL,
};
use trading_core::protocol::MarketCandle;

/// The decimal `value` names.
fn dec(value: &str) -> Decimal {
    value.parse().expect("a decimal")
}

/// A tenth of a point, the tick size of a one-digit contract such as NAS100.
fn point_tenth() -> Decimal {
    dec("0.1")
}

/// A quarter point, a tick size that quarters exactly in decimal.
fn quarter() -> Decimal {
    dec("0.25")
}

/// A request naming its own row width, with percentages every test may keep.
fn manual(ticks_per_row: u32) -> ChartFootprintRequest {
    ChartFootprintRequest {
        row_size: ChartFootprintRowSize::Manual { ticks_per_row },
        va_percent: dec("70"),
        imbalance_percent: dec("300"),
    }
}

/// A request for the automatic row width over `atr_length` bars.
fn automatic(atr_length: u32) -> ChartFootprintRequest {
    ChartFootprintRequest {
        row_size: ChartFootprintRowSize::Auto { atr_length },
        va_percent: dec("70"),
        imbalance_percent: dec("300"),
    }
}

/// A request with the row width and the two percentages as given.
fn request(
    row_size: ChartFootprintRowSize,
    va_percent: Decimal,
    imbalance_percent: Decimal,
) -> ChartFootprintRequest {
    ChartFootprintRequest {
        row_size,
        va_percent,
        imbalance_percent,
    }
}

/// A bar whose open and close are `close`, reaching `high` and `low`.
fn candle(high: &str, low: &str, close: &str) -> MarketCandle {
    MarketCandle {
        time_ms: 0,
        open: close.to_owned(),
        high: high.to_owned(),
        low: low.to_owned(),
        close: close.to_owned(),
        tick_volume: 1,
        spread: 0,
        real_volume: 0,
    }
}

/// Four bars whose true ranges are 4, 4 and 2, hand-computed from the closes `100`, `102` and `104`:
/// the first two bars span four points, and the third closes flat inside the second bar's range.
fn four_bars() -> [MarketCandle; 4] {
    [
        candle("100", "98", "100"),
        candle("104", "100", "102"),
        candle("106", "102", "104"),
        candle("105", "103", "104"),
    ]
}

/// The row width the chart's settings carry, while it asked for one.
fn row_width(state: &BridgeState) -> Option<u32> {
    footprint_settings(state).map(|settings| settings.ticks_per_row)
}

/// A state with nothing asked yet.
fn off_state() -> BridgeState {
    BridgeState::with_symbol_cache_path(None)
}

/// The decimal `value` carries as the wire's decimal string.
fn decimal_text(value: &serde_json::Value) -> Decimal {
    value
        .as_str()
        .expect("a decimal string")
        .parse()
        .expect("a decimal")
}

#[test]
fn a_manual_request_states_its_row_width_at_once() {
    let state = off_state();

    let enabled = set_request(&state, Some(manual(3))).expect("a manual width is valid");

    assert!(enabled);
    let settings = footprint_settings(&state).expect("the chart footprint is on");
    assert_eq!(settings.ticks_per_row, 3);
    assert_eq!(
        (settings.va_percent, settings.imbalance_percent),
        (dec("70"), dec("300"))
    );
}

#[test]
fn an_automatic_request_waits_for_the_window_to_name_its_row() {
    let state = off_state();
    set_request(&state, Some(automatic(2))).expect("an automatic width is valid");

    // Nothing resolves it before a window: the narrowest row stands, so no event names a rowless
    // footprint on a chart that has none yet.
    assert_eq!(row_width(&state), Some(1));

    // A fifth of the smoothed three-point range over a tenth-point tick: 0.2 * 3 / 0.1.
    resolve_row_size(&state, &four_bars(), Some(point_tenth()));
    assert_eq!(row_width(&state), Some(6));
}

#[test]
fn turning_the_chart_footprint_off_stops_its_settings() {
    let state = off_state();
    set_request(&state, Some(manual(3))).expect("a manual width is valid");

    let enabled = set_request(&state, None).expect("turning it off never fails");

    assert!(!enabled);
    assert!(footprint_settings(&state).is_none());
    assert!(!is_on(&state));
}

#[test]
fn a_request_outside_the_engine_bounds_is_refused_with_its_reason() {
    let refuse = |request: ChartFootprintRequest| {
        set_request(&off_state(), Some(request)).expect_err("the request is outside the bounds")
    };

    let no_rows = request(
        ChartFootprintRowSize::Manual { ticks_per_row: 0 },
        dec("70"),
        dec("300"),
    );
    assert_eq!(refuse(no_rows), "ticksPerRow must be at least 1");
    assert_eq!(refuse(automatic(0)), "atrLength must be between 1 and 500");
    assert_eq!(
        refuse(automatic(501)),
        "atrLength must be between 1 and 500"
    );

    let flat_va = request(
        ChartFootprintRowSize::Manual { ticks_per_row: 10 },
        dec("0"),
        dec("300"),
    );
    assert_eq!(
        refuse(flat_va),
        "vaPercent must be greater than 0 and at most 100"
    );
    let over_va = request(
        ChartFootprintRowSize::Manual { ticks_per_row: 10 },
        dec("100.5"),
        dec("300"),
    );
    assert_eq!(
        refuse(over_va),
        "vaPercent must be greater than 0 and at most 100"
    );
    let no_imb = request(
        ChartFootprintRowSize::Manual { ticks_per_row: 10 },
        dec("70"),
        dec("0"),
    );
    assert_eq!(refuse(no_imb), "imbalancePercent must be greater than 0");

    assert!(
        set_request(&off_state(), Some(automatic(500))).is_ok(),
        "the longest ATR a request may name is accepted"
    );
}

#[test]
fn a_refused_request_leaves_the_chart_footprint_as_it_was() {
    let state = off_state();
    set_request(&state, Some(manual(4))).expect("a manual width is valid");

    assert!(set_request(&state, Some(automatic(0))).is_err());

    assert_eq!(
        row_width(&state),
        Some(4),
        "the refused request changed nothing"
    );
}

#[test]
fn the_request_reads_its_percentages_as_numbers_and_as_strings() {
    let numbers: ChartFootprintRequest = serde_json::from_str(
        r#"{
            "rowSize": { "kind": "manual", "ticksPerRow": 10 },
            "vaPercent": 70,
            "imbalancePercent": 300
        }"#,
    )
    .expect("a request of JSON numbers");

    assert_eq!(
        numbers.row_size,
        ChartFootprintRowSize::Manual { ticks_per_row: 10 }
    );
    assert_eq!(numbers.va_percent, dec("70"));
    assert_eq!(numbers.imbalance_percent, dec("300"));

    let mixed: ChartFootprintRequest = serde_json::from_str(
        r#"{
            "rowSize": { "kind": "auto", "atrLength": 14 },
            "vaPercent": 68.5,
            "imbalancePercent": "2.5"
        }"#,
    )
    .expect("a request of a fractional number and a decimal string");

    assert_eq!(
        mixed.row_size,
        ChartFootprintRowSize::Auto { atr_length: 14 }
    );
    assert_eq!(mixed.va_percent, dec("68.5"));
    assert_eq!(mixed.imbalance_percent, dec("2.5"));
    assert!(mixed.validate().is_ok());
}

#[test]
fn wilders_average_holds_the_seed_mean_and_smooths_the_bars_after_it() {
    let bars = four_bars();

    // Length 2 seeds with the mean of the first two ranges (4 and 4) and smooths the third (2):
    // (4 * 1 + 2) / 2.
    assert_eq!(average_true_range(&bars, 2), Some(dec("3")));

    // A length past the window averages every range it has: (4 + 4 + 2) / 3.
    let averaged = average_true_range(&bars, 500).expect("four bars hold three ranges");
    assert_eq!(averaged.round_dp(6), dec("3.333333"));
}

#[test]
fn a_window_without_a_range_averages_nothing() {
    let flat = [candle("100", "100", "100"), candle("100", "100", "100")];

    assert_eq!(average_true_range(&flat, 14), Some(Decimal::ZERO));
    assert_eq!(
        average_true_range(&[candle("100", "100", "100")], 14),
        None,
        "one bar has no range"
    );
    assert_eq!(
        average_true_range(
            &[candle("bad", "100", "100"), candle("100", "100", "100")],
            14
        ),
        None,
        "a price the host cannot read averages nothing"
    );
    assert_eq!(
        average_true_range(&four_bars(), 0),
        None,
        "no length, no average"
    );
}

#[test]
fn the_automatic_row_spans_a_fifth_of_the_window_range_in_ticks() {
    let bars = four_bars();

    // A fifth of the smoothed three points over a tenth-point tick.
    assert_eq!(auto_row_size(&bars, Some(point_tenth()), 2), 6);
    // A quarter-point tick names rows of two and a half points, rounded to two.
    assert_eq!(auto_row_size(&bars, Some(quarter()), 2), 2);
    // The widest average the window has: 0.2 * 3.333 / 0.1, rounded.
    assert_eq!(auto_row_size(&bars, Some(point_tenth()), 500), 7);
}

#[test]
fn an_automatic_row_is_never_narrower_than_one_tick() {
    let flat = [candle("100", "100", "100"), candle("100", "100", "100")];

    assert_eq!(
        auto_row_size(&flat, Some(point_tenth()), 14),
        1,
        "a window that did not move names one tick"
    );
    assert_eq!(
        auto_row_size(&four_bars(), None, 2),
        1,
        "a symbol the mirror does not know names one tick"
    );
    assert_eq!(
        auto_row_size(&four_bars(), Some(Decimal::ZERO), 2),
        1,
        "no tick size, one tick"
    );
}

#[test]
fn the_published_event_serializes_prices_and_volumes_as_decimal_strings() {
    let settings = FootprintSettings {
        ticks_per_row: 10,
        va_percent: dec("70"),
        imbalance_percent: dec("300"),
    };
    let ticks = [
        FootprintTick::from_flags(1, dec("100.1"), dec("2.5"), TICK_FLAG_BUY),
        FootprintTick::from_flags(2, dec("100.2"), dec("1"), TICK_FLAG_SELL),
    ];
    let bar = bar_footprint(0, &ticks, point_tenth(), &settings).expect("a bar of two trades");
    let event = ChartFootprintEvent {
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        ticks_per_row: settings.ticks_per_row,
        bars: vec![bar],
        incomplete_before: None,
        incomplete: Vec::new(),
    };

    let json = serde_json::to_value(&event).expect("the event serializes");

    assert_eq!(CHART_FOOTPRINT_EVENT, "chart-footprint");
    assert_eq!(json["symbol"], "NAS100");
    assert_eq!(json["timeframe"], "M1");
    assert_eq!(json["ticksPerRow"], 10);
    assert_eq!(json["incompleteBefore"], serde_json::Value::Null);
    assert_eq!(json["bars"][0]["openMs"], 0);
    assert_eq!(json["bars"][0]["volume"], "real");
    assert_eq!(decimal_text(&json["bars"][0]["buyVolume"]), dec("2.5"));
    assert_eq!(decimal_text(&json["bars"][0]["sellVolume"]), dec("1"));
    assert_eq!(json["bars"][0]["rows"][0]["row"], 100);
    assert_eq!(
        decimal_text(&json["bars"][0]["rows"][0]["downPrice"]),
        dec("100")
    );
    assert_eq!(
        decimal_text(&json["bars"][0]["rows"][0]["upPrice"]),
        dec("101")
    );
    assert_eq!(
        decimal_text(&json["bars"][0]["rows"][0]["buyVolume"]),
        dec("2.5")
    );
}
