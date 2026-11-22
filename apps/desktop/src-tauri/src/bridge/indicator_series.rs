//! Desktop-only candle series for indicators: any supported timeframe of the
//! chart symbol, fetched with the EA's older-history page message so there is
//! no wire change (see `docs/protocol/bridge-v1.md`, "Indicator series").
//!
//! The route has slots of its own, kept apart from the chart's window, its lazy
//! pages and the profile bar pages, so a series read never displaces lazy
//! loading (and vice versa) and never touches the live feed. Requests are keyed
//! by the caller and several may be in flight at once; the latest request per
//! key wins.

use super::{BridgeState, KeyedRoute, LatestPerKeySlots};
use std::sync::MutexGuard;
use trading_core::protocol::HistoryRequest;

/// Caller keys this route keeps at once, queued or awaited; a request for a new
/// key beyond the bound drops the oldest one.
pub(crate) const MAX_INDICATOR_SERIES_KEYS: usize = 16;
/// Longest caller key, so the routing table stays bounded per request too.
pub(crate) const MAX_INDICATOR_SERIES_KEY_CHARS: usize = 64;
/// Request-id family of the series route. The EA echoes it on the page snapshot
/// and on a correlated error, which is how a frame finds the key it answers.
pub(crate) const INDICATOR_SERIES_ID_PREFIX: &str = "rust-series-";
/// How far past the wall clock the anchor of a "newest bars" request sits: the
/// EA answers the newest candles strictly older than the anchor, so a year
/// ahead is past any bar a broker holds without trusting the broker's clock.
pub(crate) const NEWEST_SERIES_ANCHOR_LEAD_MS: i64 = 365 * 24 * 60 * 60 * 1000;

/// One caller's request for an indicator series.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndicatorSeriesRequest {
    /// The caller's routing key; the response carries it back unchanged.
    pub(crate) key: String,
    /// The older-history page that fetches the candles.
    pub(crate) page: HistoryRequest,
    /// The caller's own anchor, echoed to the frontend. `None` asked for the
    /// newest bars, which the page reaches through a far-future anchor.
    pub(crate) before_ms: Option<i64>,
}

impl IndicatorSeriesRequest {
    /// Validates one caller order into the page that fetches it; `wall_clock_ms`
    /// is the current time the "newest bars" anchor is measured from.
    pub(crate) fn build(
        key: String,
        symbol: String,
        timeframe: String,
        bars: u16,
        before_ms: Option<i64>,
        wall_clock_ms: i64,
    ) -> Result<Self, String> {
        if !is_valid_series_key(&key) {
            return Err("invalid indicator series key".to_owned());
        }
        let page = HistoryRequest {
            symbol,
            timeframe,
            bars,
            before_ms: Some(series_anchor_ms(before_ms, wall_clock_ms)),
        };
        page.validate().map_err(str::to_owned)?;
        Ok(Self {
            key,
            page,
            before_ms,
        })
    }
}

/// Keys the indicator routes accept from the frontend: bounded
/// `[A-Za-z0-9_:-]`.
pub(crate) fn is_valid_series_key(key: &str) -> bool {
    (1..=MAX_INDICATOR_SERIES_KEY_CHARS).contains(&key.len()) && key.chars().all(is_series_key_char)
}

fn is_series_key_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | ':' | '-')
}

/// The page anchor a series request is sent with: the caller's own, or, for "the
/// newest bars", one year past the wall clock.
pub(crate) fn series_anchor_ms(before_ms: Option<i64>, wall_clock_ms: i64) -> i64 {
    before_ms.unwrap_or_else(|| wall_clock_ms.saturating_add(NEWEST_SERIES_ANCHOR_LEAD_MS))
}

impl KeyedRoute for IndicatorSeriesRequest {
    const MAX_KEYS: usize = MAX_INDICATOR_SERIES_KEYS;
    const ID_PREFIX: &'static str = INDICATOR_SERIES_ID_PREFIX;

    fn key(&self) -> &str {
        &self.key
    }
}

/// Queued and awaited series requests, one entry per caller key and bounded to
/// [`MAX_INDICATOR_SERIES_KEYS`], apart from every chart slot. A newer request
/// for a key replaces the older one together with the response it still awaited,
/// so the latest request per key wins.
pub(crate) type IndicatorSeriesState = LatestPerKeySlots<IndicatorSeriesRequest>;

/// The series slots of `state`: the single place naming the poisoned-mutex
/// expectation shared by the command, the outbound flush and the handlers.
pub(crate) fn series_slots(state: &BridgeState) -> MutexGuard<'_, IndicatorSeriesState> {
    state
        .indicator_series
        .lock()
        .expect("indicator series mutex poisoned")
}

/// Forgets every queued and awaited series of `state`: a new session or another
/// chart symbol makes all of them stale.
pub(crate) fn clear_indicator_series(state: &BridgeState) {
    series_slots(state).clear();
}
