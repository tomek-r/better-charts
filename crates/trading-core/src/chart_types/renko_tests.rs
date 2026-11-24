use super::*;

fn price(text: &str) -> Decimal {
    text.parse().unwrap()
}

fn weekly(time_ms: i64, close: &str) -> PriceBar {
    let close = price(close);
    PriceBar {
        time_ms,
        open: close,
        high: close,
        low: close,
        close,
        volume: Decimal::from(10u64),
    }
}

/// One bar per close at consecutive times, which is all a Renko chart reads.
fn bars(closes: &[&str]) -> Vec<PriceBar> {
    closes
        .iter()
        .enumerate()
        .map(|(index, close)| weekly(i64::try_from(index).unwrap(), close))
        .collect()
}

fn traditional(box_size: &str) -> BoxSizing {
    BoxSizing::Traditional(price(box_size))
}

/// The time and the four prices of a brick, which is all a Renko chart draws.
type DrawnBrick = (i64, Decimal, Decimal, Decimal, Decimal);

fn summaries(bricks: &[ChartBar]) -> Vec<DrawnBrick> {
    bricks
        .iter()
        .map(|brick| {
            (
                brick.time_ms,
                brick.open,
                brick.high,
                brick.low,
                brick.close,
            )
        })
        .collect()
}

/// A brick whose high and low are its two levels.
fn body(time_ms: i64, open: &str, close: &str) -> DrawnBrick {
    let (open, close) = (price(open), price(close));
    (time_ms, open, open.max(close), open.min(close), close)
}

/// A brick whose wicks reach beyond its two levels.
fn wicked_brick(time_ms: i64, open: &str, high: &str, low: &str, close: &str) -> DrawnBrick {
    (time_ms, price(open), price(high), price(low), price(close))
}

#[test]
fn the_first_brick_hangs_on_the_nearest_multiple_of_the_box() {
    // 4378.48 is nearer to 5000 than to 0, so the trend starts from 5000 and no
    // brick ever covers 0 -> 5000.
    let up = bars(&["4378.48", "11165.41"]);
    assert_eq!(
        summaries(&renko(&up, traditional("5000"), RenkoWicks::Without).unwrap()),
        vec![body(1, "5000", "10000")]
    );
    // 7800 is nearer to 10000, so the first brick drops from 10000 instead.
    let down = bars(&["7800", "4800"]);
    assert_eq!(
        summaries(&renko(&down, traditional("5000"), RenkoWicks::Without).unwrap()),
        vec![body(1, "10000", "5000")]
    );
}

#[test]
fn a_close_inside_the_box_draws_nothing() {
    let closes = bars(&["4378.48", "6000", "9000", "5000", "4999.99"]);
    assert!(renko(&closes, traditional("5000"), RenkoWicks::Without)
        .unwrap()
        .is_empty());
}

#[test]
fn a_base_bar_draws_one_brick_per_full_box_at_increasing_times_and_its_volume() {
    let mut closes = bars(&["4378.48", "21000"]);
    closes[1].volume = price("42");
    let expected = vec![
        ChartBar {
            time_ms: 1,
            open: price("5000"),
            high: price("10000"),
            low: price("5000"),
            close: price("10000"),
            volume: price("42"),
        },
        ChartBar {
            time_ms: 2,
            open: price("10000"),
            high: price("15000"),
            low: price("10000"),
            close: price("15000"),
            volume: Decimal::ZERO,
        },
        ChartBar {
            time_ms: 3,
            open: price("15000"),
            high: price("20000"),
            low: price("15000"),
            close: price("20000"),
            volume: Decimal::ZERO,
        },
    ];
    assert_eq!(
        renko(&closes, traditional("5000"), RenkoWicks::Without),
        Ok(expected)
    );
}

