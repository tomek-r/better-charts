//! Why a fixed-range profile uses ticks or bars, and the one log line that
//! says so. The hybrid choice has several deliberate fallbacks to ticks; the
//! reason is a typed value so each fallback is distinguishable in the
//! `pnpm dev` terminal. Lines carry the symbol, the range and counts only.

use crate::bridge::{ProfileSource, TickProfileLimit, TickProfileRequest};
use std::borrow::Cow;
use trading_core::protocol::ErrorCode;

/// Why [`SourceDecision::source`] was chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceReason {
    /// The estimate fits every tick limit.
    UnderBudget,
    /// The estimate page did not reach the range start, so it cannot be trusted.
    EstimateIncomplete,
    /// Tick size or point of the symbol is not cached yet.
    NoSymbolMetadata,
    /// No supported timeframe covers the range in one estimate page.
    NoTimeframeFits,
    /// The estimate bars could not be turned into a load estimate.
    EstimateInvalid,
    /// The EA answered the estimate page with a correlated `error`.
    EstimateError(ErrorCode),
    /// The estimate page failed validation.
    EstimatePageInvalid,
    OverTickBudget,
    OverPriceCap,
    OverPageCap,
}

impl SourceReason {
    fn text(self) -> Cow<'static, str> {
        match self {
            Self::UnderBudget => "under-budget estimate".into(),
            Self::EstimateIncomplete => "estimate-incomplete".into(),
            Self::NoSymbolMetadata => "no-symbol-metadata".into(),
            Self::NoTimeframeFits => "no-timeframe-fits".into(),
            Self::EstimateInvalid => "estimate-invalid".into(),
            Self::EstimateError(code) => {
                format!("estimate-error code={}", error_code_text(code)).into()
            }
            Self::EstimatePageInvalid => "estimate-page-invalid".into(),
            Self::OverTickBudget => "over-tick-budget".into(),
            Self::OverPriceCap => "over-price-cap".into(),
            Self::OverPageCap => "over-page-cap".into(),
        }
    }
}

/// Wire spelling of an error code (`SCREAMING_SNAKE_CASE`).
fn error_code_text(code: ErrorCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "UNKNOWN".to_owned())
}

/// Estimated cost against the budget it was compared with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LoadFigures {
    pub(crate) ticks: u64,
    pub(crate) max_ticks: u64,
    pub(crate) prices: u64,
    pub(crate) max_prices: u64,
    pub(crate) pages: u64,
    pub(crate) max_pages: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceDecision {
    pub(crate) source: ProfileSource,
    pub(crate) reason: SourceReason,
    /// Timeframe of the estimate page, when one was asked for.
    pub(crate) estimate_timeframe: Option<String>,
    pub(crate) estimate_bars: Option<usize>,
    pub(crate) load: Option<LoadFigures>,
}

impl SourceDecision {
    pub(crate) fn ticks(reason: SourceReason) -> Self {
        Self::bare(ProfileSource::Ticks, reason)
    }

    fn bare(source: ProfileSource, reason: SourceReason) -> Self {
        Self {
            source,
            reason,
            estimate_timeframe: None,
            estimate_bars: None,
            load: None,
        }
    }

    pub(crate) fn with_estimate(mut self, timeframe: &str, bars: usize) -> Self {
        self.estimate_timeframe = Some(timeframe.to_owned());
        self.estimate_bars = Some(bars);
        self
    }

    pub(crate) fn with_load(mut self, load: LoadFigures) -> Self {
        self.load = Some(load);
        self
    }

    /// Source and reason for an estimate that fit or exceeded `load`. The
    /// first limit in tick, price, page order names the reason.
    pub(crate) fn from_load(load: LoadFigures) -> Self {
        let reason = if load.ticks > load.max_ticks {
            Some(SourceReason::OverTickBudget)
        } else if load.prices > load.max_prices {
            Some(SourceReason::OverPriceCap)
        } else if load.pages > load.max_pages {
            Some(SourceReason::OverPageCap)
        } else {
            None
        };
        match reason {
            Some(reason) => Self::bare(ProfileSource::Bars, reason),
            None => Self::bare(ProfileSource::Ticks, SourceReason::UnderBudget),
        }
        .with_load(load)
    }
}

