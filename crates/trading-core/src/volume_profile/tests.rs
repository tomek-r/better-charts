use super::*;

#[test]
fn merged_remote_price_counts_match_raw_ticks_and_grid_fallback() {
    let ticks = [
        tick(1, 100, 101, 2),
        tick(2, 100, 101, 4),
        tick(3, 100, 101, 6),
        tick(4, 110, 111, 0),
        tick(5, 0, 111, 6),
    ];
    let mut counts = FixedRangeProfileAccumulator::new(10);
    counts
        .merge_price_counts(Decimal::from(100), [3, 2, 0], true)
        .unwrap();
    counts
        .merge_price_counts(Decimal::from(101), [0, 0, 2], false)
        .unwrap();
    counts
        .merge_price_counts(Decimal::from(110), [0, 0, 0], true)
        .unwrap();
    counts
        .merge_price_counts(Decimal::ZERO, [0, 0, 0], true)
        .unwrap();
    counts
        .merge_quote_range(1, Some((Decimal::ZERO, Decimal::from(111))))
        .unwrap();
    assert_eq!(counts.inferred_tick_size(), Decimal::from(10));
    let config = FixedRangeProfileConfig {
        rows: 128,
        tick_size: counts.inferred_tick_size(),
        ..Default::default()
    };
    assert_eq!(
        counts.calculate(&config),
        calculate_fixed_range_profile(&config, &ticks)
    );
}

fn tick(time_millis: i64, bid: i64, ask: i64, flags: u32) -> Tick {
    Tick {
        time_millis,
        bid: Decimal::from(bid),
        ask: Decimal::from(ask),
        flags,
    }
}
fn config(rows: usize) -> VolumeProfileConfig {
    VolumeProfileConfig {
        rows,
        tick_size: Decimal::ONE,
        value_area_percent: Decimal::new(70, 2),
    }
}

#[test]
fn empty_and_rejected_ticks_are_reported() {
    let ticks = vec![
        tick(1, 0, 2, TICK_FLAG_BID),
        tick(2, 1, -1, TICK_FLAG_ASK),
        tick(10, 2, 3, TICK_FLAG_BID),
    ];
    let profile = calculate_volume_profile(&ticks, 0, 10, &config(128)).unwrap();
    assert_eq!(profile.rejected, 2);
    assert_eq!(profile.total_weight, 0);
    assert!(profile.poc.is_none());
    let empty = calculate_volume_profile(&[], 0, 10, &config(128)).unwrap();
    assert!(empty.bins.is_empty());
}

#[test]
fn uses_half_open_range_and_aligned_bins() {
    let ticks = vec![
        tick(0, 10, 11, TICK_FLAG_BID),
        tick(9, 11, 12, TICK_FLAG_BID),
        tick(10, 99, 100, TICK_FLAG_BID),
    ];
    let profile = calculate_volume_profile(&ticks, 0, 10, &config(128)).unwrap();
    assert_eq!(profile.total_weight, 2);
    assert_eq!(profile.bins.len(), 2);
    assert_eq!(profile.bins[0].low, "10");
    assert_eq!(profile.bins[0].high, "11");
}

#[test]
fn row_count_uses_tick_units_for_fractional_and_large_tick_sizes() {
    let ticks = vec![
        Tick {
            time_millis: 1,
            bid: Decimal::new(10, 1),
            ask: Decimal::new(11, 1),
            flags: TICK_FLAG_BID,
        },
        Tick {
            time_millis: 2,
            bid: Decimal::new(34, 1),
            ask: Decimal::new(35, 1),
            flags: TICK_FLAG_BID,
        },
    ];
    let fractional = VolumeProfileConfig {
        rows: 4,
        tick_size: Decimal::new(1, 1),
        value_area_percent: Decimal::new(70, 2),
    };
    let profile = calculate_volume_profile(&ticks, 0, 10, &fractional).unwrap();
    assert_eq!(profile.bins.len(), 4);

    let wide_range_ticks = vec![
        ticks[0].clone(),
        Tick {
            time_millis: 2,
            bid: Decimal::new(94, 1),
            ask: Decimal::new(95, 1),
            flags: TICK_FLAG_BID,
        },
    ];
    let wider_ticks = VolumeProfileConfig {
        tick_size: Decimal::from(2),
        ..fractional
    };
    let profile = calculate_volume_profile(&wide_range_ticks, 0, 10, &wider_ticks).unwrap();
    assert_eq!(profile.bins.len(), 3);
}