#[test]
fn three_bricks_of_one_bar_get_the_bar_time_and_a_millisecond_each_after() {
    // TradingView times the two bricks of the week of 2021-02-08 1612742400000
    // and 1612742400001; the third brick of that bar follows one millisecond on.
    let mut closes = bars(&["4378.48", "21000"]);
    closes[1].time_ms = 1_612_742_400_000;
    let brick_times: Vec<i64> = renko(&closes, traditional("5000"), RenkoWicks::Without)
        .unwrap()
        .iter()
        .map(|brick| brick.time_ms)
        .collect();
    assert_eq!(
        brick_times,
        vec![1_612_742_400_000, 1_612_742_400_001, 1_612_742_400_002]
    );
}

#[test]
fn a_reversal_needs_a_close_two_boxes_below_the_last_top() {
    // A close back at the last brick's bottom is one box, too little; one box
    // further down turns the trend.
    let closes = bars(&["4378.48", "11165.41", "18860.02", "10000", "5000"]);
    let expected = vec![
        body(1, "5000", "10000"),
        body(2, "10000", "15000"),
        body(4, "10000", "5000"),
    ];
    assert_eq!(
        summaries(&renko(&closes, traditional("5000"), RenkoWicks::Without).unwrap()),
        expected
    );
}

#[test]
fn a_reversal_steps_one_brick_per_full_box() {
    // The base bars are one millisecond apart, so the second brick of a bar
    // already reaches the next bar's time and the times run on unbroken.
    let closes = bars(&["4378.48", "6100", "8000", "4900"]);
    let expected = vec![
        body(1, "4000", "5000"),
        body(2, "5000", "6000"),
        body(3, "6000", "7000"),
        body(4, "7000", "8000"),
        body(5, "7000", "6000"),
        body(6, "6000", "5000"),
    ];
    assert_eq!(
        summaries(&renko(&closes, traditional("1000"), RenkoWicks::Without).unwrap()),
        expected
    );
}

#[test]
fn wicks_reach_the_highest_close_since_the_last_brick() {
    // Weekly closes of the TradingView capture, then the close of the bar that
    // turns the trend. Its down brick reaches 16150.03, the highest close after
    // the brick of 2017-12-11, exactly as TradingView draws it.
    let closes = bars(&[
        "4378.48", "4640", "5709.99", "5950.02", "6169.98", "7345.01", "5811.03", "8038",
        "9128.02", "11165.41", "14899.98", "18860.02", "13500", "13716.36", "16150.03", "13474.99",
        "4085.78",
    ]);
    let expected = vec![
        body(9, "5000", "10000"),
        body(11, "10000", "15000"),
        wicked_brick(16, "10000", "16150.03", "5000", "5000"),
    ];
    assert_eq!(
        summaries(&renko(&closes, traditional("5000"), RenkoWicks::With).unwrap()),
        expected
    );
}

#[test]
fn without_wicks_a_brick_is_its_two_levels() {
    let closes = bars(&["4378.48", "11165.41", "16150.03", "4085.78"]);
    let expected = vec![
        body(1, "5000", "10000"),
        body(2, "10000", "15000"),
        body(3, "10000", "5000"),
    ];
    assert_eq!(
        summaries(&renko(&closes, traditional("5000"), RenkoWicks::Without).unwrap()),
        expected
    );
}

#[test]
fn only_the_first_brick_of_a_bar_carries_the_wicks() {
    // 7100 went beyond the last brick (6000 -> 7000) without drawing one, so the
    // first brick of the next bar reaches it; the bar's other bricks stay bodies
    // and the bar's own close of 3900 is no wick either. The bar draws two
    // bricks, at its own time and one millisecond later.
    let closes = bars(&["4378.48", "6100", "7800", "7100", "3900"]);
    let expected = vec![
        body(1, "4000", "5000"),
        body(2, "5000", "6000"),
        body(3, "6000", "7000"),
        wicked_brick(4, "6000", "7100", "5000", "5000"),
        body(5, "5000", "4000"),
    ];
    assert_eq!(
        summaries(&renko(&closes, traditional("1000"), RenkoWicks::With).unwrap()),
        expected
    );
}