/// `tick profile EURUSD 2026-03-31T00:00Z..2026-06-02T00:00Z`
fn subject(request: &TickProfileRequest) -> String {
    format!(
        "tick profile {} {}..{}",
        request.wire.symbol,
        utc_minute(request.wire.from_ms),
        utc_minute(request.wire.to_ms)
    )
}

pub(crate) fn decision_line(
    request: &TickProfileRequest,
    decision: &SourceDecision,
    collect_timeframe: Option<&str>,
) -> String {
    let source = source_text(decision.source);
    let mut line = format!(
        "{}: source={source} reason={}",
        subject(request),
        decision.reason.text()
    );
    if let Some(timeframe) = collect_timeframe {
        line.push_str(&format!(" tf={timeframe}"));
    }
    if let Some(timeframe) = &decision.estimate_timeframe {
        let label = if collect_timeframe.is_some() {
            "estimate-tf"
        } else {
            "tf"
        };
        line.push_str(&format!(" {label}={timeframe}"));
    }
    if let Some(bars) = decision.estimate_bars {
        line.push_str(&format!(" bars={bars}"));
    }
    if let Some(load) = decision.load {
        line.push_str(&format!(
            " ticks={}/{} prices={}/{} pages={}/{}",
            compact(load.ticks),
            compact(load.max_ticks),
            compact(load.prices),
            compact(load.max_prices),
            load.pages,
            load.max_pages
        ));
    }
    line
}

pub(crate) fn safety_net_line(
    request: &TickProfileRequest,
    limit: TickProfileLimit,
    timeframe: Option<&str>,
) -> String {
    let limit = match limit {
        TickProfileLimit::Pages => "pages",
        _ => "distinct-prices",
    };
    let timeframe = timeframe.map_or(String::new(), |tf| format!(" tf={tf}"));
    format!(
        "{}: safety-net source=bars after limit={limit}{timeframe}",
        subject(request)
    )
}

/// A timeframe whose history ends inside the range; `next` is tried instead.
pub(crate) fn retry_line(
    request: &TickProfileRequest,
    timeframe: &str,
    oldest_ms: Option<i64>,
    next: &str,
) -> String {
    let history = oldest_ms.map_or("has no bars".to_owned(), |oldest_ms| {
        format!("history ends {} before range start", utc_minute(oldest_ms))
    });
    format!(
        "{}: bars tf={timeframe} {history}; retry tf={next}",
        subject(request)
    )
}

/// The profile was built from history that starts inside the range.
pub(crate) fn partial_history_line(
    request: &TickProfileRequest,
    timeframe: &str,
    covered_from_ms: i64,
) -> String {
    format!(
        "{}: partial-history from={} tf={timeframe}",
        subject(request),
        utc_minute(covered_from_ms)
    )
}

pub(crate) fn cache_line(request: &TickProfileRequest, source: ProfileSource) -> String {
    format!(
        "{}: served from cache source={}",
        subject(request),
        source_text(source)
    )
}

pub(crate) fn completion_line(
    request: &TickProfileRequest,
    source: ProfileSource,
    elapsed_ms: u64,
    pages: usize,
    bars: Option<usize>,
) -> String {
    let bars = bars.map_or(String::new(), |bars| format!(" bars={bars}"));
    format!(
        "{}: completed source={} elapsed_ms={elapsed_ms} pages={pages}{bars}",
        subject(request),
        source_text(source)
    )
}

fn source_text(source: ProfileSource) -> &'static str {
    match source {
        ProfileSource::Ticks => "ticks",
        ProfileSource::Bars => "bars",
    }
}

/// Info-level line for the `pnpm dev` terminal, like the other bridge events.
pub(crate) fn log_info(line: &str) {
    eprintln!("[bridge] INFO {line}");
}

/// Warn-level line: a degraded but handled condition.
pub(crate) fn log_warn(line: &str) {
    eprintln!("[bridge] WARN {line}");
}

