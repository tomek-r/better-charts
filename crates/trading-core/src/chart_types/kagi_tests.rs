use super::*;

/// The reversal of the weekly TradingView capture in `.deepseek-done/truth/kagi.csv`.
const REVERSAL: &str = "5000";

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

/// The same closes, each bar carrying its own volume so a sum reads plainly.
fn bars_with_volumes(closes: &[&str], volumes: &[u64]) -> Vec<PriceBar> {
    closes
        .iter()
        .zip(volumes)
        .enumerate()
        .map(|(index, (close, volume))| PriceBar {
            volume: Decimal::from(*volume),
            ..bar(i64::try_from(index).unwrap(), close)
        })
        .collect()
}

/// The time, open and close of each line, which is most of what a Kagi chart says.
fn summaries(lines: &[ChartBar]) -> Vec<(i64, Decimal, Decimal)> {
    lines
        .iter()
        .map(|drawn| (drawn.time_ms, drawn.open, drawn.close))
        .collect()
}

fn line(time_ms: i64, open: &str, close: &str) -> (i64, Decimal, Decimal) {
    (time_ms, price(open), price(close))
}

fn volumes(lines: &[ChartBar]) -> Vec<Decimal> {
    lines.iter().map(|drawn| drawn.volume).collect()
}

#[test]
fn matches_trading_view_for_the_first_two_lines() {
    // The first thirteen weekly candles of the capture: one line up from the
    // first close to the high of 2017-12-11, which the closes of 4640, 5709.99
    // and the rest extend week after week instead of drawing a line each, then
    // the reversal of 2017-12-18, five thousand below that high.
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
    ];
    let expected = vec![
        ChartBar {
            time_ms: 0,
            open: price("4378.48"),
            high: price("18860.02"),
            low: price("4378.48"),
            close: price("18860.02"),
            volume: price("100"),
        },
        ChartBar {
            time_ms: 12,
            open: price("18860.02"),
            high: price("18860.02"),
            low: price("13500"),
            close: price("13500"),
            volume: price("10"),
        },
    ];
    assert_eq!(
        kagi(&bars, BoxSizing::Traditional(price(REVERSAL))),
        Ok(expected)
    );
}

#[test]
fn the_first_line_takes_the_first_bar_and_waits_for_a_close_that_differs() {
    let lines = kagi(
        &bars(&["10", "10", "8"]),
        BoxSizing::Traditional(price("5")),
    )
    .unwrap();
    let expected = ChartBar {
        time_ms: 0,
        open: price("10"),
        high: price("10"),
        low: price("8"),
        close: price("8"),
        volume: price("10"),
    };
    assert_eq!(lines, vec![expected]);
}

