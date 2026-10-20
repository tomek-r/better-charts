use super::super::{
    bridge_emit, build_streamed_tick_profile, build_tick_profile, claim_for_session,
    collect_timeframe, completion_line, log_info, log_warn, request_history_inner, safety_net_line,
    start_bar_collect, ChartSelection, HistoryUnavailableView, ProfileSource, TickPageResult,
    TickProfileError, TickProfileLimit, TickProfileProgress, TickProfileRequest,
};
use super::{Inbound, InboundOutcome};
use trading_core::protocol::{
    initial_history_bars, Envelope, ErrorCode, ErrorPayload, TickHistorySnapshot,
};

/// `tick_history_snapshot`: ingest one page of the active tick-profile
/// request and drive the progress/finalization state machine.
pub(crate) async fn tick_history(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let snapshot: TickHistorySnapshot = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => {
            return InboundOutcome::ErrorFrame(
                ErrorCode::InvalidMessage,
                "invalid tick history snapshot",
            );
        }
    };
    let _session_work = match inbound.state.session_work.lock() {
        Ok(guard) => guard,
        Err(_) => return InboundOutcome::Continue,
    };
    if inbound
        .state
        .current_session
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .as_deref()
        != Some(inbound.session_id)
    {
        return InboundOutcome::Continue;
    }
    let expected = {
        let mut expected = inbound
            .state
            .expected_tick_profile
            .lock()
            .expect("tick profile mutex poisoned");
        let Some((_, expected_id, _)) = expected.as_ref() else {
            return InboundOutcome::Continue;
        };
        if snapshot.request_id != *expected_id {
            return InboundOutcome::Continue;
        }
        expected.take().expect("checked above")
    };
    let (expected_generation, _expected_id, _profile_request) = expected;
    let generation = expected_generation;
    let (page_result, progress) = {
        let mut controller = inbound
            .state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        let page_result = controller.ingest(generation, snapshot);
        let progress = controller.progress();
        (page_result, progress)
    };
    finish_tick_page(inbound, page_result, progress)
}

pub(crate) async fn tick_price_history(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    if !*inbound
        .state
        .tick_price_counts
        .lock()
        .expect("tick capability mutex poisoned")
    {
        return InboundOutcome::ErrorFrame(
            ErrorCode::InvalidMessage,
            "price counts not negotiated",
        );
    }
    let snapshot: trading_core::protocol::TickPriceHistorySnapshot =
        match serde_json::from_value(message.payload) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                return InboundOutcome::ErrorFrame(
                    ErrorCode::InvalidMessage,
                    "invalid tick price history snapshot",
                )
            }
        };
    let _session_work = match inbound.state.session_work.lock() {
        Ok(guard) => guard,
        Err(_) => return InboundOutcome::Continue,
    };
    if inbound
        .state
        .current_session
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .as_deref()
        != Some(inbound.session_id)
    {
        return InboundOutcome::Continue;
    }
    let expected = {
        let mut slot = inbound
            .state
            .expected_tick_profile
            .lock()
            .expect("tick profile mutex poisoned");
        if !slot
            .as_ref()
            .is_some_and(|(_, id, _)| *id == snapshot.request_id)
        {
            return InboundOutcome::Continue;
        }
        slot.take().expect("checked above")
    };
    let (page_result, progress) = {
        let mut controller = inbound
            .state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        let result = controller.ingest_price_counts(expected.0, snapshot);
        (result, controller.progress())
    };
    finish_tick_page(inbound, page_result, progress)
}

