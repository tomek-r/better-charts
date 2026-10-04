use rust_decimal::Decimal;

mod fixed_range;
mod legacy;
mod range_planning;
pub use fixed_range::{
    calculate_fixed_range_profile, FixedRangeBin, FixedRangeProfile, FixedRangeProfileAccumulator,
    FixedRangeProfileConfig,
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
