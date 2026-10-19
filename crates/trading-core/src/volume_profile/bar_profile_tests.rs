use super::*;
use crate::volume_profile::{
    calculate_fixed_range_profile, FixedRangeProfileAccumulator, Tick, TICK_FLAG_ASK, TICK_FLAG_BID,
};

fn candle(
    open: &str,
    high: &str,
    low: &str,
    close: &str,
    volume: u64,
    spread: u32,
) -> MarketCandle {
    MarketCandle {
        time_ms: 0,
        open: open.into(),
        high: high.into(),
        low: low.into(),
        close: close.into(),
        tick_volume: volume,
        spread,
        real_volume: 0,
    }
}

fn config(rows: usize, tick_size: &str) -> FixedRangeProfileConfig {
    FixedRangeProfileConfig {
        rows,
        tick_size: tick_size.parse().unwrap(),
        ..FixedRangeProfileConfig::default()
    }
}

fn series(profile: &FixedRangeProfile) -> (Vec<u64>, Vec<u64>, Vec<u64>) {
    (
        profile.bins.iter().map(|bin| bin.total).collect(),
        profile.bins.iter().map(|bin| bin.bid).collect(),
        profile.bins.iter().map(|bin| bin.ask).collect(),
    )
}

fn dec(value: &str) -> Decimal {
    value.parse().unwrap()
}

// ---- estimate_profile_load ----

#[test]
fn estimate_sums_ticks_and_bounds_price_levels() {
    let bars = [
        candle("100", "101", "100", "101", 30, 0),
        candle("101", "102", "100.5", "100.5", 12, 0),
    ];
    let estimate = estimate_profile_load(&bars, dec("0.5"), dec("0.01")).unwrap();
    assert_eq!(estimate.ticks, 42);
    // (102 - 100) / 0.5 = 4 -> 4 + 1 levels.
    assert_eq!(estimate.distinct_prices, 5);
}

#[test]
fn estimate_of_no_bars_is_zero() {
    let estimate = estimate_profile_load(&[], dec("0.01"), dec("0.01")).unwrap();
    assert_eq!(estimate, ProfileLoadEstimate::default());
}

#[test]
fn estimate_includes_widest_spread_and_rounds_up() {
    let bars = [
        candle("100", "101", "100", "100", 1, 5),
        candle("100", "100.5", "100", "100", 1, 20),
    ];
    // 101 + 20 * 0.01 - 100 = 1.2 -> ceil(1.2 / 0.5) = 3 -> 4 levels.
    let estimate = estimate_profile_load(&bars, dec("0.5"), dec("0.01")).unwrap();
    assert_eq!(estimate.distinct_prices, 4);
}

#[test]
fn estimate_saturates_instead_of_overflowing() {
    let bars = [
        candle("1", "1", "1", "1", u64::MAX, 0),
        candle("1", "1", "1", "1", 5, 0),
    ];
    assert_eq!(
        estimate_profile_load(&bars, dec("1"), dec("1"))
            .unwrap()
            .ticks,
        u64::MAX
    );
}

#[test]
fn estimate_rejects_unusable_inputs() {
    let bars = [candle("1", "2", "1", "1", 1, 0)];
    assert!(estimate_profile_load(&bars, dec("0"), dec("0.01")).is_err());
    assert!(estimate_profile_load(&bars, dec("0.01"), dec("-1")).is_err());
    let broken = [candle("1", "x", "1", "1", 1, 0)];
    assert!(estimate_profile_load(&broken, dec("1"), dec("0")).is_err());
}

#[test]
fn estimate_is_an_upper_bound_of_the_tick_accumulator() {
    // Quotes in cents: bid within [100.00, 100.09], ask = bid + 3 points.
    let flags = TICK_FLAG_BID | TICK_FLAG_ASK;
    let mut accumulator = FixedRangeProfileAccumulator::new(1_000);
    for cents in [10_000_i64, 10_003, 10_009, 10_001, 10_007, 10_005] {
        let bid = Decimal::new(cents, 2);
        let ask = bid + Decimal::new(3, 2);
        accumulator
            .push(&Tick {
                time_millis: 0,
                bid,
                ask,
                flags,
            })
            .unwrap();
    }
    let bars = [candle("100.00", "100.09", "100.00", "100.05", 6, 3)];
    let estimate = estimate_profile_load(&bars, dec("0.01"), dec("0.01")).unwrap();
    assert!(estimate.distinct_prices >= accumulator.price_count() as u64);
}

// ---- calculate_bar_profile ----

