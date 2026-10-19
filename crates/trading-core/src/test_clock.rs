//! Current-time anchor for tests, so fixtures never hardcode a calendar day.
//!
//! The anchor is read once per test process, so every test sees the same
//! value even if the run crosses midnight.

use std::{
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

/// Current UTC time in epoch milliseconds, read once per process.
pub(crate) fn utc_now_ms() -> i64 {
    static NOW: OnceLock<i64> = OnceLock::new();
    *NOW.get_or_init(|| {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is after the Unix epoch");
        i64::try_from(elapsed.as_millis()).expect("epoch milliseconds fit in i64")
    })
}
