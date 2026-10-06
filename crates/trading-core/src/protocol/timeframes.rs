//! The chart timeframes the bridge supports.
//!
//! The contract is shared configuration: `config/timeframes.json` at the
//! repository root holds the wire codes, their bar lengths in seconds and the
//! default timeframe. This module embeds that file at compile time (so a
//! packaged build carries it) and exposes the lookups the protocol validates
//! with; the frontend imports the same file. `docs/protocol/bridge-v1.md`,
//! `scripts/mock_mt5_bridge.py` and the MQL5 EA follow the same codes.

use serde::Deserialize;
use std::sync::OnceLock;

const CONFIG: &str = include_str!("../../../../config/timeframes.json");

#[derive(Debug, Deserialize)]
struct TimeframeConfig {
    default: String,
    timeframes: Vec<TimeframeEntry>,
}

#[derive(Debug, Deserialize)]
struct TimeframeEntry {
    code: String,
    seconds: u32,
}

/// The parsed shared config. A malformed file is a build-visible defect: the
/// tests below parse it, and every accessor panics rather than guessing.
fn config() -> &'static TimeframeConfig {
    static CONFIG_ONCE: OnceLock<TimeframeConfig> = OnceLock::new();
    CONFIG_ONCE.get_or_init(|| {
        serde_json::from_str(CONFIG).expect("config/timeframes.json must be valid timeframes")
    })
}

/// Validate a peer's advertised subset and return it in standard duration order.
pub fn supported_timeframes(codes: &[String]) -> Result<Vec<String>, &'static str> {
    if codes.is_empty()
        || codes.len() > config().timeframes.len()
        || !codes.iter().any(|code| code == default_timeframe())
        || codes
            .iter()
            .enumerate()
            .any(|(i, code)| !is_supported_timeframe(code) || codes[..i].contains(code))
    {
        return Err("invalid supported timeframes");
    }
    Ok(config()
        .timeframes
        .iter()
        .filter(|entry| codes.contains(&entry.code))
        .map(|entry| entry.code.clone())
        .collect())
}

/// Whether a wire timeframe code may be sent to the EA.
pub fn is_supported_timeframe(value: &str) -> bool {
    timeframe_seconds(value).is_some()
}

/// Bar length in seconds for a wire timeframe code.
pub fn timeframe_seconds(value: &str) -> Option<u32> {
    config()
        .timeframes
        .iter()
        .find(|entry| entry.code == value)
        .map(|entry| entry.seconds)
}

/// Timeframe requested during the handshake and used when a caller has no
/// preference of its own.
pub fn default_timeframe() -> &'static str {
    &config().default
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_is_ordered_by_duration_and_codes_are_unique() {
        let entries = &config().timeframes;
        assert!(!entries.is_empty());
        for pair in entries.windows(2) {
            assert!(
                pair[0].seconds < pair[1].seconds,
                "{} must be shorter than {}",
                pair[0].code,
                pair[1].code
            );
        }
        let mut codes: Vec<&str> = entries.iter().map(|entry| entry.code.as_str()).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), entries.len(), "codes must be unique");
    }

    #[test]
    fn codes_are_uppercase_with_positive_durations() {
        for entry in &config().timeframes {
            assert_eq!(entry.code, entry.code.to_ascii_uppercase());
            assert!(entry.seconds > 0, "{} must have a length", entry.code);
        }
    }

    #[test]
    fn the_default_is_supported_and_first() {
        let default = default_timeframe();
        assert_eq!(Some(60), timeframe_seconds(default));
        assert_eq!(config().timeframes[0].code, default);
    }

    #[test]
    fn capabilities_validate_advertised_subsets() {
        let codes = |values: &[&str]| values.iter().map(|v| v.to_string()).collect::<Vec<_>>();
        assert_eq!(
            supported_timeframes(&codes(&["MN1", "M2", "M1"])).unwrap(),
            ["M1", "M2", "MN1"]
        );
        for invalid in [
            vec![],
            codes(&["M2"]),
            codes(&["M1", "M1"]),
            codes(&["M1", "M7"]),
            codes(&["m1"]),
        ] {
            assert!(supported_timeframes(&invalid).is_err());
        }
    }

    #[test]
    fn all_standard_mt5_periods_are_supported() {
        for (code, seconds) in [
            ("M1", 60),
            ("M2", 120),
            ("M3", 180),
            ("M4", 240),
            ("M5", 300),
            ("M6", 360),
            ("M10", 600),
            ("M12", 720),
            ("M15", 900),
            ("M20", 1200),
            ("M30", 1800),
            ("H1", 3600),
            ("H2", 7200),
            ("H3", 10800),
            ("H4", 14400),
            ("H6", 21600),
            ("H8", 28800),
            ("H12", 43200),
            ("D1", 86400),
            ("W1", 604800),
            ("MN1", 2592000),
        ] {
            assert_eq!(timeframe_seconds(code), Some(seconds), "{code}");
        }
        assert_eq!(config().timeframes.len(), 21);
    }

    #[test]
    fn lookups_reject_unknown_values_and_keep_their_duration() {
        assert!(!is_supported_timeframe("m1"));
        assert!(!is_supported_timeframe("M7"));
        assert!(is_supported_timeframe("D1"));
        assert_eq!(timeframe_seconds("D1"), Some(86_400));
        assert_eq!(timeframe_seconds("M7"), None);
    }
}
