//! Frames of the desktop's indicator series route (see
//! [`super::super::indicator_series`]): the page snapshots and correlated errors
//! of the requests it issued. They are matched by their `rust-series-` ids, so
//! the chart's window and page slots never see them.

use super::super::{
    bridge_emit, claim_for_session, log_warn, series_slots, Inbound, InboundOutcome,
    IndicatorSeriesUnavailableView, IndicatorSeriesView,
};
use trading_core::protocol::{ErrorCode, HistorySnapshot};

/// Handles `snapshot` when it answers an awaited series request; `None` when it
/// is not one, so the caller keeps routing it. The caller holds the session gate.
pub(super) fn series_snapshot(
    inbound: &Inbound<'_>,
    snapshot: &HistorySnapshot,
) -> Option<InboundOutcome> {
    let request = series_slots(inbound.state).take_awaited(&snapshot.request_id)?;
    if snapshot.validate(&request.page).is_err() {
        return Some(InboundOutcome::ErrorFrame(
            ErrorCode::InvalidMessage,
            "invalid history snapshot",
        ));
    }
    bridge_emit(
        inbound.events,
        "indicator-series",
        IndicatorSeriesView {
            key: request.key,
            symbol: snapshot.symbol.clone(),
            timeframe: snapshot.timeframe.clone(),
            complete: snapshot.complete,
            before_ms: request.before_ms,
            candles: snapshot.candles.clone(),
        },
    );
    Some(InboundOutcome::Continue)
}

/// A correlated series failure (the EA could not synchronize that timeframe in
/// time). Only that key ends, with the EA's message; the session and every other
/// request stay up. A stale id, whose key was answered or replaced, is ignored
/// like a stale page.
pub(super) fn series_error(
    inbound: &Inbound<'_>,
    request_id: &str,
    message: String,
) -> InboundOutcome {
    let _ = claim_for_session(inbound.state, inbound.session_id, || {
        let Some(request) = series_slots(inbound.state).take_awaited(request_id) else {
            return;
        };
        log_warn(&format!(
            "indicator series {} {} {} failed: {message}",
            request.key, request.page.symbol, request.page.timeframe
        ));
        bridge_emit(
            inbound.events,
            "indicator-series-unavailable",
            IndicatorSeriesUnavailableView {
                key: request.key,
                symbol: request.page.symbol,
                timeframe: request.page.timeframe,
                message,
            },
        );
    });
    InboundOutcome::Continue
}