#[test]
fn a_close_inside_the_last_brick_is_no_wick() {
    // 3500 sits inside the last brick (4000 -> 3000), which already covers it, so
    // the up brick that follows keeps its body low of 4000.
    let closes = bars(&["4378.48", "2900", "3500", "4100", "5100"]);
    let expected = vec![body(1, "4000", "3000"), body(4, "4000", "5000")];
    assert_eq!(
        summaries(&renko(&closes, traditional("1000"), RenkoWicks::With).unwrap()),
        expected
    );
}

#[test]
fn a_box_that_is_not_positive_is_rejected() {
    let closes = bars(&["4378.48"]);
    let rejected = [
        BoxSizing::Traditional(Decimal::ZERO),
        BoxSizing::Traditional(price("-5000")),
        BoxSizing::PercentageLtp(Decimal::ZERO),
    ];
    for sizing in rejected {
        assert_eq!(
            renko(&closes, sizing, RenkoWicks::Without),
            Err(ChartTypeError::NonPositiveParameter { name: "box_size" })
        );
    }
}

#[test]
fn a_zero_atr_length_is_rejected() {
    assert_eq!(
        renko(&bars(&["10"]), BoxSizing::Atr(0), RenkoWicks::Without),
        Err(ChartTypeError::NonPositiveParameter { name: "atr_length" })
    );
}

#[test]
fn an_atr_length_the_bars_cannot_fill_is_rejected() {
    let close_bars = bars(&["10", "11", "12"]);
    assert_eq!(
        renko(&close_bars, BoxSizing::Atr(14), RenkoWicks::Without),
        Err(ChartTypeError::NotEnoughBars {
            name: "atr_length",
            required: 15,
            available: 3,
        })
    );
}

#[test]
fn atr_boxes_follow_wilders_average_true_range() {
    // Every bar rises by 1000, so each true range is 1000 and so is ATR(3).
    let closes = bars(&["1000", "2000", "3000", "4000"]);
    let expected = vec![
        body(1, "1000", "2000"),
        body(2, "2000", "3000"),
        body(3, "3000", "4000"),
    ];
    assert_eq!(
        summaries(&renko(&closes, BoxSizing::Atr(3), RenkoWicks::Without).unwrap()),
        expected
    );
}

#[test]
fn a_percentage_box_is_a_share_of_the_last_close() {
    // 50% of the last close of 6000 is a box of 3000, so the grid hangs on 3000
    // and the jump to 6000 draws one brick.
    let closes = bars(&["4000", "6000"]);
    assert_eq!(
        summaries(
            &renko(
                &closes,
                BoxSizing::PercentageLtp(price("50")),
                RenkoWicks::Without
            )
            .unwrap()
        ),
        vec![body(1, "3000", "6000")]
    );
}

#[test]
fn the_ohlc_source_is_refused() {
    let closes = bars(&["4378.48"]);
    assert_eq!(
        renko_with_source(
            &closes,
            traditional("5000"),
            RenkoWicks::Without,
            RenkoSource::Ohlc
        ),
        Err(ChartTypeError::UnsupportedSource { name: "OHLC" })
    );
    assert_eq!(
        renko_with_source(
            &closes,
            traditional("5000"),
            RenkoWicks::Without,
            RenkoSource::Close
        ),
        renko(&closes, traditional("5000"), RenkoWicks::Without)
    );
}

#[test]
fn bars_out_of_order_are_rejected() {
    let mut unordered = bars(&["4378.48", "11165.41"]);
    unordered.swap(0, 1);
    assert_eq!(
        renko(&unordered, traditional("5000"), RenkoWicks::Without),
        Err(ChartTypeError::TimesNotIncreasing)
    );
    let mut duplicated = bars(&["4378.48", "11165.41"]);
    duplicated[1].time_ms = duplicated[0].time_ms;
    assert_eq!(
        renko(&duplicated, traditional("5000"), RenkoWicks::Without),
        Err(ChartTypeError::TimesNotIncreasing)
    );
}

#[test]
fn no_base_bars_means_no_bricks() {
    assert!(renko(&[], traditional("5000"), RenkoWicks::Without)
        .unwrap()
        .is_empty());
}
