//! Desktop-only raw tick history for indicators calculated on N-tick bars: a
//! range of the chart symbol, fetched with the EA's existing tick history page
//! message so there is no wire change (see `docs/protocol/bridge-v1.md`,
//! "Indicator ticks").
//!
//! The route has slots of its own, kept apart from the tick profile's request,
//! cache and events, so an indicator read never displaces a profile page (and
//! vice versa). Requests are keyed by the caller, and the latest request per key
//! wins. The EA serves one `tick_history_request` at a time and silently cancels
//! the one it was serving, so the host keeps one request in flight at once, across
//! this route and the tick profile together (see [`claim_next_tick_request`]).
//! Price counts are never asked for: the indicator nests its own bars from the raw
//! ticks. The host's own footprint reads ask this route for MT5's counted pages
//! once the handshake negotiated `tick_footprint_counts`, and keep the raw page for
//! an EA that did not.

use super::{
    drop_footprint_feed, indicator_series::is_valid_series_key, BridgeState, KeyedRoute,
    LatestPerKeySlots, OutboundSlot,
};
use serde::Serialize;
use std::{
    sync::{atomic::AtomicU64, MutexGuard},
    time::{Duration, Instant},
};
use trading_core::protocol::{FootprintCarry, TickFootprintHistoryRequest, TickHistoryRequest};

/// Caller keys this route keeps at once, queued or awaited; a request for a new
/// key beyond the bound drops the oldest one.
pub(crate) const MAX_INDICATOR_TICK_KEYS: usize = 8;
/// Request-id family of the ticks route. The EA echoes it on the tick snapshot
/// and on a correlated error, which is how a frame finds the key it answers.
pub(crate) const INDICATOR_TICKS_ID_PREFIX: &str = "rust-indicator-ticks-";
/// How long the host waits for the answer to one tick history request. The EA
/// fails a read of its own after 120 s, so a request unanswered past this can no
/// longer be served and must not hold the host's one wire slot.
pub(crate) const TICK_ANSWER_TIMEOUT: Duration = Duration::from_secs(150);

/// What a counted footprint page asks the peer for: each counted trade weighted by the volume it moved
/// — or counted as one when it moved none — and the tick-rule state the bar's last page left.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FootprintCountsOptions {
    pub(crate) real_volume: bool,
    pub(crate) carry: Option<FootprintCarry>,
}

impl FootprintCountsOptions {
    /// `page` asked for the trades counted per price instead of the raw ticks.
    fn request(&self, page: TickHistoryRequest) -> TickFootprintHistoryRequest {
        TickFootprintHistoryRequest {
            history: page,
            // A page without the flag is a raw tick page on the wire, and the request's own validation
            // refuses one.
            footprint_counts: true,
            real_volume: self.real_volume,
            carry: self.carry.clone(),
        }
    }
}

/// The payload one ticks request writes: the raw tick page, or the counted page of a footprint read.
/// Both are `tick_history_request` frames, so the wire's message type never changes.
#[derive(Debug, Clone)]
pub(crate) enum TicksWireRequest {
    Raw(TickHistoryRequest),
    Counts(TickFootprintHistoryRequest),
}

impl Serialize for TicksWireRequest {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Raw(page) => page.serialize(serializer),
            Self::Counts(counts) => counts.serialize(serializer),
        }
    }
}

/// One caller's request for a range of raw ticks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndicatorTicksRequest {
    /// The caller's routing key; the response carries it back unchanged.
    pub(crate) key: String,
    /// The tick page that fetches the range.
    pub(crate) page: TickHistoryRequest,
    /// Set when the read asks for the trades counted per price instead of the raw ticks.
    pub(crate) footprint_counts: Option<FootprintCountsOptions>,
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
        check_order(&key, max_ticks, page_ticks_limit)?;
        let page = TickHistoryRequest {
            symbol,
            from_ms,
            to_ms,
            max_ticks,
        };
        page.validate().map_err(str::to_owned)?;
        Ok(Self {
            key,
            page,
            footprint_counts: None,
        })
    }

    /// Validates one footprint read's counted page, which the peer answers with
    /// `tick_footprint_history_snapshot`; `page_ticks_limit` is the negotiated
    /// `max_ticks_per_page`.
    pub(crate) fn build_footprint_counts(
        key: String,
        request: TickFootprintHistoryRequest,
        page_ticks_limit: u32,
    ) -> Result<Self, String> {
        check_order(&key, request.history.max_ticks, page_ticks_limit)?;
        request.validate().map_err(str::to_owned)?;
        let counts = FootprintCountsOptions {
            real_volume: request.real_volume,
            carry: request.carry,
        };
        Ok(Self {
            key,
            page: request.history,
            footprint_counts: Some(counts),
        })
    }

    /// The counted request this slot answers, when it is a footprint read's.
    pub(crate) fn counts_request(&self) -> Option<TickFootprintHistoryRequest> {
        self.footprint_counts
            .as_ref()
            .map(|counts| counts.request(self.page.clone()))
    }

    /// The payload this request writes.
    pub(crate) fn wire_request(&self) -> TicksWireRequest {
        self.counts_request().map_or_else(
            || TicksWireRequest::Raw(self.page.clone()),
            TicksWireRequest::Counts,
        )
    }
}

