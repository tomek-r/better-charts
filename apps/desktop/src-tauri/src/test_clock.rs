//! Current-time anchors for tests, so fixtures never hardcode a calendar day.
//!
//! Each anchor is read once per test process, so every test sees the same
//! value even if the run crosses midnight.

use std::sync::OnceLock;

use crate::bridge::transport::now_ms;

const DAY_MS: i64 = 86_400_000;
/// 02:40 after the day start, in milliseconds.
const MORNING_OFFSET_MS: i64 = (2 * 60 + 40) * 60_000;

/// The current UTC time in epoch milliseconds, read once per process.
pub(crate) fn utc_now_ms() -> i64 {
    static NOW: OnceLock<i64> = OnceLock::new();
    *NOW.get_or_init(now_ms)
}

/// 02:40 on the current day of the broker clock (a naive UTC epoch), derived from
/// the current time. Anchored to the day start, so the time of day the suite runs
/// never matters.
pub(crate) fn broker_morning_ms() -> i64 {
    utc_now_ms().div_euclid(DAY_MS) * DAY_MS + MORNING_OFFSET_MS
}