#[test]
fn poc_tie_chooses_lower_and_value_area_expands_lower_on_tie() {
    let ticks = vec![tick(1, 1, 9, TICK_FLAG_BID), tick(2, 2, 9, TICK_FLAG_BID)];
    let profile = calculate_volume_profile(&ticks, 0, 10, &config(128)).unwrap();
    assert_eq!(profile.poc.as_deref(), Some("1.5"));
    assert_eq!(profile.val.as_deref(), Some("1"));
    assert_eq!(profile.vah.as_deref(), Some("3"));

    let mut weighted = Vec::new();
    for (price, count) in [(1, 1), (2, 3), (3, 3), (4, 1)] {
        for n in 0..count {
            weighted.push(tick(n + price * 10, price, price + 1, TICK_FLAG_BID));
        }
    }
    let expanded = calculate_volume_profile(&weighted, 0, 100, &config(128)).unwrap();
    assert_eq!(expanded.poc.as_deref(), Some("2.5"));
    assert_eq!(expanded.val.as_deref(), Some("2"));
    assert_eq!(expanded.vah.as_deref(), Some("4"));
}

#[test]
fn counts_ask_once_and_combined_once_for_bid_ask_tick() {
    let ticks = vec![
        tick(1, 10, 11, TICK_FLAG_ASK),
        tick(2, 10, 11, TICK_FLAG_BID | TICK_FLAG_ASK),
    ];
    let profile = calculate_volume_profile(&ticks, 0, 10, &config(128)).unwrap();
    assert_eq!(profile.total_weight, 2);
    assert_eq!(profile.bins.iter().map(|bin| bin.bid).sum::<u64>(), 1);
    assert_eq!(profile.bins.iter().map(|bin| bin.ask).sum::<u64>(), 2);
    assert_eq!(profile.bins.iter().map(|bin| bin.combined).sum::<u64>(), 2);
}

#[test]
fn planner_handles_full_and_partial_cache_without_overlapping_ranges() {
    let request = TickRange {
        start_ms: 0,
        end_ms: 10,
    };
    assert!(plan_tick_ranges(request, &[request]).is_empty());
    assert_eq!(
        plan_tick_ranges(
            request,
            &[TickRange {
                start_ms: 2,
                end_ms: 5
            }]
        ),
        vec![
            TickRange {
                start_ms: 0,
                end_ms: 2
            },
            TickRange {
                start_ms: 5,
                end_ms: 10
            }
        ]
    );
    assert_eq!(plan_tick_ranges(request, &[]), vec![request]);
    assert_eq!(
        plan_tick_ranges(
            TickRange {
                start_ms: 4,
                end_ms: 5
            },
            &[]
        ),
        vec![TickRange {
            start_ms: 4,
            end_ms: 5
        }]
    );
}

#[test]
fn planner_matches_coverage_for_unsorted_overlapping_and_clipped_cache() {
    let request = TickRange {
        start_ms: 10,
        end_ms: 110,
    };
    let mut seed = 17u64;
    for count in 0..=256 {
        let cached = (0..count)
            .map(|_| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                let start = ((seed >> 32) % 140) as i64;
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                TickRange {
                    start_ms: start,
                    end_ms: start + ((seed >> 32) % 20) as i64 - 3,
                }
            })
            .collect::<Vec<_>>();
        let gaps = plan_tick_ranges(request, &cached);
        assert!(gaps.iter().all(|gap| gap.is_valid()
            && gap.start_ms >= request.start_ms
            && gap.end_ms <= request.end_ms));
        assert!(gaps
            .windows(2)
            .all(|pair| pair[0].end_ms < pair[1].start_ms));
        for time in request.start_ms..request.end_ms {
            let covered = cached
                .iter()
                .any(|range| range.is_valid() && range.start_ms <= time && time < range.end_ms);
            let missing = gaps
                .iter()
                .any(|range| range.start_ms <= time && time < range.end_ms);
            assert_ne!(covered, missing);
        }
        let mut reversed = cached;
        reversed.reverse();
        assert_eq!(gaps, plan_tick_ranges(request, &reversed));
    }
}

