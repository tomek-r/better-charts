use super::super::{
    BridgeState, CompactTickProfile, TickHistoryRequest, TickHistorySnapshot, TickProfileBin,
    TickProfileLevels, TickProfileRequest, TickProfileResult,
};
use trading_core::volume_profile::{
    calculate_fixed_range_profile, FixedRangeProfile, FixedRangeProfileConfig, Tick as ProfileTick,
};

/// Resolves the profile grid step for `symbol`: the broker tick size from
/// the local symbol cache (upserted from accepted symbol info and search
/// results) when the symbol is known, otherwise the tick-derived heuristic
/// in [`fallback_tick_size`].
pub(crate) fn resolve_tick_size(
    state: &BridgeState,
    symbol: &str,
    ticks: &[ProfileTick],
) -> rust_decimal::Decimal {
    cached_tick_size(state, symbol).unwrap_or_else(|| fallback_tick_size(ticks))
}

fn cached_tick_size(state: &BridgeState, symbol: &str) -> Option<rust_decimal::Decimal> {
    let guard = state
        .symbol_cache
        .lock()
        .expect("symbol cache mutex poisoned");
    guard
        .cache
        .get(symbol)
        .and_then(|entry| entry.tick_size.parse::<rust_decimal::Decimal>().ok())
        .filter(|tick_size| *tick_size > rust_decimal::Decimal::ZERO)
}

/// Heuristic grid when symbol metadata is unavailable: the smallest positive
/// difference between adjacent distinct bid prices in the input. With fewer
/// than two distinct bids (or a degenerate gap) it uses the whole input's
/// min/max price span across both quote sides; when even that is
/// non-positive (all quotes equal, absent, or invalid) it falls back to `1`
/// so the grid stays positive and rejected-tick accounting still flows
/// through the profile.
pub(crate) fn fallback_tick_size(ticks: &[ProfileTick]) -> rust_decimal::Decimal {
    // Deduplicate before sorting: repeated quotes should not increase sort work.
    let mut bids = ticks
        .iter()
        .map(|tick| tick.bid)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    bids.sort_unstable();
    if let Some(gap) = bids
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .filter(|gap| *gap > rust_decimal::Decimal::ZERO)
        .min()
    {
        return gap;
    }
    let min = ticks.iter().flat_map(|tick| [tick.bid, tick.ask]).min();
    let max = ticks.iter().flat_map(|tick| [tick.bid, tick.ask]).max();
    let span = match (min, max) {
        (Some(min), Some(max)) => max - min,
        _ => rust_decimal::Decimal::ZERO,
    };
    if span > rust_decimal::Decimal::ZERO {
        span
    } else {
        rust_decimal::Decimal::ONE
    }
}

/// Bundles one histogram's levels; `None` when the mode carries no weight,
/// so the event sends that side as `null`.
pub(crate) fn profile_levels(
    poc: Option<String>,
    vah: Option<String>,
    val: Option<String>,
) -> Option<TickProfileLevels> {
    match (poc, vah, val) {
        (Some(poc), Some(vah), Some(val)) => Some(TickProfileLevels { poc, vah, val }),
        _ => None,
    }
}

pub(crate) fn build_tick_profile(
    state: &BridgeState,
    snapshot: TickHistorySnapshot,
    request: &TickProfileRequest,
) -> Result<TickProfileResult, &'static str> {
    validate_tick_profile_snapshot(&snapshot, &request.wire)?;
    let ticks = snapshot
        .ticks
        .iter()
        .map(|tick| {
            Ok(ProfileTick {
                time_millis: tick.time_ms,
                bid: tick.bid.parse().map_err(|_| "invalid tick bid")?,
                ask: tick.ask.parse().map_err(|_| "invalid tick ask")?,
                flags: tick.flags,
            })
        })
        .collect::<Result<Vec<_>, &'static str>>()?;
    let config = FixedRangeProfileConfig {
        rows: usize::from(request.rows),
        tick_size: resolve_tick_size(state, &snapshot.symbol, &ticks),
        value_area_percent: "0.7".parse().expect("valid value area"),
    };
    let calculated = calculate_fixed_range_profile(&config, &ticks);
    Ok(profile_result(
        snapshot.symbol,
        snapshot.from_ms,
        snapshot.to_ms,
        snapshot.complete,
        calculated,
    ))
}

pub(crate) fn build_streamed_tick_profile(
    state: &BridgeState,
    compact: CompactTickProfile,
    request: &TickProfileRequest,
) -> Result<TickProfileResult, &'static str> {
    let wire_size = compact
        .tick_size
        .parse::<rust_decimal::Decimal>()
        .map_err(|_| "invalid tick size")?;
    if wire_size <= rust_decimal::Decimal::ZERO {
        return Err("invalid tick size");
    }
    let config = FixedRangeProfileConfig {
        rows: usize::from(request.rows),
        tick_size: cached_tick_size(state, &request.wire.symbol)
            .unwrap_or_else(|| compact.counts.inferred_tick_size()),
        value_area_percent: "0.7".parse().expect("valid value area"),
    };
    let calculated = compact.counts.calculate(&config);
    Ok(profile_result(
        request.wire.symbol.clone(),
        request.wire.from_ms,
        request.wire.to_ms,
        compact.complete,
        calculated,
    ))
}

fn profile_result(
    symbol: String,
    from_ms: i64,
    end_ms: i64,
    complete: bool,
    calculated: FixedRangeProfile,
) -> TickProfileResult {
    TickProfileResult {
        symbol,
        from_ms,
        end_ms,
        complete,
        rejected_ticks: calculated.rejected_ticks,
        actual_rows: calculated.actual_rows,
        total_weight: calculated.total_weight,
        poc: calculated.poc,
        vah: calculated.vah,
        val: calculated.val,
        bid_levels: profile_levels(calculated.bid_poc, calculated.bid_vah, calculated.bid_val),
        ask_levels: profile_levels(calculated.ask_poc, calculated.ask_vah, calculated.ask_val),
        bins: calculated
            .bins
            .into_iter()
            .map(|bin| TickProfileBin {
                low: bin.low,
                high: bin.high,
                total: bin.total,
                bid: bin.bid,
                ask: bin.ask,
            })
            .collect(),
    }
}

pub(crate) fn validate_tick_profile_snapshot(
    snapshot: &TickHistorySnapshot,
    request: &TickHistoryRequest,
) -> Result<(), &'static str> {
    request.validate()?;
    if snapshot.request_id.is_empty()
        || snapshot.symbol != request.symbol
        || snapshot.from_ms != request.from_ms
        || snapshot.to_ms != request.to_ms
    {
        return Err("tick history request mismatch");
    }
    if snapshot
        .tick_size
        .parse::<rust_decimal::Decimal>()
        .map_err(|_| "invalid tick size")?
        <= rust_decimal::Decimal::ZERO
    {
        return Err("invalid tick size");
    }
    if snapshot
        .ticks
        .windows(2)
        .any(|pair| pair[0].time_ms > pair[1].time_ms)
    {
        return Err("ticks are not ordered");
    }
    for tick in &snapshot.ticks {
        if tick.time_ms < request.from_ms || tick.time_ms >= request.to_ms {
            return Err("tick is outside requested range");
        }
        tick.validate()?;
    }
    Ok(())
}