#[test]
fn single_bar_spreads_evenly_over_the_rows_it_overlaps() {
    let bars = [candle("100", "104", "100", "104", 8, 0)];
    let profile = calculate_bar_profile(&bars, &config(128, "1")).unwrap();
    let (total, bid, ask) = series(&profile);
    assert_eq!(total, [2, 2, 2, 2, 0]);
    assert_eq!(ask, [2, 2, 2, 2, 0]);
    assert_eq!(bid, [0; 5]);
    assert_eq!(profile.total_weight, 8);
    assert_eq!(profile.rejected_ticks, 0);
}

#[test]
fn flat_bar_goes_entirely_to_its_row() {
    let bars = [
        candle("100", "102", "100", "102", 4, 0),
        candle("101.4", "101.4", "101.4", "101.4", 9, 0),
    ];
    let profile = calculate_bar_profile(&bars, &config(128, "1")).unwrap();
    // The flat bar is a doji: 9 -> 5 up / 4 down in row [101, 102).
    assert_eq!(series(&profile).0, [2, 11, 0]);
    assert_eq!(series(&profile).2, [2, 7, 0]);
    assert_eq!(series(&profile).1, [0, 4, 0]);
}

#[test]
fn apportionment_preserves_each_bars_volume_and_is_deterministic() {
    let bars = [candle("100", "103", "100", "103", 10, 0)];
    let profile = calculate_bar_profile(&bars, &config(128, "1")).unwrap();
    // 10 / 3 = 3 remainder 1 each; the extra unit goes to the lowest price.
    assert_eq!(series(&profile).0, [4, 3, 3, 0]);
    assert_eq!(
        profile,
        calculate_bar_profile(&bars, &config(128, "1")).unwrap()
    );

    let uneven = [
        candle("100", "100.7", "100", "100.7", 1_001, 0),
        candle("100.3", "103.1", "100.3", "100.3", 777, 0),
        candle("101", "102", "101", "101", 3, 0),
    ];
    let profile = calculate_bar_profile(&uneven, &config(128, "1")).unwrap();
    assert_eq!(profile.total_weight, 1_001 + 777 + 3);
    for bin in &profile.bins {
        assert_eq!(bin.total, bin.bid + bin.ask);
    }
}

#[test]
fn up_down_and_doji_bars_split_volume_between_ask_and_bid() {
    let cfg = config(128, "1");
    let up = calculate_bar_profile(&[candle("100", "102", "100", "102", 6, 0)], &cfg).unwrap();
    assert_eq!(series(&up).2, [3, 3, 0]);
    assert_eq!(series(&up).1, [0, 0, 0]);

    let down = calculate_bar_profile(&[candle("102", "102", "100", "100", 6, 0)], &cfg).unwrap();
    assert_eq!(series(&down).1, [3, 3, 0]);
    assert_eq!(series(&down).2, [0, 0, 0]);

    // Doji with odd volume: the odd unit goes to up (ask).
    let doji = calculate_bar_profile(&[candle("101", "101", "101", "101", 5, 0)], &cfg).unwrap();
    assert_eq!(series(&doji).2, [3]);
    assert_eq!(series(&doji).1, [2]);
    assert_eq!(series(&doji).0, [5]);
}

#[test]
fn grid_matches_the_tick_profile_for_the_same_extremes() {
    let cfg = config(4, "0.1");
    let bars = [candle("100.0", "105.3", "100.0", "105.3", 10, 0)];
    let from_bars = calculate_bar_profile(&bars, &cfg).unwrap();
    let ticks = [dec("100.0"), dec("105.3")].map(|price| Tick {
        time_millis: 0,
        bid: price,
        ask: price,
        flags: TICK_FLAG_BID,
    });
    let from_ticks = calculate_fixed_range_profile(&cfg, &ticks);
    assert_eq!(from_bars.actual_rows, from_ticks.actual_rows);
    for (bar_bin, tick_bin) in from_bars.bins.iter().zip(&from_ticks.bins) {
        assert_eq!(
            (&bar_bin.low, &bar_bin.high, &bar_bin.center),
            (&tick_bin.low, &tick_bin.high, &tick_bin.center)
        );
    }
}

#[test]
fn levels_follow_the_value_area_rules() {
    let bars = [
        candle("100", "102", "100", "102", 6, 0),
        candle("101.4", "101.4", "101.4", "101.4", 4, 0),
    ];
    let profile = calculate_bar_profile(&bars, &config(128, "1")).unwrap();
    assert_eq!(series(&profile).0, [3, 7, 0]);
    assert_eq!(profile.poc.as_deref(), Some("101.5"));
    assert_eq!(profile.vah.as_deref(), Some("102"));
    assert_eq!(profile.val.as_deref(), Some("101"));
    assert_eq!(profile.ask_poc.as_deref(), Some("101.5"));
    assert_eq!(profile.bid_poc.as_deref(), Some("101.5"));
}