#[test]
fn higher_closes_extend_one_up_line() {
    // The first close above the opening one starts the line; the next close
    // above it extends that same line instead of drawing a second one.
    let lines = kagi(
        &bars(&["10", "12", "15"]),
        BoxSizing::Traditional(price("5")),
    )
    .unwrap();
    let expected = vec![line(0, "10", "15")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn an_equal_close_draws_nothing() {
    let lines = kagi(
        &bars(&["10", "12", "12"]),
        BoxSizing::Traditional(price("5")),
    )
    .unwrap();
    assert_eq!(summaries(&lines), vec![line(0, "10", "12")]);
}

#[test]
fn a_reversal_exactly_at_the_distance_turns_the_line() {
    let lines = kagi(
        &bars(&["10", "20", "15"]),
        BoxSizing::Traditional(price("5")),
    )
    .unwrap();
    let expected = vec![line(0, "10", "20"), line(2, "20", "15")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_close_short_of_the_distance_keeps_the_line() {
    let lines = kagi(
        &bars(&["10", "20", "15.01"]),
        BoxSizing::Traditional(price("5")),
    )
    .unwrap();
    assert_eq!(summaries(&lines), vec![line(0, "10", "20")]);
}

#[test]
fn alternating_reversals_draw_one_line_per_turn() {
    let lines = kagi(
        &bars(&["10", "20", "15", "25", "18"]),
        BoxSizing::Traditional(price("5")),
    )
    .unwrap();
    let expected = vec![
        line(0, "10", "20"),
        line(2, "20", "15"),
        line(3, "15", "25"),
        line(4, "25", "18"),
    ];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn an_up_reversal_measures_from_the_high_not_from_the_open() {
    // The line opens at 10 and climbs to 25; a close of 14 sits ten below that
    // high, although it is still above the open.
    let lines = kagi(
        &bars(&["10", "20", "15", "25", "14"]),
        BoxSizing::Traditional(price("10")),
    )
    .unwrap();
    let expected = vec![line(0, "10", "25"), line(4, "25", "14")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_down_reversal_measures_from_the_low_not_from_the_open() {
    let lines = kagi(
        &bars(&["50", "40", "45", "35", "46"]),
        BoxSizing::Traditional(price("10")),
    )
    .unwrap();
    let expected = vec![line(0, "50", "35"), line(4, "35", "46")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_line_covers_the_volume_of_the_bars_that_draw_or_extend_it() {
    // The equal close of the third bar extends nothing and turns nothing, so the
    // up line sums the first, second and fourth volumes and the reversal the
    // fifth.
    let bars = bars_with_volumes(&["10", "12", "12", "13", "9"], &[1, 2, 3, 4, 5]);
    let lines = kagi(&bars, BoxSizing::Traditional(price("2"))).unwrap();
    let expected = vec![line(0, "10", "13"), line(4, "13", "9")];
    assert_eq!(summaries(&lines), expected);
    assert_eq!(volumes(&lines), vec![price("6"), price("5")]);
}

#[test]
fn an_atr_sizing_turns_the_line_by_wilders_average_true_range() {
    // True ranges 0, 2 and 2 with a length of two: the mean of the first two is
    // 1, and the last bar smooths to (1 * 1 + 2) / 2 = 1.5. The close of 10.4
    // falls 1.6 below the line's high of 12 and turns it.
    let bars = [
        weekly(0, "10", "10", "10", "10"),
        weekly(1, "12", "12", "10", "12"),
        weekly(2, "10.4", "12", "10", "10.4"),
    ];
    let lines = kagi(&bars, BoxSizing::Atr(2)).unwrap();
    let expected = vec![line(0, "10", "12"), line(2, "12", "10.4")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_percentage_sizing_turns_the_line_by_a_share_of_the_last_close() {
    // Ten percent of the newest close of 100 is a distance of 10, so the close of
    // bar 3 lands exactly on the high of the line.
    let bars = bars(&["100", "110", "105", "100"]);
    let lines = kagi(&bars, BoxSizing::PercentageLtp(price("10"))).unwrap();
    let expected = vec![line(0, "100", "110"), line(3, "110", "100")];
    assert_eq!(summaries(&lines), expected);
}

#[test]
fn a_reversal_that_is_not_positive_is_rejected() {
    assert_eq!(
        kagi(&bars(&["10", "12"]), BoxSizing::Traditional(Decimal::ZERO)),
        Err(ChartTypeError::NonPositiveParameter { name: "reversal" })
    );
}

#[test]
fn a_zero_atr_length_is_rejected() {
    assert_eq!(
        kagi(&bars(&["10", "12"]), BoxSizing::Atr(0)),
        Err(ChartTypeError::NonPositiveParameter { name: "atr_length" })
    );
}

#[test]
fn a_percentage_that_is_not_positive_is_rejected() {
    assert_eq!(
        kagi(
            &bars(&["10", "12"]),
            BoxSizing::PercentageLtp(Decimal::ZERO)
        ),
        Err(ChartTypeError::NonPositiveParameter { name: "percentage" })
    );
}

#[test]
fn bars_out_of_order_are_rejected() {
    let mut unordered = bars(&["10", "20", "15"]);
    unordered.swap(0, 1);
    assert_eq!(
        kagi(&unordered, BoxSizing::Traditional(price("5"))),
        Err(ChartTypeError::TimesNotIncreasing)
    );
}

#[test]
fn no_base_bars_means_no_lines() {
    let lines = kagi(&[], BoxSizing::Traditional(price(REVERSAL))).unwrap();
    assert!(lines.is_empty());
}