fn fixed_config(rows: usize) -> FixedRangeProfileConfig {
    FixedRangeProfileConfig {
        rows,
        tick_size: Decimal::ONE,
        value_area_percent: Decimal::new(70, 2),
    }
}

/// One bid-flagged tick of weight per entry: bin `base + k` receives
/// `weights[k]`. Ask quotes stay positive but carry no ask flag.
fn weighted(base: i64, weights: &[u64]) -> Vec<Tick> {
    let mut ticks = Vec::new();
    let mut time = 0i64;
    for (offset, &weight) in weights.iter().enumerate() {
        for _ in 0..weight {
            time += 1;
            ticks.push(tick(
                time,
                base + offset as i64,
                base + offset as i64 + 1,
                TICK_FLAG_BID,
            ));
        }
    }
    ticks
}

#[test]
fn total_profile_counts_one_weight_per_flagged_tick_at_bid_price() {
    let ticks = vec![
        // Both sides change: exactly 1 total weight, at the BID price.
        tick(1, 10, 11, TICK_FLAG_BID | TICK_FLAG_ASK),
        tick(2, 20, 21, TICK_FLAG_BID),
        tick(3, 30, 31, TICK_FLAG_ASK),
    ];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.total_weight, 3);
    assert_eq!(profile.rejected_ticks, 0);
    assert_eq!(profile.actual_rows, 22);
    assert_eq!(profile.bins.len(), 22);
    let totals = profile.bins.iter().map(|bin| bin.total).collect::<Vec<_>>();
    assert_eq!(totals.iter().sum::<u64>(), 3);
    assert_eq!(totals[0], 1, "both-sides tick counts once at bid 10");
    assert_eq!(totals[10], 1, "bid-only tick counts once at bid 20");
    assert_eq!(totals[20], 1, "ask-only tick counts at its bid 30");
    assert_eq!(totals[1], 0, "ask price 11 carries no total weight");
    assert_eq!(totals[21], 0, "ask price 31 carries no total weight");
}

#[test]
fn ticks_without_change_flags_contribute_nothing() {
    let ticks = vec![
        tick(1, 100, 101, 0),
        tick(2, 100, 101, 0),
        tick(3, 105, 106, TICK_FLAG_BID),
        tick(4, 100, 101, 0),
    ];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.total_weight, 1, "only the flagged tick counts");
    assert_eq!(
        profile.rejected_ticks, 0,
        "valid unflagged quotes are not rejected"
    );
    assert_eq!(profile.actual_rows, 1);
    assert_eq!(profile.bins[0].low, "105");
    assert_eq!(profile.bins[0].total, 1);
    assert_eq!(profile.bins[0].bid, 1);
    assert_eq!(profile.bins[0].ask, 0);
}

#[test]
fn bid_and_ask_profiles_follow_their_own_flags() {
    let ticks = vec![
        tick(1, 100, 101, TICK_FLAG_ASK),
        tick(2, 102, 103, TICK_FLAG_BID | TICK_FLAG_ASK),
        tick(3, 102, 103, TICK_FLAG_BID),
    ];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    let sum = |pick: fn(&FixedRangeBin) -> u64| profile.bins.iter().map(pick).sum::<u64>();
    assert_eq!(sum(|bin| bin.total), 3);
    assert_eq!(sum(|bin| bin.bid), 2, "only the two TICK_FLAG_BID ticks");
    assert_eq!(sum(|bin| bin.ask), 2, "only the two TICK_FLAG_ASK ticks");
    assert!(
        sum(|bin| bin.bid) + sum(|bin| bin.ask) > sum(|bin| bin.total),
        "bid+ask may exceed total: both-sides tick adds 2 vs total 1"
    );
    assert_eq!(profile.bins[0].total, 1);
    assert_eq!(
        profile.bins[0].bid + profile.bins[0].ask,
        0,
        "ask-only tick puts total weight at its bid price where bid+ask fall short"
    );
    assert_eq!(profile.bins[1].total, 0);
    assert_eq!(
        profile.bins[1].ask, 1,
        "ask weight at the ask price can exceed the total weight of its bin"
    );
    assert_eq!(profile.poc.as_deref(), Some("102.5"));
    assert_eq!(profile.bid_poc.as_deref(), Some("102.5"));
    assert_eq!(profile.bid_val.as_deref(), Some("102"));
    assert_eq!(profile.bid_vah.as_deref(), Some("103"));
    assert_eq!(profile.ask_poc.as_deref(), Some("101.5"));
    assert_eq!(profile.ask_val.as_deref(), Some("100"));
    assert_eq!(profile.ask_vah.as_deref(), Some("104"));

    let bid_only = vec![tick(1, 100, 101, TICK_FLAG_BID)];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &bid_only);
    assert_eq!(profile.bid_poc.as_deref(), Some("100.5"));
    assert_eq!(profile.bid_val.as_deref(), Some("100"));
    assert_eq!(profile.bid_vah.as_deref(), Some("101"));
    assert_eq!(profile.ask_poc, None, "empty mode has no levels");
    assert_eq!(profile.ask_vah, None);
    assert_eq!(profile.ask_val, None);
}