#[test]
fn empty_input_and_unusable_config_give_the_empty_profile() {
    let empty = calculate_bar_profile(&[], &config(128, "1")).unwrap();
    assert_eq!(empty, calculate_fixed_range_profile(&config(128, "1"), &[]));
    let bars = [candle("1", "2", "1", "2", 5, 0)];
    assert_eq!(
        calculate_bar_profile(&bars, &config(0, "1")).unwrap(),
        empty
    );
    assert_eq!(
        calculate_bar_profile(&bars, &config(8, "0")).unwrap(),
        empty
    );
    let silent = [candle("1", "2", "1", "2", 0, 0)];
    assert_eq!(
        calculate_bar_profile(&silent, &config(8, "1")).unwrap(),
        empty
    );
}

#[test]
fn invalid_bars_are_rejected() {
    let cfg = config(8, "1");
    for bad in [
        candle("1", "1", "2", "1", 1, 0),
        candle("3", "2", "1", "1", 1, 0),
        candle("1", "2", "1", "3", 1, 0),
        candle("0", "2", "0", "1", 1, 0),
        candle("-1", "2", "-1", "1", 1, 0),
        candle("1", "2", "abc", "1", 1, 0),
        candle("1", "2", "1", "0.5", 1, 0),
    ] {
        assert!(
            calculate_bar_profile(std::slice::from_ref(&bad), &cfg).is_err(),
            "{bad:?}"
        );
    }
}

// ---- bar_timeframe_for_range ----

fn codes(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[test]
fn smallest_timeframe_within_the_bar_budget_is_chosen() {
    let all = codes(&["M1", "M5", "H1", "D1", "W1"]);
    let minute = 60_000_i64;
    assert_eq!(
        bar_timeframe_for_range(1000 * minute, &all, 1000),
        Some("M1")
    );
    assert_eq!(
        bar_timeframe_for_range(1000 * minute + 1, &all, 1000),
        Some("M5")
    );
    assert_eq!(
        bar_timeframe_for_range(5000 * minute, &all, 1000),
        Some("M5")
    );
    assert_eq!(
        bar_timeframe_for_range(1000 * 60 * minute, &all, 1000),
        Some("H1")
    );
    assert_eq!(
        bar_timeframe_for_range(1000 * 60 * minute + 1, &all, 1000),
        Some("D1")
    );
    assert_eq!(
        bar_timeframe_for_range(1000 * 1440 * minute, &all, 1000),
        Some("D1")
    );
    assert_eq!(
        bar_timeframe_for_range(1000 * 10_080 * minute, &all, 1000),
        Some("W1")
    );
    assert_eq!(
        bar_timeframe_for_range(1000 * 10_080 * minute + 1, &all, 1000),
        None
    );
}

#[test]
fn timeframe_chooser_ignores_unknown_codes_and_order_and_bad_input() {
    let shuffled = codes(&["H1", "bogus", "M5"]);
    assert_eq!(bar_timeframe_for_range(60_000, &shuffled, 10), Some("M5"));
    assert_eq!(bar_timeframe_for_range(60_000, &[], 10), None);
    assert_eq!(bar_timeframe_for_range(0, &shuffled, 10), None);
    assert_eq!(bar_timeframe_for_range(60_000, &shuffled, 0), None);
}

fn timed(time_ms: i64) -> MarketCandle {
    MarketCandle {
        time_ms,
        ..candle("10", "11", "9", "10", 1, 0)
    }
}

fn budget() -> ProfileBudget {
    ProfileBudget {
        max_ticks: 1_000,
        max_distinct_prices: 500,
        max_pages: 10,
        ticks_per_page: 100,
    }
}

#[test]
fn estimate_within_every_limit_fits_the_tick_budget() {
    let estimate = ProfileLoadEstimate {
        ticks: 1_000,
        distinct_prices: 500,
    };
    assert!(!estimate.exceeds(&budget()));
}

#[test]
fn estimate_over_the_tick_budget_exceeds() {
    let estimate = ProfileLoadEstimate {
        ticks: 1_001,
        distinct_prices: 1,
    };
    assert!(estimate.exceeds(&ProfileBudget {
        max_pages: u64::MAX,
        ..budget()
    }));
}

#[test]
fn estimate_over_the_distinct_price_limit_exceeds() {
    let estimate = ProfileLoadEstimate {
        ticks: 1,
        distinct_prices: 501,
    };
    assert!(estimate.exceeds(&budget()));
}

#[test]
fn estimate_needing_more_pages_than_allowed_exceeds() {
    let tight = ProfileBudget {
        max_pages: 2,
        ..budget()
    };
    let at_limit = ProfileLoadEstimate {
        ticks: 200,
        distinct_prices: 1,
    };
    let over = ProfileLoadEstimate {
        ticks: 201,
        distinct_prices: 1,
    };
    assert!(!at_limit.exceeds(&tight));
    assert!(over.exceeds(&tight));
}

#[test]
fn zero_page_size_is_unaffordable() {
    let estimate = ProfileLoadEstimate::default();
    assert!(estimate.exceeds(&ProfileBudget {
        ticks_per_page: 0,
        ..budget()
    }));
}

#[test]
fn bar_close_adds_the_nominal_length() {
    assert_eq!(bar_close_ms(1_000, "M1"), Some(61_000));
    assert_eq!(bar_close_ms(0, "H1"), Some(3_600_000));
    assert_eq!(bar_close_ms(0, "W1"), Some(604_800_000));
    assert_eq!(bar_close_ms(0, "bogus"), None);
}

#[test]
fn monthly_bar_closes_on_the_next_calendar_month() {
    // Pinned because the subject is month-length and year-rollover known answers.
    // 2024-02-01 (leap February, 29 days) -> 2024-03-01.
    assert_eq!(
        bar_close_ms(1_706_745_600_000, "MN1"),
        Some(1_709_251_200_000)
    );
    // 2023-12-01 -> 2024-01-01 crosses the year.
    assert_eq!(
        bar_close_ms(1_701_388_800_000, "MN1"),
        Some(1_704_067_200_000)
    );
}

#[test]
fn overlap_keeps_bars_touching_the_range_and_drops_the_rest() {
    let minute = 60_000;
    let bars = (0..6)
        .map(|index| timed(index * minute))
        .collect::<Vec<_>>();
    // Range [90s, 4m): bar 1 (60..120s) overlaps its start, bar 3 (180..240s) its end.
    let kept = bars_overlapping_range(&bars, "M1", 90_000, 4 * minute).unwrap();
    let opens = kept.iter().map(|bar| bar.time_ms).collect::<Vec<_>>();
    assert_eq!(opens, vec![minute, 2 * minute, 3 * minute]);
}

#[test]
fn overlap_excludes_a_bar_that_only_touches_a_boundary() {
    let minute = 60_000;
    let bars = vec![timed(0), timed(minute), timed(2 * minute)];
    // Bar 0 closes exactly at from; bar 2 opens exactly at end.
    let kept = bars_overlapping_range(&bars, "M1", minute, 2 * minute).unwrap();
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].time_ms, minute);
}

