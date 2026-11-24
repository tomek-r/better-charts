use super::PointFigureSource::{Close, HighLow};
use super::*;

/// A box of 100 keeps the hand-computed grid levels short.
const BOX: &str = "100";

/// TradingView's default three-box reversal.
const REVERSAL: u32 = 3;

fn price(text: &str) -> Decimal {
    text.parse().unwrap()
}

fn traditional() -> BoxSizing {
    BoxSizing::Traditional(price(BOX))
}

/// A base bar as the "hl" source reads it, which ignores the open and the
/// close.
fn bar(time_ms: i64, high: &str, low: &str, volume: u64) -> PriceBar {
    PriceBar {
        time_ms,
        open: price(low),
        high: price(high),
        low: price(low),
        close: price(high),
        volume: Decimal::from(volume),
    }
}

/// A base bar whose high and low would draw another column than its close.
fn close_bar(time_ms: i64, close: &str, high: &str, low: &str) -> PriceBar {
    PriceBar {
        time_ms,
        open: price(low),
        high: price(high),
        low: price(low),
        close: price(close),
        volume: Decimal::from(10u64),
    }
}

fn drawn(time_ms: i64, open: &str, high: &str, low: &str, close: &str, volume: u64) -> ChartBar {
    ChartBar {
        time_ms,
        open: price(open),
        high: price(high),
        low: price(low),
        close: price(close),
        volume: Decimal::from(volume),
    }
}

#[test]
fn the_first_column_rises_from_the_box_below_the_first_low() {
    let bars = [bar(0, "1100", "900", 10)];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "900", "1100", "900", "1100", 10)],
        "the lowest box holds the first low and the highest box its high"
    );
}

#[test]
fn a_higher_box_extends_the_rising_column() {
    let bars = [bar(0, "1100", "900", 10), bar(1, "1400", "950", 20)];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "900", "1400", "900", "1400", 30)],
        "1400 floors to the 1400 box and the column keeps the first bar's time"
    );
}

#[test]
fn a_bar_inside_the_top_box_only_adds_volume() {
    let bars = [bar(0, "1100", "900", 10), bar(1, "1199", "1000", 20)];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "900", "1100", "900", "1100", 30)],
        "1199 floors to 1100 and 1000 stays above the 800 a reversal needs"
    );
}

#[test]
fn a_reversal_needs_three_boxes_against_the_column() {
    let bars = [bar(0, "1100", "900", 10), bar(1, "1050", "800", 20)];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![
            drawn(0, "900", "1100", "900", "1100", 10),
            drawn(1, "1000", "1000", "800", "800", 20),
        ],
        "800 is exactly three boxes under 1100, so an O column opens at 1000"
    );
}

#[test]
fn a_bar_one_box_short_does_not_reverse() {
    let bars = [bar(0, "1100", "900", 10), bar(1, "1050", "850", 20)];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "900", "1100", "900", "1100", 30)],
        "850 is above the 800 a reversal needs"
    );
}

#[test]
fn an_extension_wins_over_a_reversal_on_the_same_bar() {
    let bars = [bar(0, "1100", "900", 10), bar(1, "1250", "800", 20)];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "900", "1200", "900", "1200", 30)],
        "1250 floors to the 1200 box, so the low of 800 draws nothing"
    );
}

#[test]
fn a_falling_column_extends_down_and_reverses_up() {
    let bars = [
        bar(0, "1100", "900", 10),
        bar(1, "1050", "700", 20),
        bar(2, "1050", "600", 30),
        bar(3, "950", "900", 40),
    ];
    let columns = point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![
            drawn(0, "900", "1100", "900", "1100", 10),
            drawn(1, "1000", "1000", "600", "600", 50),
            drawn(3, "700", "900", "700", "900", 40),
        ],
        "the O column sums both bars it covers down to 600, so the next X opens at 700"
    );
}

