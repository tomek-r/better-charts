use rust_decimal::Decimal;

mod bar_profile;
mod bar_series;
mod fixed_range;
mod legacy;
mod range_planning;
pub use bar_profile::{
    bar_close_ms, bar_timeframe_for_range, bar_timeframes_coarser_than, bars_overlapping_range,
    calculate_bar_profile, estimate_profile_load, partial_coverage_start, ProfileBudget,
    ProfileLoadEstimate,
};
pub use bar_series::{BarCoverage, BarSeries, BarSeriesError};
pub use fixed_range::{
    calculate_fixed_range_profile, value_area_fraction, FixedRangeBin, FixedRangeProfile,
    FixedRangeProfileAccumulator, FixedRangeProfileConfig, ProfileSettingError, RowLayout,
    DEFAULT_PROFILE_ROWS, DEFAULT_VALUE_AREA_PERCENT, MAX_PROFILE_BINS, MAX_REQUEST_ROWS,
    MAX_TICKS_PER_ROW,
};
pub use legacy::{
    calculate_volume_profile, ProfileBin, VolumeProfile, VolumeProfileConfig, VolumeProfileError,
};
pub use range_planning::{plan_tick_ranges, TickRange};

pub const TICK_FLAG_BID: u32 = 2;
pub const TICK_FLAG_ASK: u32 = 4;

#[derive(Debug, Clone, PartialEq)]
pub struct Tick {
    pub time_millis: i64,
    pub bid: Decimal,
    pub ask: Decimal,
    pub flags: u32,
}

fn price_string(value: Decimal) -> String {
    value.normalize().to_string()
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
