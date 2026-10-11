use super::*;

const STEP: i64 = 60_000;

fn bar_at(index: i64, volume: u64) -> MarketCandle {
    MarketCandle {
        time_ms: index * STEP,
        open: "1.0".into(),
        high: "1.2".into(),
        low: "0.9".into(),
        close: "1.1".into(),
        tick_volume: volume,
        spread: 1,
        real_volume: 0,
    }
}

fn bars(range: std::ops::Range<i64>, volume: u64) -> Vec<MarketCandle> {
    range.map(|index| bar_at(index, volume)).collect()
}

fn times(series: &BarSeries) -> Vec<i64> {
    series.bars().iter().map(|bar| bar.time_ms / STEP).collect()
}

fn series(range: std::ops::Range<i64>) -> BarSeries {
    BarSeries::new("M1", bars(range, 1), false).unwrap()
}

#[test]
fn rejects_empty_unordered_and_duplicate_bars() {
    assert_eq!(
        BarSeries::new("M1", vec![], false),
        Err(BarSeriesError::Empty)
    );
    let mut unordered = bars(0..3, 1);
    unordered.swap(0, 2);
    assert_eq!(
        BarSeries::new("M1", unordered, false),
        Err(BarSeriesError::NotStrictlyIncreasing)
    );
    let mut duplicated = bars(0..3, 1);
    duplicated.push(bar_at(2, 1));
    assert_eq!(
        BarSeries::new("M1", duplicated, false),
        Err(BarSeriesError::NotStrictlyIncreasing)
    );
}

#[test]
fn newest_bar_is_replaced_and_newer_bars_appended() {
    let mut held = series(10..20);
    let mut fresh = bars(19..25, 7);
    fresh[0].tick_volume = 99;
    held.merge_newer(fresh, false).unwrap();
    assert_eq!(times(&held), (10..25).collect::<Vec<_>>());
    assert_eq!(held.bars()[9].tick_volume, 99);
    assert_eq!(held.bars()[8].tick_volume, 1);
}

#[test]
fn newer_bars_overlapping_closed_bars_take_the_fresh_version() {
    let mut held = series(10..20);
    held.merge_newer(bars(15..22, 5), false).unwrap();
    assert_eq!(times(&held), (10..22).collect::<Vec<_>>());
    assert!(held.bars()[5..].iter().all(|bar| bar.tick_volume == 5));
    assert!(held.bars()[..5].iter().all(|bar| bar.tick_volume == 1));
}

#[test]
fn newer_bars_that_leave_a_gap_are_rejected_and_nothing_changes() {
    let mut held = series(10..20);
    assert_eq!(
        held.merge_newer(bars(21..30, 1), false),
        Err(BarSeriesError::Gap)
    );
    assert_eq!(times(&held), (10..20).collect::<Vec<_>>());
}

#[test]
fn newer_bars_disagreeing_on_closed_bar_times_are_rejected() {
    let mut held = series(10..20);
    let mut fresh = bars(15..22, 1);
    fresh.remove(2);
    assert_eq!(
        held.merge_newer(fresh, false),
        Err(BarSeriesError::OverlapMismatch)
    );
    assert_eq!(times(&held), (10..20).collect::<Vec<_>>());
}

#[test]
fn newer_bars_must_be_strictly_increasing() {
    let mut held = series(10..20);
    let mut fresh = bars(19..23, 1);
    fresh.swap(1, 2);
    assert_eq!(
        held.merge_newer(fresh, false),
        Err(BarSeriesError::NotStrictlyIncreasing)
    );
    assert_eq!(held.merge_newer(vec![], false), Err(BarSeriesError::Empty));
}

#[test]
fn fresh_bars_swallowing_the_series_replace_it() {
    let mut held = BarSeries::new("M1", bars(10..20, 1), true).unwrap();
    held.merge_newer(bars(5..22, 3), false).unwrap();
    assert_eq!(times(&held), (5..22).collect::<Vec<_>>());
    assert!(!held.history_start_reached());
}

#[test]
fn older_bars_are_prepended_and_must_end_before_the_series() {
    let mut held = series(10..20);
    held.merge_older(bars(4..10, 2), true).unwrap();
    assert_eq!(times(&held), (4..20).collect::<Vec<_>>());
    assert!(held.history_start_reached());
    assert_eq!(
        held.merge_older(bars(0..5, 2), false),
        Err(BarSeriesError::NotStrictlyIncreasing)
    );
    assert_eq!(times(&held), (4..20).collect::<Vec<_>>());
}

#[test]
fn coverage_reports_what_is_missing() {
    let held = series(10..20);
    let inside = held.coverage(12 * STEP, 19 * STEP);
    assert!(inside.is_complete());
    let live = held.coverage(12 * STEP, 40 * STEP);
    assert_eq!((live.refresh_newest, live.extend_older), (true, false));
    let longer = held.coverage(5 * STEP, 19 * STEP);
    assert_eq!((longer.refresh_newest, longer.extend_older), (false, true));
    let at_start = BarSeries::new("M1", bars(10..20, 1), true).unwrap();
    assert!(!at_start.coverage(5 * STEP, 19 * STEP).extend_older);
}

#[test]
fn covering_returns_the_bar_containing_the_start_up_to_the_range_end() {
    let held = series(10..20);
    let slice = held.covering(12 * STEP + 5, 15 * STEP);
    assert_eq!(
        slice
            .iter()
            .map(|bar| bar.time_ms / STEP)
            .collect::<Vec<_>>(),
        vec![12, 13, 14]
    );
    assert_eq!(held.covering(0, 11 * STEP).len(), 1);
    assert!(held.covering(30 * STEP, 40 * STEP).len() <= 1);
}

#[test]
fn truncation_keeps_the_newest_bars_and_forgets_the_history_start() {
    let mut held = BarSeries::new("M1", bars(10..20, 1), true).unwrap();
    held.truncate_oldest(4);
    assert_eq!(times(&held), vec![16, 17, 18, 19]);
    assert!(!held.history_start_reached());
    held.truncate_oldest(100);
    assert_eq!(held.len(), 4);
}
