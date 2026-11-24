use super::*;

/// The window TradingView's default Line Break chart uses.
const WINDOW: u32 = 3;

fn price(text: &str) -> Decimal {
    text.parse().unwrap()
}

fn weekly(time_ms: i64, open: &str, high: &str, low: &str, close: &str) -> PriceBar {
    PriceBar {
        time_ms,
        open: price(open),
        high: price(high),
        low: price(low),
        close: price(close),
        volume: Decimal::from(10u64),
    }
}

fn bar(time_ms: i64, close: &str) -> PriceBar {
    weekly(time_ms, close, close, close, close)
}

fn bars(closes: &[&str]) -> Vec<PriceBar> {
    closes
        .iter()
        .enumerate()
        .map(|(index, close)| bar(i64::try_from(index).unwrap(), close))
        .collect()
}

/// The time, open and close of each line, which is all a Line Break bar says.
fn summaries(lines: &[ChartBar]) -> Vec<(i64, Decimal, Decimal)> {
    lines
        .iter()
        .map(|drawn| (drawn.time_ms, drawn.open, drawn.close))
        .collect()
}

fn line(time_ms: i64, open: &str, close: &str) -> (i64, Decimal, Decimal) {
    (time_ms, price(open), price(close))
}

#[test]
fn matches_trading_view_with_three_lines() {
    // Weekly candles of a TradingView capture, with every close of the capture
    // in order. Values follow the Line Break rules read off TradingView.
    let bars = [
        weekly(0, "4378.49", "4406.52", "4240.04", "4378.48"),
        weekly(1, "4400", "4658", "4110", "4640"),
        weekly(2, "4640", "5922.3", "4550", "5709.99"),
        weekly(3, "5710", "6171", "5037.95", "5950.02"),
        weekly(4, "5975", "6189.88", "5286.98", "6169.98"),
        weekly(5, "6133.01", "7590.25", "6030", "7345.01"),
        weekly(6, "7345.1", "7770.02", "5325.01", "5811.03"),
        weekly(7, "5839.94", "8123.15", "5699.99", "8038"),
        weekly(8, "8057.11", "9350", "7801", "9128.02"),
        weekly(9, "9128", "11825", "8520", "11165.41"),
        weekly(10, "11165.41", "17204.99", "10802", "14899.98"),
        weekly(11, "14946.26", "19798.68", "14666.56", "18860.02"),
        weekly(12, "18865", "19300", "10961", "13500"),
        weekly(13, "13500", "16498.05", "11750", "13716.36"),
        weekly(14, "13715.65", "17176.24", "12750", "16150.03"),
        weekly(15, "16218.85", "16322.3", "11400", "13474.99"),
        weekly(16, "13477.98", "14249.99", "9035", "11530"),
        weekly(17, "11530", "12244", "9900.24", "11879.95"),
        weekly(18, "11879.95", "11975.02", "7930", "8184.81"),
    ];
    let expected = vec![
        line(1, "4378.48", "4640"),
        line(2, "4640", "5709.99"),
        line(3, "5709.99", "5950.02"),
        line(4, "5950.02", "6169.98"),
        line(5, "6169.98", "7345.01"),
        line(7, "7345.01", "8038"),
        line(8, "8038", "9128.02"),
        line(9, "9128.02", "11165.41"),
        line(10, "11165.41", "14899.98"),
        line(11, "14899.98", "18860.02"),
        line(18, "14899.98", "8184.81"),
    ];
    assert_eq!(summaries(&line_break(&bars, WINDOW).unwrap()), expected);
}

#[test]
fn the_first_line_opens_at_the_first_close_on_the_first_bar_that_differs() {
    let mut closes = bars(&["10", "10", "9"]);
    closes[2].volume = price("42");
    let expected = ChartBar {
        time_ms: 2,
        open: price("10"),
        high: price("10"),
        low: price("9"),
        close: price("9"),
        volume: price("42"),
    };
    assert_eq!(line_break(&closes, WINDOW), Ok(vec![expected]));
}

#[test]
fn a_higher_close_extends_an_up_line_from_the_last_close() {
    let lines = line_break(&bars(&["10", "12", "15"]), WINDOW).unwrap();
    let expected = vec![line(1, "10", "12"), line(2, "12", "15")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_lower_close_extends_a_down_line_from_the_last_close() {
    let lines = line_break(&bars(&["10", "8", "5"]), WINDOW).unwrap();
    let expected = vec![line(1, "10", "8"), line(2, "8", "5")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn an_equal_close_draws_nothing() {
    let lines = line_break(&bars(&["10", "12", "12"]), WINDOW).unwrap();
    assert_eq!(summaries(&lines), vec![line(1, "10", "12")]);
}

#[test]
fn a_close_inside_the_window_draws_nothing() {
    let lines = line_break(&bars(&["10", "12", "11"]), WINDOW).unwrap();
    assert_eq!(summaries(&lines), vec![line(1, "10", "12")]);
}

#[test]
fn a_close_below_the_window_reverses_down_from_the_last_open() {
    let lines = line_break(&bars(&["10", "12", "9"]), WINDOW).unwrap();
    let expected = vec![line(1, "10", "12"), line(2, "10", "9")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_close_above_the_window_reverses_up_from_the_last_open() {
    let lines = line_break(&bars(&["10", "8", "12"]), WINDOW).unwrap();
    let expected = vec![line(1, "10", "8"), line(2, "10", "12")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_reversal_with_fewer_lines_than_the_window_uses_the_lines_drawn() {
    // Two lines exist, so their four opens and closes set the level the close
    // of bar 3 has to clear.
    let lines = line_break(&bars(&["10", "12", "9", "15"]), WINDOW).unwrap();
    let expected = vec![line(1, "10", "12"), line(2, "10", "9"), line(3, "10", "15")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn the_window_only_covers_the_last_lines() {
    let closes = bars(&["10", "12", "14", "13", "11"]);
    let wider = line_break(&closes, WINDOW).unwrap();
    assert_eq!(
        summaries(&wider),
        vec![line(1, "10", "12"), line(2, "12", "14")]
    );
    let narrow = line_break(&closes, 1).unwrap();
    let expected = vec![
        line(1, "10", "12"),
        line(2, "12", "14"),
        line(4, "12", "11"),
    ];
    assert_eq!(summaries(&narrow), expected);
}

#[test]
fn zero_lines_is_rejected() {
    assert_eq!(
        line_break(&bars(&["10"]), 0),
        Err(ChartTypeError::NonPositiveParameter {
            name: "number_of_lines"
        })
    );
}

#[test]
fn bars_out_of_order_are_rejected() {
    let mut unordered = bars(&["10", "12"]);
    unordered.swap(0, 1);
    assert_eq!(
        line_break(&unordered, WINDOW),
        Err(ChartTypeError::TimesNotIncreasing)
    );
    let mut duplicated = bars(&["10", "12"]);
    duplicated[1].time_ms = duplicated[0].time_ms;
    assert_eq!(
        line_break(&duplicated, WINDOW),
        Err(ChartTypeError::TimesNotIncreasing)
    );
}

#[test]
fn no_base_bars_means_no_lines() {
    assert!(line_break(&[], WINDOW).unwrap().is_empty());
}