#[test]
fn invalid_quotes_are_rejected_and_counted() {
    let ticks = vec![
        tick(1, 0, 2, TICK_FLAG_BID),
        tick(2, -1, 2, TICK_FLAG_ASK),
        // Rejected even without change flags: validity is checked first.
        tick(3, 0, 0, 0),
        tick(4, 10, 11, TICK_FLAG_BID),
    ];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.rejected_ticks, 3);
    assert_eq!(profile.total_weight, 1);
    assert_eq!(profile.actual_rows, 1);
    assert_eq!(profile.bins[0].total, 1);
    // rust_decimal cannot hold NaN/Infinity (Decimal::from_f64(f64::NAN)
    // is None), so non-finite quotes cannot reach this function; the
    // <= 0 guard rejects every representable invalid quote.
}

#[test]
fn bins_align_to_tick_grid_and_respect_row_target() {
    let config = FixedRangeProfileConfig {
        rows: 8,
        tick_size: Decimal::new(25, 2), // 0.25
        value_area_percent: Decimal::new(70, 2),
    };
    let ticks = vec![
        Tick {
            time_millis: 1,
            bid: Decimal::from(100),
            ask: Decimal::from(101),
            flags: TICK_FLAG_BID,
        },
        Tick {
            time_millis: 2,
            bid: Decimal::new(11575, 2), // 115.75
            ask: Decimal::new(11600, 2), // 116.00
            flags: TICK_FLAG_BID,
        },
    ];
    let profile = calculate_fixed_range_profile(&config, &ticks);
    assert_eq!(profile.total_weight, 2);
    assert_eq!(
        profile.actual_rows, 8,
        "64 tick cells over target 8 -> 8 bins"
    );
    assert_eq!(profile.bins.len(), profile.actual_rows);
    assert!(profile.actual_rows <= config.rows);
    for bin in &profile.bins {
        let low: Decimal = bin.low.parse().unwrap();
        let high: Decimal = bin.high.parse().unwrap();
        let width = high - low;
        assert_eq!(
            (width / config.tick_size).fract(),
            Decimal::ZERO,
            "width {width} must be a whole multiple of tick size"
        );
        assert_eq!(
            (low / config.tick_size).fract(),
            Decimal::ZERO,
            "edge {low} must sit on the tick grid"
        );
    }
    assert_eq!(profile.bins[0].low, "100");
    assert_eq!(profile.bins[0].high, "102");
    assert_eq!(profile.bins[7].high, "116");
    assert_eq!(profile.bins[0].total, 1);
    assert_eq!(profile.bins[7].total, 1);
}

