use super::*;

fn price(text: &str) -> Decimal {
    text.parse().unwrap()
}

fn base_bar(time_ms: i64, open: &str, high: &str, low: &str, close: &str) -> PriceBar {
    PriceBar {
        time_ms,
        open: price(open),
        high: price(high),
        low: price(low),
        close: price(close),
        volume: Decimal::from(10u64),
    }
}

fn chart_bar(time_ms: i64, open: &str, high: &str, low: &str, close: &str) -> ChartBar {
    ChartBar {
        time_ms,
        open: price(open),
        high: price(high),
        low: price(low),
        close: price(close),
        volume: Decimal::from(10u64),
    }
}

#[test]
fn the_first_bar_averages_its_own_open_and_close() {
    let chart = heikin_ashi(&[base_bar(0, "10", "18", "8", "14")]);
    assert_eq!(chart, vec![chart_bar(0, "12", "18", "8", "12.5")]);
}

#[test]
fn later_bars_average_the_previous_heikin_ashi_open_and_close() {
    let bars = [
        base_bar(0, "10", "18", "8", "14"),
        base_bar(1, "14", "22", "12", "20"),
    ];
    let chart = heikin_ashi(&bars);
    assert_eq!(chart[0], chart_bar(0, "12", "18", "8", "12.5"));
    assert_eq!(chart[1], chart_bar(1, "12.25", "22", "12", "17"));
}

#[test]
fn the_heikin_ashi_open_widens_the_range_above_the_base_high() {
    let bars = [
        base_bar(0, "10", "100", "1", "90"),
        base_bar(1, "20", "21", "19", "20"),
    ];
    assert_eq!(
        heikin_ashi(&bars)[1],
        chart_bar(1, "50.125", "50.125", "19", "20")
    );
}

#[test]
fn the_heikin_ashi_open_widens_the_range_below_the_base_low() {
    let chart = heikin_ashi(&[base_bar(0, "10", "14", "12", "10.2")]);
    assert_eq!(chart[0], chart_bar(0, "10.1", "14", "10.1", "11.55"));
}

#[test]
fn time_and_volume_are_the_base_bar_s() {
    let base = PriceBar {
        volume: price("42"),
        ..base_bar(7_000, "10", "18", "8", "14")
    };
    let chart = heikin_ashi(&[base]);
    assert_eq!((chart[0].time_ms, chart[0].volume), (7_000, price("42")));
}

#[test]
fn no_base_bars_means_no_chart_bars() {
    assert!(heikin_ashi(&[]).is_empty());
}

#[test]
fn matches_trading_view_weekly_bars() {
    // The first two weekly candles of a TradingView capture; the Heikin Ashi
    // values are worked out from the formulas.
    let bars = [
        base_bar(0, "4378.49", "4406.52", "4240.04", "4378.48"),
        base_bar(1, "4400", "4658", "4110", "4640"),
    ];
    let chart = heikin_ashi(&bars);
    assert_eq!(
        chart[0],
        chart_bar(0, "4378.485", "4406.52", "4240.04", "4350.8825")
    );
    assert_eq!(chart[1], chart_bar(1, "4364.68375", "4658", "4110", "4452"));
}
