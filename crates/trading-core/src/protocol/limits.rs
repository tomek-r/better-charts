//! Transfer limits and history sizing.
//!
//! The values live once in `config/bridge.json` at the repository root, which
//! this module embeds at compile time and the frontend imports (`shared/bridge/limits.ts`).
//! Frame bytes stay inside the EA's signed 32-bit lengths: the maximum leaves
//! room for the frame header, so the largest negotiable value is `i32::MAX - 4`.

use serde::Deserialize;
use std::sync::OnceLock;

const CONFIG: &str = include_str!("../../../../config/bridge.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeConfig {
    frame_bytes: FrameBytes,
    history_bars: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameBytes {
    default: u32,
    min: u32,
    max: u32,
}

/// The parsed shared config. A malformed file is a build-visible defect: the
/// tests below parse it, and every accessor panics rather than guessing.
fn config() -> &'static BridgeConfig {
    static CONFIG_ONCE: OnceLock<BridgeConfig> = OnceLock::new();
    CONFIG_ONCE
        .get_or_init(|| serde_json::from_str(CONFIG).expect("config/bridge.json must be valid"))
}

/// Smallest frame the settings accept, and the lower bound of the handshake.
pub fn min_frame_bytes() -> u32 {
    config().frame_bytes.min
}

/// Largest negotiable frame (`i32::MAX - 4`, leaving room for the header).
pub fn max_frame_bytes() -> u32 {
    config().frame_bytes.max
}

/// Frame size used when neither side asks for another.
pub fn default_frame_bytes() -> u32 {
    config().frame_bytes.default
}

/// Bars per history request; `HistoryRequest::bars` is bounded by it.
pub fn history_bars() -> u16 {
    config().history_bars
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_bounds_are_ordered_and_leave_room_for_the_header() {
        assert!(min_frame_bytes() > 0);
        assert!(min_frame_bytes() <= default_frame_bytes());
        assert!(default_frame_bytes() <= max_frame_bytes());
        // MQL5 arrays and SocketRead use signed 32-bit lengths.
        assert_eq!(max_frame_bytes() + 4, i32::MAX as u32);
    }

    #[test]
    fn history_requests_keep_a_positive_page_size() {
        assert!(history_bars() >= 1);
    }
}