/// `16400000` -> `16.4M`, `410000` -> `410k`, small values unchanged.
fn compact(value: u64) -> String {
    let scaled = |unit: u64, suffix: &str| {
        let tenths = value.saturating_mul(10) / unit;
        if tenths % 10 == 0 {
            format!("{}{suffix}", tenths / 10)
        } else {
            format!("{}.{}{suffix}", tenths / 10, tenths % 10)
        }
    };
    if value >= 1_000_000 {
        scaled(1_000_000, "M")
    } else if value >= 1_000 {
        scaled(1_000, "k")
    } else {
        value.to_string()
    }
}

/// `2026-03-31T00:00Z` from epoch milliseconds (proleptic Gregorian, UTC).
fn utc_minute(ms: i64) -> String {
    let minutes = ms.div_euclid(60_000);
    let (days, minute_of_day) = (minutes.div_euclid(1440), minutes.rem_euclid(1440));
    // Civil-from-days (Howard Hinnant); valid for the whole i64 minute range
    // used here.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}Z",
        minute_of_day / 60,
        minute_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::TickHistoryRequest;
    use crate::test_clock::utc_now_ms;

    const DAY_MS: i64 = 86_400_000;

    fn range_start_ms() -> i64 {
        utc_now_ms() - 62 * DAY_MS
    }

    fn range_end_ms() -> i64 {
        utc_now_ms() - DAY_MS
    }

    /// The history of a bar series that ends 11 days before the range starts.
    fn history_end_ms() -> i64 {
        range_start_ms() - 11 * DAY_MS
    }

    /// The range as the decision lines print it. `utc_minute` has its own
    /// known-answer test, so the expected lines can build on it.
    fn range_label() -> String {
        format!(
            "{}..{}",
            utc_minute(range_start_ms()),
            utc_minute(range_end_ms())
        )
    }

    fn line_prefix() -> String {
        format!("tick profile NAS100 {}:", range_label())
    }

    fn request() -> TickProfileRequest {
        TickProfileRequest {
            wire: TickHistoryRequest {
                symbol: "NAS100".into(),
                from_ms: range_start_ms(),
                to_ms: range_end_ms(),
                max_ticks: 5000,
            },
            rows: 128,
        }
    }

    fn load(ticks: u64, prices: u64, pages: u64) -> LoadFigures {
        LoadFigures {
            ticks,
            max_ticks: 30_000_000,
            prices,
            max_prices: 1_000_000,
            pages,
            max_pages: 2048,
        }
    }

    #[test]
    fn range_is_printed_as_utc_minutes() {
        // Pinned because the subject is the known-answer formatting of fixed
        // instants, including a month-length edge (31 March) and the epoch.
        assert_eq!(utc_minute(1_774_915_200_000), "2026-03-31T00:00Z");
        assert_eq!(utc_minute(1_780_358_400_000), "2026-06-02T00:00Z");
        assert_eq!(utc_minute(0), "1970-01-01T00:00Z");
        assert_eq!(utc_minute(-60_000), "1969-12-31T23:59Z");
    }

    #[test]
    fn counts_are_compacted() {
        assert_eq!(compact(999), "999");
        assert_eq!(compact(410_000), "410k");
        assert_eq!(compact(16_400_000), "16.4M");
        assert_eq!(compact(30_000_000), "30M");
    }

    #[test]
    fn load_within_every_limit_is_under_budget_ticks() {
        let decision = SourceDecision::from_load(load(30_000_000, 1_000_000, 2048));
        assert_eq!(decision.source, ProfileSource::Ticks);
        assert_eq!(decision.reason, SourceReason::UnderBudget);
    }

    #[test]
    fn each_exceeded_limit_names_its_reason_in_tick_price_page_order() {
        let reason = |load| SourceDecision::from_load(load).reason;
        assert_eq!(reason(load(30_000_001, 1, 1)), SourceReason::OverTickBudget);
        assert_eq!(reason(load(1, 1_000_001, 1)), SourceReason::OverPriceCap);
        assert_eq!(reason(load(1, 1, 2049)), SourceReason::OverPageCap);
        assert_eq!(
            reason(load(30_000_001, 1_000_001, 2049)),
            SourceReason::OverTickBudget
        );
        assert_eq!(
            SourceDecision::from_load(load(1, 1, 2049)).source,
            ProfileSource::Bars
        );
    }

    #[test]
    fn decision_line_for_an_affordable_estimate_carries_figures() {
        let decision =
            SourceDecision::from_load(load(16_400_000, 410_000, 63)).with_estimate("H2", 742);
        assert_eq!(
            decision_line(&request(), &decision, None),
            format!(
                "{} source=ticks \
                 reason=under-budget estimate tf=H2 bars=742 ticks=16.4M/30M prices=410k/1M pages=63/2048",
                line_prefix()
            )
        );
    }

    #[test]
    fn decision_lines_for_each_fallback_reason() {
        let line = |decision: SourceDecision| decision_line(&request(), &decision, None);
        let prefix = format!("{} source=ticks", line_prefix());
        assert_eq!(
            line(SourceDecision::ticks(SourceReason::EstimateIncomplete).with_estimate("H2", 0)),
            format!("{prefix} reason=estimate-incomplete tf=H2 bars=0")
        );
        assert_eq!(
            line(SourceDecision::ticks(SourceReason::NoSymbolMetadata)),
            format!("{prefix} reason=no-symbol-metadata")
        );
        assert_eq!(
            line(SourceDecision::ticks(SourceReason::NoTimeframeFits)),
            format!("{prefix} reason=no-timeframe-fits")
        );
        assert_eq!(
            line(SourceDecision::ticks(SourceReason::EstimateError(
                ErrorCode::InternalError
            ))),
            format!("{prefix} reason=estimate-error code=INTERNAL_ERROR")
        );
        assert_eq!(
            line(SourceDecision::ticks(SourceReason::EstimateInvalid)),
            format!("{prefix} reason=estimate-invalid")
        );
        assert_eq!(
            line(SourceDecision::ticks(SourceReason::EstimatePageInvalid)),
            format!("{prefix} reason=estimate-page-invalid")
        );
    }

    #[test]
    fn bar_decision_line_names_the_collection_and_estimate_timeframes() {
        let decision = SourceDecision::from_load(load(40_000_000, 1, 1)).with_estimate("H2", 742);
        assert_eq!(
            decision_line(&request(), &decision, Some("M1")),
            format!(
                "{} source=bars \
                 reason=over-tick-budget tf=M1 estimate-tf=H2 bars=742 ticks=40M/30M prices=1/1M pages=1/2048",
                line_prefix()
            )
        );
    }

    #[test]
    fn retry_and_partial_history_lines_name_the_timeframes_and_the_history_start() {
        let prefix = line_prefix();
        let history_end = utc_minute(history_end_ms());
        assert_eq!(
            retry_line(&request(), "M2", Some(history_end_ms()), "M3"),
            format!(
                "{prefix} bars tf=M2 history ends {history_end} before range start; retry tf=M3"
            )
        );
        assert_eq!(
            partial_history_line(&request(), "H1", history_end_ms()),
            format!("{prefix} partial-history from={history_end} tf=H1")
        );
        assert_eq!(
            retry_line(&request(), "M2", None, "H1"),
            format!("{prefix} bars tf=M2 has no bars; retry tf=H1")
        );
    }

    #[test]
    fn safety_net_cache_and_completion_lines() {
        let prefix = line_prefix();
        assert_eq!(
            safety_net_line(&request(), TickProfileLimit::Pages, Some("M1")),
            format!("{prefix} safety-net source=bars after limit=pages tf=M1")
        );
        assert_eq!(
            safety_net_line(&request(), TickProfileLimit::DistinctPrices, None),
            format!("{prefix} safety-net source=bars after limit=distinct-prices")
        );
        assert_eq!(
            cache_line(&request(), ProfileSource::Ticks),
            format!("{prefix} served from cache source=ticks")
        );
        assert_eq!(
            completion_line(&request(), ProfileSource::Bars, 812, 5, Some(742)),
            format!("{prefix} completed source=bars elapsed_ms=812 pages=5 bars=742")
        );
        assert_eq!(
            completion_line(&request(), ProfileSource::Ticks, 90, 63, None),
            format!("{prefix} completed source=ticks elapsed_ms=90 pages=63")
        );
    }
}
