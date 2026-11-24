use super::*;

/// One candle as the chart sends it: decimal-string prices and a tick volume, because the stub
/// broker reports no real volume.
fn candle(
    time_ms: i64,
    open: &str,
    high: &str,
    low: &str,
    close: &str,
    tick_volume: u64,
) -> ChartCandleInput {
    ChartCandleInput {
        time_ms,
        open: open.into(),
        high: high.into(),
        low: low.into(),
        close: close.into(),
        tick_volume,
        spread: 0,
        real_volume: 0,
    }
}

/// One expected chart bar.
fn bar(
    time_ms: i64,
    open: &str,
    high: &str,
    low: &str,
    close: &str,
    volume: &str,
) -> ChartTypeBarView {
    ChartTypeBarView {
        time_ms,
        open: open.into(),
        high: high.into(),
        low: low.into(),
        close: close.into(),
        volume: volume.into(),
    }
}

/// A Renko chart with a traditional box of `box_size` price points.
fn traditional_renko(box_size: &str) -> ChartTypeSpec {
    ChartTypeSpec::Renko {
        box_method: BoxMethod::Traditional,
        atr_length: 14,
        box_size: box_size.into(),
        percentage: "1".into(),
        wicks: false,
    }
}

#[test]
fn heikin_ashi_averages_every_bar_with_the_one_before_it() {
    let candles = vec![
        candle(1, "100", "110", "90", "105", 10),
        candle(2, "105", "115", "100", "110", 20),
        candle(3, "110", "120", "105", "115", 30),
    ];

    let drawn = compute_chart_type_bars(candles, ChartTypeSpec::HeikinAshi)
        .expect("Heikin Ashi draws every bar");

    assert_eq!(
        drawn,
        vec![
            bar(1, "102.5", "110", "90", "101.25", "10"),
            bar(2, "101.875", "115", "100", "107.5", "20"),
            bar(3, "104.6875", "120", "104.6875", "112.5", "30"),
        ]
    );
}

#[test]
fn line_break_keeps_the_closes_that_start_a_new_line() {
    let candles = vec![
        candle(1, "100", "100", "100", "100", 1),
        candle(2, "100", "105", "100", "105", 2),
        candle(3, "105", "105", "102", "102", 3),
        candle(4, "102", "102", "95", "95", 4),
    ];
    let chart = ChartTypeSpec::LineBreak { lines: 3 };

    let drawn =
        compute_chart_type_bars(candles, chart).expect("Line Break draws one line per new move");

    assert_eq!(
        drawn,
        vec![
            bar(2, "100", "105", "100", "105", "2"),
            bar(4, "100", "100", "95", "95", "4"),
        ]
    );
}

#[test]
fn renko_traditional_stacks_a_brick_per_box_the_close_reaches() {
    let candles = vec![
        candle(1, "100", "100", "100", "100", 5),
        candle(2, "100", "112", "100", "112", 7),
        candle(3, "112", "112", "103", "103", 9),
    ];

    let drawn = compute_chart_type_bars(candles, traditional_renko("5"))
        .expect("Renko stacks two bricks of five points");

    assert_eq!(
        drawn,
        vec![
            bar(2, "100", "105", "100", "105", "7"),
            bar(3, "105", "110", "105", "110", "0"),
        ]
    );
}

#[test]
fn an_invalid_decimal_setting_names_the_field_to_fix() {
    let candles = vec![candle(1, "100", "101", "99", "100", 1)];

    let error = compute_chart_type_bars(candles, traditional_renko("five"))
        .expect_err("a box size that is not a decimal is refused");

    assert_eq!(error, "invalid decimal boxSize");
}

#[test]
fn a_box_that_is_not_positive_is_refused() {
    let candles = vec![candle(1, "100", "101", "99", "100", 1)];

    let error = compute_chart_type_bars(candles, traditional_renko("0"))
        .expect_err("a box no price can fill is refused");

    assert_eq!(error, "box_size must be positive");
}

#[test]
fn the_settings_send_one_camel_case_spec_per_chart_type() {
    let specs = [
        r#"{"type": "heikinAshi"}"#,
        r#"{"type": "lineBreak", "lines": 3}"#,
        r#"{"type": "renko", "boxMethod": "atr", "atrLength": 14, "boxSize": "5", "percentage": "1", "wicks": true}"#,
        r#"{"type": "kagi", "reversalMethod": "percentageLtp", "atrLength": 14, "reversal": "5", "percentage": "1"}"#,
        r#"{"type": "pointFigure", "source": "highLow", "boxMethod": "traditional", "atrLength": 14, "boxSize": "5", "percentage": "1", "reversal": 3}"#,
    ];

    for spec in specs {
        serde_json::from_str::<ChartTypeSpec>(spec).expect("the settings spec parses");
    }
}