/// The key rule and the page bounds one caller order must meet; the page's own
/// range is the page's to validate.
fn check_order(key: &str, max_ticks: u32, page_ticks_limit: u32) -> Result<(), String> {
    if !is_valid_series_key(key) {
        return Err("invalid indicator ticks key".to_owned());
    }
    if max_ticks > page_ticks_limit {
        return Err("invalid tick history request".to_owned());
    }
    Ok(())
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

/// Claims the oldest queued tick request for the wire, or answers `None` while a
/// tick history request is awaited at the EA — this route's or the tick profile's.
/// The EA serves one at a time and silently cancels the one it was serving, so a
/// second request must stay queued until the first is answered or failed.
pub(crate) fn claim_next_tick_request(
    state: &BridgeState,
    next_request_id: &AtomicU64,
    now: Instant,
) -> Option<OutboundSlot<IndicatorTicksRequest>> {
    if tick_profile_awaits(state) {
        return None;
    }
    ticks_slots(state).claim_next(next_request_id, now)
}

/// Whether the tick profile's own page is awaited: the profile's page and this
/// route's requests share the EA's one tick history slot.
fn tick_profile_awaits(state: &BridgeState) -> bool {
    state
        .expected_tick_profile
        .lock()
        .expect("tick profile mutex poisoned")
        .is_some()
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

#[cfg(test)]
mod tests {
    use super::*;
    use trading_core::protocol::FootprintSide;

    /// The counted page a footprint read asks for: a one-second range of `NAS100`.
    fn counts_request(
        real_volume: bool,
        carry: Option<FootprintCarry>,
    ) -> TickFootprintHistoryRequest {
        TickFootprintHistoryRequest {
            history: TickHistoryRequest {
                symbol: "NAS100".to_owned(),
                from_ms: 1_000,
                to_ms: 2_000,
                max_ticks: 500,
            },
            footprint_counts: true,
            real_volume,
            carry,
        }
    }

    #[test]
    fn a_counts_slot_writes_footprint_counts_real_volume_and_carry() {
        let carry = Some(FootprintCarry {
            price: "25001.75".to_owned(),
            side: FootprintSide::Sell,
        });
        let request = IndicatorTicksRequest::build_footprint_counts(
            "chart-footprint".to_owned(),
            counts_request(true, carry.clone()),
            5_000,
        )
        .expect("a counts page the wire accepts");

        let wire = serde_json::to_value(request.wire_request()).expect("a wire payload");

        assert_eq!(wire["symbol"], "NAS100");
        assert_eq!(wire["from_ms"], 1_000);
        assert_eq!(wire["to_ms"], 2_000);
        assert_eq!(wire["max_ticks"], 500);
        assert_eq!(wire["footprint_counts"], true);
        assert_eq!(wire["real_volume"], true);
        assert_eq!(
            wire["carry"],
            serde_json::json!({"price": "25001.75", "side": "sell"})
        );
        assert_eq!(
            request.footprint_counts,
            Some(FootprintCountsOptions {
                real_volume: true,
                carry,
            }),
            "the slot keeps what it asks the peer for"
        );
    }

    #[test]
    fn a_counts_slot_refuses_a_page_the_ea_would_not_serve() {
        let too_many = IndicatorTicksRequest::build_footprint_counts(
            "chart-footprint".to_owned(),
            counts_request(false, None),
            499,
        );
        assert_eq!(
            too_many.err().as_deref(),
            Some("invalid tick history request")
        );

        let raw = TickFootprintHistoryRequest {
            footprint_counts: false,
            ..counts_request(false, None)
        };
        assert!(
            IndicatorTicksRequest::build_footprint_counts("chart-footprint".to_owned(), raw, 500)
                .is_err(),
            "a page without the counts flag is no footprint page"
        );
    }
}
