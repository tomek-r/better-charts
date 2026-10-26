//! On which timeframes one drawing paints. MT5 has minute and hour timeframes with several
//! counts and exactly one day, week and month timeframe, so those three are plain flags.
//!
//! The wire shape is camelCase JSON, and the store keeps the same JSON text in one column. A
//! drawing saved before this existed reads as shown on every timeframe.

use super::error::ChartDrawingError;
use serde::{Deserialize, Serialize};

/// The longest minute timeframe, in minutes (M30).
const MAX_MINUTES: u32 = 30;
/// The longest hour timeframe, in hours (H12).
const MAX_HOURS: u32 = 12;

/// Minutes or hours of one family: shown between `from` and `to` counts, both included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TimeframeCountRange {
    pub(crate) shown: bool,
    pub(crate) from: u32,
    pub(crate) to: u32,
}

impl TimeframeCountRange {
    /// Shown on every count of a family whose longest timeframe is `longest`.
    const fn everywhere(longest: u32) -> Self {
        Self {
            shown: true,
            from: 1,
            to: longest,
        }
    }

    fn validate(&self, family: &str, longest: u32) -> Result<(), ChartDrawingError> {
        if self.from < 1 || self.to > longest || self.from > self.to {
            return Err(ChartDrawingError::Invalid(format!(
                "A drawing's {family} range needs 1 <= from <= to <= {longest}"
            )));
        }
        Ok(())
    }
}

/// The timeframes a drawing paints on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TimeframeVisibility {
    pub(crate) minutes: TimeframeCountRange,
    pub(crate) hours: TimeframeCountRange,
    pub(crate) days: bool,
    pub(crate) weeks: bool,
    pub(crate) months: bool,
}

impl Default for TimeframeVisibility {
    /// Shown everywhere, with the full ranges.
    fn default() -> Self {
        Self {
            minutes: TimeframeCountRange::everywhere(MAX_MINUTES),
            hours: TimeframeCountRange::everywhere(MAX_HOURS),
            days: true,
            weeks: true,
            months: true,
        }
    }
}

impl TimeframeVisibility {
    /// The ranges a stored drawing may hold; a refused one is never written.
    pub(crate) fn validate(&self) -> Result<(), ChartDrawingError> {
        self.minutes.validate("minutes", MAX_MINUTES)?;
        self.hours.validate("hours", MAX_HOURS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_shown_on_every_timeframe_with_full_ranges() {
        let visibility = TimeframeVisibility::default();

        assert!(visibility.validate().is_ok());
        assert!(visibility.minutes.shown && visibility.hours.shown);
        assert_eq!((visibility.minutes.from, visibility.minutes.to), (1, 30));
        assert_eq!((visibility.hours.from, visibility.hours.to), (1, 12));
        assert!(visibility.days && visibility.weeks && visibility.months);
    }

    #[test]
    fn a_range_must_be_ordered_and_inside_its_family() {
        let range = |from, to| TimeframeCountRange {
            shown: true,
            from,
            to,
        };
        for (from, to) in [(5, 4), (0, 3), (1, 31)] {
            let refused = TimeframeVisibility {
                minutes: range(from, to),
                ..TimeframeVisibility::default()
            };
            assert!(refused.validate().is_err(), "minutes {from}..{to}");
        }
        let too_long = TimeframeVisibility {
            hours: range(1, 13),
            ..TimeframeVisibility::default()
        };
        assert!(too_long.validate().is_err());
    }
}