pub(crate) fn finish_tick_page(
    inbound: &Inbound<'_>,
    page_result: TickPageResult,
    progress: Option<TickProfileProgress>,
) -> InboundOutcome {
    let (final_snapshot, final_request) = match page_result {
        TickPageResult::Stale => return InboundOutcome::Continue,
        TickPageResult::Next(next) => {
            if let Some(progress) = progress {
                bridge_emit(inbound.events, "tick-profile-progress", progress);
            }
            *inbound
                .state
                .pending_tick_profile
                .lock()
                .expect("tick profile mutex poisoned") = Some(next);
            return InboundOutcome::Continue;
        }
        TickPageResult::Final(snapshot, request) => {
            if let Some(progress) = progress {
                bridge_emit(inbound.events, "tick-profile-progress", progress);
            }
            (snapshot, request)
        }
        TickPageResult::Streamed(compact, request) => {
            if let Some(progress) = progress {
                bridge_emit(inbound.events, "tick-profile-progress", progress);
            }
            let (elapsed_ms, pages) = {
                let mut controller = inbound
                    .state
                    .tick_controller
                    .lock()
                    .expect("tick controller mutex poisoned");
                let stats = controller.profile_stats();
                controller.finish();
                stats
            };
            match build_streamed_tick_profile(inbound.state, compact, &request) {
                Ok(result) => {
                    bridge_emit(inbound.events, "tick-profile", result);
                    log_tick_completion(&request, elapsed_ms, pages);
                }
                Err(error) => bridge_emit(
                    inbound.events,
                    "tick-profile-error",
                    TickProfileError {
                        symbol: request.wire.symbol,
                        from_ms: request.wire.from_ms,
                        end_ms: request.wire.to_ms,
                        message: error.to_owned(),
                    },
                ),
            }
            return InboundOutcome::Continue;
        }
        TickPageResult::Limit(
            request,
            limit @ (TickProfileLimit::Pages | TickProfileLimit::DistinctPrices),
        ) => {
            log_info(&safety_net_line(
                &request,
                limit,
                collect_timeframe(inbound.state, &request).as_deref(),
            ));
            // Safety net: the estimate under-called this range's cost. Drop every
            // tick collected (a profile never mixes sources) and approximate the
            // whole range from bars instead of reporting the limit.
            inbound
                .state
                .tick_controller
                .lock()
                .expect("tick controller mutex poisoned")
                .finish();
            start_bar_collect(inbound.events, inbound.state, request);
            return InboundOutcome::Continue;
        }
        TickPageResult::Limit(request, limit) => {
            if let Some(progress) = progress {
                bridge_emit(inbound.events, "tick-profile-progress", progress);
            }
            inbound
                .state
                .tick_controller
                .lock()
                .expect("tick controller mutex poisoned")
                .finish();
            // Never paint the oldest prefix as the profile of a multi-day range.
            bridge_emit(
                inbound.events,
                "tick-profile-error",
                TickProfileError {
                    symbol: request.wire.symbol,
                    from_ms: request.wire.from_ms,
                    end_ms: request.wire.to_ms,
                    message: limit.message(),
                },
            );
            return InboundOutcome::Continue;
        }
        TickPageResult::Error(error) => return InboundOutcome::Teardown(error),
    };
    let result = match build_tick_profile(inbound.state, final_snapshot, &final_request) {
        Ok(result) => result,
        Err(error) => {
            return InboundOutcome::ErrorFrame(ErrorCode::InvalidMessage, error);
        }
    };
    let (elapsed_ms, pages) = {
        let mut controller = inbound
            .state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        let stats = controller.profile_stats();
        controller.finish();
        stats
    };
    bridge_emit(inbound.events, "tick-profile", result);
    log_tick_completion(&final_request, elapsed_ms, pages);
    InboundOutcome::Continue
}

fn log_tick_completion(request: &TickProfileRequest, elapsed_ms: u64, pages: usize) {
    log_info(&completion_line(
        request,
        ProfileSource::Ticks,
        elapsed_ms,
        pages,
        None,
    ));
}

/// A correlated profile bar-page failure is handled like a stale tick page
/// failure: only the awaited request is acted on, under the session gate.
fn profile_bars_error(
    inbound: &Inbound<'_>,
    request_id: String,
    code: ErrorCode,
    message: String,
) -> InboundOutcome {
    let _session_work = match inbound.state.session_work.lock() {
        Ok(guard) => guard,
        Err(_) => return InboundOutcome::Continue,
    };
    if inbound
        .state
        .current_session
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .as_deref()
        != Some(inbound.session_id)
    {
        return InboundOutcome::Continue;
    }
    super::profile_bars::profile_bar_error(inbound, &request_id, code, message)
        .unwrap_or(InboundOutcome::Continue)
}

/// A correlated failure of the chart's older-history page (the EA could not
/// synchronize it in time). It ends only that page request: the slot is
/// cleared so the next page can be asked for, the session and every other
/// stream stay up, and the frontend's own page timeout releases its pending
/// request without surfacing a chart error. A stale id (the page was already
/// answered or replaced) is ignored.
fn history_page_error(inbound: &Inbound<'_>, request_id: &str, code: ErrorCode) -> InboundOutcome {
    let _session_work = match inbound.state.session_work.lock() {
        Ok(guard) => guard,
        Err(_) => return InboundOutcome::Continue,
    };
    if inbound
        .state
        .current_session
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .as_deref()
        != Some(inbound.session_id)
    {
        return InboundOutcome::Continue;
    }
    let mut slot = inbound
        .state
        .expected_history_page
        .lock()
        .expect("history page mutex poisoned");
    if slot.as_ref().is_some_and(|(id, _)| id == request_id) {
        let (_, request) = slot.take().expect("checked above");
        log_warn(&format!(
            "history page {} {} before_ms={:?} failed: {code:?}",
            request.symbol, request.timeframe, request.before_ms
        ));
    }
    InboundOutcome::Continue
}

