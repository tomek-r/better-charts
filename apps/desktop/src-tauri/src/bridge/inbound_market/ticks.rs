//! Frames of the desktop's indicator ticks route (see
//! [`super::super::indicator_ticks`]): the raw tick pages and correlated errors
//! of the requests it issued. They are matched by their `rust-indicator-ticks-`
//! ids, so the tick profile's own stream, cache and events never see them.

use super::super::{
    bridge_emit, claim_for_session, log_warn, ticks_slots, Inbound, InboundOutcome,
    IndicatorTickView, IndicatorTicksUnavailableView, IndicatorTicksView,
};
use trading_core::protocol::{ErrorCode, TickHistorySnapshot};

/// Handles `tick_history_snapshot` when it answers an awaited indicator ticks
/// request; `None` when it is not one, so the caller keeps routing it to the tick
/// profile. The caller holds the session gate.
pub(super) fn ticks_snapshot(
    inbound: &Inbound<'_>,
    snapshot: &TickHistorySnapshot,
) -> Option<InboundOutcome> {
    let request = ticks_slots(inbound.state).take_awaited(&snapshot.request_id)?;
    if snapshot.validate(&request.page).is_err() {
        return Some(InboundOutcome::ErrorFrame(
            ErrorCode::InvalidMessage,
            "invalid tick history snapshot",
        ));
    }
    bridge_emit(
        inbound.events,
        "indicator-ticks",
        IndicatorTicksView {
            key: request.key,
            symbol: snapshot.symbol.clone(),
            from_ms: snapshot.from_ms,
            to_ms: snapshot.to_ms,
            complete: snapshot.complete,
            ticks: snapshot.ticks.iter().map(IndicatorTickView::from).collect(),
        },
    );
    Some(InboundOutcome::Continue)
}

/// A correlated ticks failure (the EA could not read that range in time). Only
/// that key ends, with the EA's message; the session, the tick profile and every
/// other request stay up. A stale id, whose key was answered or replaced, is
/// ignored like a stale page.
pub(super) fn ticks_error(
    inbound: &Inbound<'_>,
    request_id: &str,
    message: String,
) -> InboundOutcome {
    let _ = claim_for_session(inbound.state, inbound.session_id, || {
        let Some(request) = ticks_slots(inbound.state).take_awaited(request_id) else {
            return;
        };
        log_warn(&format!(
            "indicator ticks {} {} {}..{} failed: {message}",
            request.key, request.page.symbol, request.page.from_ms, request.page.to_ms
        ));
        bridge_emit(
            inbound.events,
            "indicator-ticks-unavailable",
            IndicatorTicksUnavailableView {
                key: request.key,
                symbol: request.page.symbol,
                message,
            },
        );
    });
    InboundOutcome::Continue
}