#[test]
fn narrow_range_produces_fewer_rows_than_target() {
    let mut config = fixed_config(128);
    config.tick_size = Decimal::new(5, 1); // 0.5
    let ticks = vec![
        Tick {
            time_millis: 1,
            bid: Decimal::from(100),
            ask: Decimal::from(101),
            flags: TICK_FLAG_BID,
        },
        Tick {
            time_millis: 2,
            bid: Decimal::new(1015, 1), // 101.5
            ask: Decimal::from(102),
            flags: TICK_FLAG_BID,
        },
    ];
    let profile = calculate_fixed_range_profile(&config, &ticks);
    assert_eq!(profile.actual_rows, 4, "3 tick cells + grid alignment");
    assert!(
        profile.actual_rows < config.rows,
        "narrow range shrinks below target"
    );
    assert_eq!(profile.bins[0].low, "100");
    assert_eq!(profile.bins[0].high, "100.5");
    assert_eq!(profile.bins[3].high, "102");
    for bin in &profile.bins {
        let low: Decimal = bin.low.parse().unwrap();
        let high: Decimal = bin.high.parse().unwrap();
        assert_eq!(high - low, config.tick_size, "width falls back to one tick");
    }
    assert_eq!(profile.bins[0].total, 1);
    assert_eq!(profile.bins[3].total, 1);
}

#[test]
fn poc_tie_breaks_to_lower_bin_and_sits_at_bin_center() {
    let ticks = vec![
        tick(1, 10, 11, TICK_FLAG_BID),
        tick(2, 11, 12, TICK_FLAG_BID),
    ];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.bins[0].total, 1);
    assert_eq!(profile.bins[1].total, 1);
    assert_eq!(
        profile.poc.as_deref(),
        Some("10.5"),
        "tie goes to the lower bin, reported at its center"
    );

    // Center of a wide bin: rows=1 forces a single 4-tick bin [10, 14).
    let wide = vec![
        tick(1, 10, 11, TICK_FLAG_BID),
        tick(2, 13, 14, TICK_FLAG_BID),
    ];
    let profile = calculate_fixed_range_profile(&fixed_config(1), &wide);
    assert_eq!(profile.actual_rows, 1);
    assert_eq!(profile.bins[0].center, "12");
    assert_eq!(profile.poc.as_deref(), Some("12"));
}

#[test]
fn value_area_expands_to_larger_weight_neighbor() {
    // Weights [1,5,2,8,1]: POC bin 3 (8); neighbors 2 vs 1 then 5 vs 1.
    let ticks = weighted(100, &[1, 5, 2, 8, 1]);
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.total_weight, 17);
    assert_eq!(profile.poc.as_deref(), Some("103.5"));
    assert_eq!(
        profile.val.as_deref(),
        Some("101"),
        "expansion must take the larger left bins, not the right edge"
    );
    assert_eq!(profile.vah.as_deref(), Some("104"));
}

#[test]
fn value_area_tie_expands_to_lower_side() {
    // Weights [5,3,6,3,1]: POC bin 2; immediate neighbors tie (3 vs 3),
    // so the left side must be taken first. total 18, target 12.6:
    // 6 -> +3 (tie, lower) -> +5 = 14 >= 12.6 stops at bins [0..2].
    let ticks = weighted(100, &[5, 3, 6, 3, 1]);
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.poc.as_deref(), Some("102.5"));
    assert_eq!(profile.val.as_deref(), Some("100"));
    assert_eq!(
        profile.vah.as_deref(),
        Some("103"),
        "taking the right side first would reach bin 3 and report 104"
    );
}

#[test]
fn value_area_expands_available_side_at_range_edge() {
    // Lower edge: POC bin 0 has no left neighbor; expansion must take
    // the (smaller) right side. total 5, target 3.5: 3 -> +1 = 4.
    let profile = calculate_fixed_range_profile(&fixed_config(128), &weighted(100, &[3, 1, 1]));
    assert_eq!(profile.poc.as_deref(), Some("100.5"));
    assert_eq!(profile.val.as_deref(), Some("100"));
    assert_eq!(profile.vah.as_deref(), Some("102"));

    // Upper edge: POC bin 2 has no right neighbor; expand left.
    let profile = calculate_fixed_range_profile(&fixed_config(128), &weighted(100, &[1, 1, 3]));
    assert_eq!(profile.poc.as_deref(), Some("102.5"));
    assert_eq!(profile.val.as_deref(), Some("101"));
    assert_eq!(profile.vah.as_deref(), Some("103"));
}

#[test]
fn value_area_stops_at_seventy_percent_threshold() {
    // Weights [2,4,3,1]: total 10, target exactly 7.0. POC bin 1 (4),
    // larger right neighbor 3 brings the area to exactly 7, and the
    // loop must stop even though bins 0 and 3 still have weight.
    let ticks = weighted(100, &[2, 4, 3, 1]);
    let profile = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(profile.poc.as_deref(), Some("101.5"));
    assert_eq!(profile.val.as_deref(), Some("101"));
    assert_eq!(
        profile.vah.as_deref(),
        Some("103"),
        "a strict > comparison would keep expanding to bin 0"
    );
}