#[test]
fn overlap_rejects_an_unknown_timeframe() {
    assert!(bars_overlapping_range(&[timed(0)], "X9", 0, 10).is_err());
}

// ---- coarser fallbacks and partial coverage ----

#[test]
fn fallback_timeframes_at_least_double_stop_at_the_coarsest_and_respect_the_limit() {
    let all = codes(&["D1", "M2", "H1", "M1", "M3", "W1", "H4", "XX"]);
    // M3 is skipped (not twice M2), the rest at least double each step.
    assert_eq!(
        bar_timeframes_coarser_than("M2", &all, "D1", 10),
        vec!["H1", "H4", "D1"]
    );
    assert_eq!(
        bar_timeframes_coarser_than("M1", &all, "D1", 10),
        vec!["M2", "H1", "H4", "D1"]
    );
    assert_eq!(
        bar_timeframes_coarser_than("M1", &all, "D1", 2),
        vec!["M2", "H1"]
    );
    assert_eq!(
        bar_timeframes_coarser_than("M2", &all, "H1", 10),
        vec!["H1"]
    );
    assert!(bar_timeframes_coarser_than("D1", &all, "D1", 10).is_empty());
    assert!(bar_timeframes_coarser_than("??", &all, "D1", 10).is_empty());
    assert!(bar_timeframes_coarser_than("M2", &all, "??", 10).is_empty());
}

#[test]
fn partial_coverage_start_is_the_oldest_bar_only_when_it_opens_after_the_range_start() {
    let bar_at = |time_ms| MarketCandle {
        time_ms,
        ..candle("1", "1", "1", "1", 1, 0)
    };
    let bars = [bar_at(500), bar_at(600)];
    assert_eq!(partial_coverage_start(&bars, 400), Some(500));
    assert_eq!(partial_coverage_start(&bars, 500), None);
    assert_eq!(partial_coverage_start(&bars, 550), None);
    assert_eq!(partial_coverage_start(&[], 400), None);
}
