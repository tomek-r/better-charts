//! MQL5 component versions required by this desktop build.
//!
//! The values live once in `config/mq5-versions.json`, which this module
//! embeds at compile time. Each MQL5 source must advertise exactly the
//! version listed here; the guard tests below read the sources.

use serde::Deserialize;
use std::sync::OnceLock;

const CONFIG: &str = include_str!("../../../../config/mq5-versions.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mq5Versions {
    expert_adviser_version: String,
    tick_reader_version: String,
}

/// A malformed file is a build-visible defect: the tests parse it, and every
/// accessor panics rather than guessing.
fn config() -> &'static Mq5Versions {
    static CONFIG_ONCE: OnceLock<Mq5Versions> = OnceLock::new();
    CONFIG_ONCE.get_or_init(|| {
        serde_json::from_str(CONFIG).expect("config/mq5-versions.json must be valid")
    })
}

/// Exact EA version required by this desktop build.
pub fn expert_adviser_version() -> &'static str {
    &config().expert_adviser_version
}

/// Exact tick-history reader indicator version required by this desktop build.
pub fn tick_reader_version() -> &'static str {
    &config().tick_reader_version
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_mt5_version(value: &str) -> bool {
        let parts: Vec<&str> = value.split('.').collect();
        value.len() <= 32
            && parts.len() == 2
            && parts
                .iter()
                .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    }

    #[test]
    fn versions_config_parses_with_mt5_formatted_versions() {
        assert!(is_mt5_version(expert_adviser_version()));
        assert!(is_mt5_version(tick_reader_version()));
    }

    #[test]
    fn ea_advertises_the_version_required_by_the_app() {
        let ea = include_str!("../../../../mql5/bridge/Experts/BetterChartsBridge.mq5");
        assert!(ea.contains(&format!(
            "#define BRIDGE_EXPERT_VERSION \"{}\"",
            expert_adviser_version()
        )));
        assert!(ea.contains("#property version BRIDGE_EXPERT_VERSION"));
    }

    #[test]
    fn tick_reader_advertises_the_version_required_by_the_app() {
        let reader =
            include_str!("../../../../mql5/bridge/Indicators/BetterChartsTickHistoryReader.mq5");
        assert!(reader.contains(&format!(
            "#define BRIDGE_TICK_READER_VERSION \"{}\"",
            tick_reader_version()
        )));
        assert!(reader.contains("#property version BRIDGE_TICK_READER_VERSION"));
    }
}