#[test]
fn empty_range_yields_no_levels() {
    let profile = calculate_fixed_range_profile(&fixed_config(128), &[]);
    assert!(profile.bins.is_empty());
    assert_eq!(profile.actual_rows, 0);
    assert_eq!(profile.total_weight, 0);
    assert_eq!(profile.rejected_ticks, 0);
    assert_eq!(profile.poc, None);
    assert_eq!(profile.vah, None);
    assert_eq!(profile.val, None);
    assert_eq!(profile.bid_poc, None);
    assert_eq!(profile.bid_vah, None);
    assert_eq!(profile.bid_val, None);
    assert_eq!(profile.ask_poc, None);
    assert_eq!(profile.ask_vah, None);
    assert_eq!(profile.ask_val, None);

    let rejected_only = vec![tick(1, 0, 1, TICK_FLAG_BID)];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &rejected_only);
    assert!(profile.bins.is_empty());
    assert_eq!(profile.rejected_ticks, 1);
    assert_eq!(profile.poc, None);

    let unflagged_only = vec![tick(1, 5, 6, 0)];
    let profile = calculate_fixed_range_profile(&fixed_config(128), &unflagged_only);
    assert!(profile.bins.is_empty());
    assert_eq!(profile.total_weight, 0);
    assert_eq!(profile.rejected_ticks, 0);
    assert_eq!(profile.vah, None);
    assert_eq!(profile.val, None);
}

#[test]
fn identical_input_produces_identical_profile() {
    let ticks = {
        let mut ticks = weighted(100, &[3, 1, 4, 1, 5]);
        ticks.push(tick(99, 0, 2, TICK_FLAG_BID));
        ticks.push(tick(100, 100, 101, 0));
        ticks
    };
    let first = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    let second = calculate_fixed_range_profile(&fixed_config(128), &ticks);
    assert_eq!(first, second);
}

#[test]
fn invalid_configuration_yields_empty_profile() {
    let ticks = vec![tick(1, 100, 101, TICK_FLAG_BID)];
    let mut config = fixed_config(128);
    config.tick_size = Decimal::ZERO;
    let profile = calculate_fixed_range_profile(&config, &ticks);
    assert!(profile.bins.is_empty());
    assert_eq!(profile.actual_rows, 0);
    assert_eq!(profile.rejected_ticks, 0);
    assert_eq!(profile.poc, None);

    let config = fixed_config(0);
    let profile = calculate_fixed_range_profile(&config, &ticks);
    assert!(profile.bins.is_empty());
    assert_eq!(profile.total_weight, 0);
    assert_eq!(profile.poc, None);
}
#[test]
fn streamed_profile_equals_batch_with_late_price_extremes_and_flag_changes() {
    let ticks = (0..300_100)
        .map(|i| {
            let price = if i < 250_000 {
                100 + i % 10
            } else {
                400 + i % 20
            };
            tick(i, price, price + 2, [2, 4, 6, 0][i as usize % 4])
        })
        .chain([tick(400_000, 0, 1, 6)])
        .collect::<Vec<_>>();
    let mut stream = FixedRangeProfileAccumulator::new(100);
    for tick in &ticks {
        stream.push(tick).unwrap();
    }
    assert!(stream.price_count() < 100);
    assert_eq!(
        stream.calculate(&fixed_config(128)),
        calculate_fixed_range_profile(&fixed_config(128), &ticks)
    );
    assert_eq!(
        stream.calculate(&fixed_config(128)),
        stream.calculate(&fixed_config(128))
    );
}

#[test]
fn streaming_price_capacity_failure_does_not_mutate_existing_counts() {
    let mut stream = FixedRangeProfileAccumulator::new(2);
    stream.push(&tick(0, 100, 101, 6)).unwrap();
    let before = stream.calculate(&fixed_config(128));
    assert!(stream.push(&tick(1, 101, 102, 6)).is_err());
    assert_eq!(before, stream.calculate(&fixed_config(128)));
}
