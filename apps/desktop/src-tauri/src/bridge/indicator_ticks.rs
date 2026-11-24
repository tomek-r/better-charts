//! Desktop-only raw tick history for indicators calculated on N-tick bars: a
//! range of the chart symbol, fetched with the EA's existing tick history page
//! message so there is no wire change (see `docs/protocol/bridge-v1.md`,
//! "Indicator ticks").
//!
//! The route has slots of its own, kept apart from the tick profile's request,
//! cache and events, so an indicator read never displaces a profile page (and
//! vice versa). Requests are keyed by the caller and several may be in flight at
//! once; the latest request per key wins. Price counts are never asked for: the
//! indicator nests its own bars from the raw ticks.

use super::{
    drop_footprint_feed, indicator_series::is_valid_series_key, BridgeState, KeyedRoute,
    LatestPerKeySlots,
};
use std::sync::MutexGuard;
use trading_core::protocol::TickHistoryRequest;

/// Caller keys this route keeps at once, queued or awaited; a request for a new
/// key beyond the bound drops the oldest one.
pub(crate) const MAX_INDICATOR_TICK_KEYS: usize = 8;
/// Request-id family of the ticks route. The EA echoes it on the tick snapshot
/// and on a correlated error, which is how a frame finds the key it answers.
pub(crate) const INDICATOR_TICKS_ID_PREFIX: &str = "rust-indicator-ticks-";

/// One caller's request for a range of raw ticks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndicatorTicksRequest {
    /// The caller's routing key; the response carries it back unchanged.
    pub(crate) key: String,
    /// The tick page that fetches the range.
    pub(crate) page: TickHistoryRequest,
}

impl IndicatorTicksRequest {
    /// Validates one caller order into the tick page that fetches it;
    /// `page_ticks_limit` is the negotiated `max_ticks_per_page`, the largest
    /// page the connected EA accepts.
    pub(crate) fn build(
        key: String,
        symbol: String,
        from_ms: i64,
        to_ms: i64,
        max_ticks: u32,
        page_ticks_limit: u32,
    ) -> Result<Self, String> {
        if !is_valid_series_key(&key) {
            return Err("invalid indicator ticks key".to_owned());
        }
        let page = TickHistoryRequest {
            symbol,
            from_ms,
            to_ms,
            max_ticks,
        };
        if max_ticks > page_ticks_limit {
            return Err("invalid tick history request".to_owned());
        }
        page.validate().map_err(str::to_owned)?;
        Ok(Self { key, page })
    }
}

impl KeyedRoute for IndicatorTicksRequest {
    const MAX_KEYS: usize = MAX_INDICATOR_TICK_KEYS;
    const ID_PREFIX: &'static str = INDICATOR_TICKS_ID_PREFIX;

    fn key(&self) -> &str {
        &self.key
    }
}

/// Queued and awaited tick requests, one entry per caller key and bounded to
/// [`MAX_INDICATOR_TICK_KEYS`], apart from the tick profile's own request. A
/// newer request for a key replaces the older one together with the response it
/// still awaited, so the latest request per key wins.
pub(crate) type IndicatorTicksState = LatestPerKeySlots<IndicatorTicksRequest>;

/// The tick slots of `state`: the single place naming the poisoned-mutex
/// expectation shared by the command, the outbound flush and the handlers.
pub(crate) fn ticks_slots(state: &BridgeState) -> MutexGuard<'_, IndicatorTicksState> {
    state
        .indicator_ticks
        .lock()
        .expect("indicator ticks mutex poisoned")
}

/// Queues `request` for the outbound flush. The caller holds `session_work` and has already refused
/// anything the route does not serve; the host's own footprint reads queue through here too.
pub(crate) fn queue_indicator_ticks(state: &BridgeState, request: IndicatorTicksRequest) {
    ticks_slots(state).queue(request);
    state.wake_outbound();
}

/// Forgets every queued and awaited tick request of `state`: a new session or
/// another chart symbol makes all of them stale. The chart's footprint reads travel through these
/// requests, so their feed goes with them.
pub(crate) fn clear_indicator_ticks(state: &BridgeState) {
    ticks_slots(state).clear();
    drop_footprint_feed(state);
}
