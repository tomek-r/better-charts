use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::{price_string, Tick, TICK_FLAG_ASK, TICK_FLAG_BID};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VolumeProfileConfig {
    pub rows: usize,
    pub tick_size: Decimal,
    pub value_area_percent: Decimal,
}

impl Default for VolumeProfileConfig {
    fn default() -> Self {
        Self {
            rows: 128,
            tick_size: Decimal::ONE,
            value_area_percent: Decimal::new(70, 2),
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum VolumeProfileError {
    #[error("tick size must be positive")]
    InvalidTickSize,
    #[error("rows must be between 1 and 128")]
    InvalidRows,
    #[error("value area percent must be between 0 and 1")]
    InvalidValueArea,
    #[error("range end must not precede range start")]
    InvalidRange,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileBin {
    pub low: String,
    pub high: String,
    pub center: String,
    pub combined: u64,
    pub bid: u64,
    pub ask: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VolumeProfile {
    pub bins: Vec<ProfileBin>,
    pub rejected: u64,
    pub total_weight: u64,
    pub poc: Option<String>,
    pub vah: Option<String>,
    pub val: Option<String>,
}

pub fn calculate_volume_profile(
    ticks: &[Tick],
    start_ms: i64,
    end_ms: i64,
    config: &VolumeProfileConfig,
) -> Result<VolumeProfile, VolumeProfileError> {
    if config.tick_size <= Decimal::ZERO {
        return Err(VolumeProfileError::InvalidTickSize);
    }
    if config.rows == 0 || config.rows > 128 {
        return Err(VolumeProfileError::InvalidRows);
    }
    if config.value_area_percent < Decimal::ZERO || config.value_area_percent > Decimal::ONE {
        return Err(VolumeProfileError::InvalidValueArea);
    }
    if end_ms < start_ms {
        return Err(VolumeProfileError::InvalidRange);
    }

    let mut rejected = 0;
    let mut contributions: Vec<(Decimal, bool, bool, bool)> = Vec::new();
    for tick in ticks
        .iter()
        .filter(|tick| tick.time_millis >= start_ms && tick.time_millis < end_ms)
    {
        if tick.bid <= Decimal::ZERO || tick.ask <= Decimal::ZERO {
            rejected += 1;
            continue;
        }
        let bid_changed = tick.flags & TICK_FLAG_BID != 0;
        let ask_changed = tick.flags & TICK_FLAG_ASK != 0;
        if bid_changed || ask_changed {
            contributions.push((tick.bid, true, bid_changed, false));
        }
        if ask_changed {
            contributions.push((tick.ask, false, false, true));
        }
    }
    if contributions.is_empty() {
        return Ok(VolumeProfile {
            bins: Vec::new(),
            rejected,
            total_weight: 0,
            poc: None,
            vah: None,
            val: None,
        });
    }

    let mut min_price = contributions[0].0;
    let mut max_price = min_price;
    for &(price, _, _, _) in &contributions {
        min_price = min_price.min(price);
        max_price = max_price.max(price);
    }
    let min_aligned = (min_price / config.tick_size).floor() * config.tick_size;
    let distance_ticks = (max_price - min_aligned) / config.tick_size;
    let mut span_ticks = distance_ticks.ceil().max(Decimal::ONE);
    if distance_ticks == distance_ticks.floor() {
        span_ticks += Decimal::ONE;
    }
    let target_rows = Decimal::from(config.rows as u64);
    let width_ticks = (span_ticks / target_rows).ceil().max(Decimal::ONE);
    let width = width_ticks * config.tick_size;
    // `span_ticks` and `width_ticks` are both measured in whole tick units;
    // `width` is a price distance and may be fractional when tick_size < 1.
    let bin_count = (span_ticks / width_ticks)
        .ceil()
        .to_usize()
        .unwrap_or(1)
        .max(1);
    let mut bins = (0..bin_count)
        .map(|index| {
            let low = min_aligned + width * Decimal::from(index as u64);
            ProfileBin {
                low: price_string(low),
                high: price_string(low + width),
                center: price_string(low + width / Decimal::from(2u64)),
                combined: 0,
                bid: 0,
                ask: 0,
            }
        })
        .collect::<Vec<_>>();
    let mut combined_weights = vec![0u64; bin_count];
    for (price, combined, bid, ask) in contributions {
        let index = (((price - min_aligned) / width)
            .floor()
            .to_u64()
            .unwrap_or(0) as usize)
            .min(bin_count - 1);
        if combined {
            bins[index].combined += 1;
            combined_weights[index] += 1;
        }
        if bid {
            bins[index].bid += 1;
        }
        if ask {
            bins[index].ask += 1;
        }
    }
    let total_weight: u64 = combined_weights.iter().sum();
    if total_weight == 0 {
        return Ok(VolumeProfile {
            bins,
            rejected,
            total_weight,
            poc: None,
            vah: None,
            val: None,
        });
    }
    let poc_index = (0..bin_count)
        .max_by(|&a, &b| {
            combined_weights[a]
                .cmp(&combined_weights[b])
                .then_with(|| b.cmp(&a))
        })
        .unwrap();
    let target = Decimal::from(total_weight) * config.value_area_percent;
    let mut low = poc_index;
    let mut high = poc_index;
    let mut area = Decimal::from(combined_weights[poc_index]);
    while area < target && (low > 0 || high < bin_count - 1) {
        let left = if low > 0 {
            Some(combined_weights[low - 1])
        } else {
            None
        };
        let right = if high < bin_count - 1 {
            Some(combined_weights[high + 1])
        } else {
            None
        };
        if right.is_none() || (left.is_some() && left >= right) {
            low -= 1;
            area += Decimal::from(combined_weights[low]);
        } else {
            high += 1;
            area += Decimal::from(combined_weights[high]);
        }
    }
    Ok(VolumeProfile {
        poc: Some(bins[poc_index].center.clone()),
        val: Some(bins[low].low.clone()),
        vah: Some(bins[high].high.clone()),
        bins,
        rejected,
        total_weight,
    })
}