/// A correlated failure of the chart's window history (the EA could not
/// synchronize the series before its deadline). Only the awaited request is
/// cleared and reported: the session, the execution gates and reconciliation
/// are untouched, and no stale candles are shown. A stale id (the window was
/// answered or replaced meanwhile) is ignored.
///
/// When the failed window was the selection a reconnect reopened, the chart
/// symbol is requested once in its place and the user is told, instead of
/// leaving the chart empty.
fn history_window_error(inbound: &Inbound<'_>, request_id: &str) -> InboundOutcome {
    let fallback = claim_for_session(inbound.state, inbound.session_id, || {
        let mut slot = inbound
            .state
            .expected_history
            .lock()
            .expect("history mutex poisoned");
        if !slot.as_ref().is_some_and(|(id, _)| id == request_id) {
            return None;
        }
        let (_, request) = slot.take().expect("checked above");
        drop(slot);
        log_warn(&format!(
            "history {} {} was not synchronized in time",
            request.symbol, request.timeframe
        ));
        let restore = inbound
            .state
            .chart_selection
            .lock()
            .expect("chart selection mutex poisoned")
            .restore_unavailable(&ChartSelection {
                symbol: request.symbol.clone(),
                timeframe: request.timeframe.clone(),
            });
        if let Some((notice, fallback)) = restore {
            bridge_emit(inbound.events, "selection-fallback", notice);
            return Some(fallback);
        }
        bridge_emit(
            inbound.events,
            "history-unavailable",
            HistoryUnavailableView {
                symbol: request.symbol,
                timeframe: request.timeframe,
            },
        );
        None
    })
    .ok()
    .flatten();
    if let Some(fallback) = fallback {
        // Queues like a user selection; a failure leaves the chart empty, as before.
        let _ = request_history_inner(
            inbound.state,
            fallback.symbol,
            fallback.timeframe,
            initial_history_bars(),
        );
    }
    InboundOutcome::Continue
}

/// A correlated tick-read failure must not discard quotes, portfolio or execution state.
pub(crate) async fn tick_history_error(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let error: ErrorPayload = match serde_json::from_value::<ErrorPayload>(message.payload) {
        Ok(error)
            if matches!(
                error.code,
                ErrorCode::InternalError | ErrorCode::FrameTooLarge
            ) =>
        {
            error
        }
        _ => {
            return InboundOutcome::ErrorFrame(
                ErrorCode::InvalidMessage,
                "invalid tick history error",
            )
        }
    };
    // Recognize only IDs issued for tick pages and profile bar pages. Unrelated
    // protocol errors retain the existing fail-closed handling; stale page
    // failures are ignored.
    if message.id.starts_with("rust-profile-bars-") {
        return profile_bars_error(inbound, message.id, error.code, error.message);
    }
    if message.id.starts_with("rust-history-page-") {
        return history_page_error(inbound, &message.id, error.code);
    }
    // After the page prefix, which this one contains.
    if message.id.starts_with("rust-history-") {
        return history_window_error(inbound, &message.id);
    }
    if !message.id.starts_with("rust-ticks-") {
        return InboundOutcome::ErrorFrame(
            ErrorCode::InvalidMessage,
            "unsupported control message",
        );
    }
    let _session_work = match inbound.state.session_work.lock() {
        Ok(guard) => guard,
        Err(_) => return InboundOutcome::Continue,
    };
    if inbound
        .state
        .current_session
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .as_deref()
        != Some(inbound.session_id)
    {
        return InboundOutcome::Continue;
    }
    let expected = {
        let mut slot = inbound
            .state
            .expected_tick_profile
            .lock()
            .expect("tick profile mutex poisoned");
        if !slot.as_ref().is_some_and(|(_, id, _)| *id == message.id) {
            return InboundOutcome::Continue;
        }
        slot.take().expect("checked above")
    };
    let (generation, _, request) = expected;
    {
        let mut controller = inbound
            .state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        if controller.generation != generation {
            return InboundOutcome::Continue;
        }
        controller.cancel();
        *inbound
            .state
            .pending_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = None;
    }
    bridge_emit(
        inbound.events,
        "tick-profile-error",
        TickProfileError {
            symbol: request.wire.symbol,
            from_ms: request.wire.from_ms,
            end_ms: request.wire.to_ms,
            message: error.message,
        },
    );
    InboundOutcome::Continue
}