#[test]
fn the_source_decides_which_prices_are_read() {
    let bars = [
        close_bar(0, "1000", "1500", "900"),
        close_bar(1, "1300", "1600", "950"),
    ];
    assert_eq!(
        point_figure(&bars, Close, traditional(), REVERSAL).unwrap(),
        vec![drawn(0, "1000", "1300", "1000", "1300", 20)],
        "the closes floor to 1000 and 1300 one box apart"
    );
    assert_eq!(
        point_figure(&bars, HighLow, traditional(), REVERSAL).unwrap(),
        vec![drawn(0, "900", "1600", "900", "1600", 20)],
        "the high and the low draw a wider column"
    );
}

#[test]
fn the_close_source_reverses_on_the_close_too() {
    let bars = [
        close_bar(0, "1000", "1500", "900"),
        close_bar(1, "1300", "1600", "950"),
        close_bar(2, "900", "1700", "800"),
    ];
    let columns = point_figure(&bars, Close, traditional(), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![
            drawn(0, "1000", "1300", "1000", "1300", 20),
            drawn(2, "1200", "1200", "900", "900", 10),
        ],
        "a close of 900 is three boxes under 1300"
    );
}

#[test]
fn a_percentage_box_is_a_share_of_the_last_close() {
    let bars = [
        close_bar(0, "1000", "1000", "1000"),
        close_bar(1, "2000", "2000", "2000"),
    ];
    let sizing = BoxSizing::PercentageLtp(price("10"));
    let columns = point_figure(&bars, Close, sizing, REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "1000", "2000", "1000", "2000", 20)],
        "10% of the last close 2000 is a 200 box"
    );
}

#[test]
fn a_true_range_box_averages_the_last_true_ranges() {
    let bars = [
        bar(0, "1100", "1000", 10),
        bar(1, "1200", "1100", 10),
        bar(2, "1300", "1200", 10),
    ];
    let columns = point_figure(&bars, HighLow, BoxSizing::Atr(2), REVERSAL).unwrap();
    assert_eq!(
        columns,
        vec![drawn(0, "1000", "1300", "1000", "1300", 30)],
        "both true ranges are 100, so the box is 100"
    );
}

#[test]
fn a_zero_reversal_is_rejected() {
    assert_eq!(
        point_figure(&[bar(0, "1100", "900", 10)], HighLow, traditional(), 0),
        Err(ChartTypeError::NonPositiveParameter { name: "reversal" })
    );
}

#[test]
fn a_non_positive_box_is_rejected() {
    let sizing = BoxSizing::Traditional(Decimal::ZERO);
    assert_eq!(
        point_figure(&[bar(0, "1100", "900", 10)], HighLow, sizing, REVERSAL),
        Err(ChartTypeError::NonPositiveParameter { name: "box_size" })
    );
}

#[test]
fn a_true_range_box_needs_its_length_of_bars() {
    assert_eq!(
        point_figure(
            &[bar(0, "1100", "1000", 10)],
            HighLow,
            BoxSizing::Atr(1),
            REVERSAL
        ),
        Err(ChartTypeError::NotEnoughBars {
            name: "atr_length",
            required: 2,
            available: 1,
        })
    );
}

#[test]
fn a_true_range_length_of_zero_is_rejected() {
    let bars = [bar(0, "1100", "1000", 10), bar(1, "1200", "1100", 10)];
    assert_eq!(
        point_figure(&bars, HighLow, BoxSizing::Atr(0), REVERSAL),
        Err(ChartTypeError::NonPositiveParameter { name: "atr_length" })
    );
}

#[test]
fn a_percentage_box_needs_a_close() {
    let sizing = BoxSizing::PercentageLtp(price("10"));
    assert_eq!(
        point_figure(&[], Close, sizing, REVERSAL),
        Err(ChartTypeError::NotEnoughBars {
            name: "percentage_ltp",
            required: 1,
            available: 0,
        })
    );
}

#[test]
fn bars_out_of_order_are_rejected() {
    let mut unordered = [bar(0, "1100", "900", 10), bar(1, "1400", "950", 20)];
    unordered.swap(0, 1);
    assert_eq!(
        point_figure(&unordered, HighLow, traditional(), REVERSAL),
        Err(ChartTypeError::TimesNotIncreasing)
    );
}

#[test]
fn no_base_bars_means_no_columns() {
    assert!(point_figure(&[], HighLow, traditional(), REVERSAL)
        .unwrap()
        .is_empty());
}
