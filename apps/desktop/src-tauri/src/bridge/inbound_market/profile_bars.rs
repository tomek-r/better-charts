//! Bar-history frames that belong to the tick profile (see
//! [`super::super::profile_bars`]): the load estimate and the approximate
//! profile's pages. They are routed by their own request id, so the chart's
//! window and page expectations never see them.

use super::super::{
    bridge_emit, choose_source, completion_line, emit_bar_profile, emit_profile_error,
    log_decision, log_info, log_partial_history, resume_tick_load, retry_line, start_bar_collect,
    BarPageOutcome, BarPhase, Inbound, InboundOutcome, ProfileSource, SourceDecision, SourceReason,
};
use trading_core::protocol::{ErrorCode, HistorySnapshot};

/// Handles `snapshot` when it answers the awaited profile bar request;
/// `None` when it is not one, so the caller keeps routing it. The caller
/// holds the session gate.
pub(super) fn profile_bar_snapshot(
    inbound: &Inbound<'_>,
    snapshot: &HistorySnapshot,
) -> Option<InboundOutcome> {
    let generation = take_expected(inbound, |id| id == snapshot.request_id)?;
    let outcome = inbound
        .state
        .tick_controller
        .lock()
        .expect("tick controller mutex poisoned")
        .ingest_bar_page(generation, snapshot.clone());
    apply(inbound, generation, outcome);
    Some(InboundOutcome::Continue)
}

/// A correlated error for a profile bar request: an estimate failure falls
/// back to ticks, a collection failure ends the profile with the message.
pub(super) fn profile_bar_error(
    inbound: &Inbound<'_>,
    request_id: &str,
    code: ErrorCode,
    message: String,
) -> Option<InboundOutcome> {
    let generation = take_expected(inbound, |id| id == request_id)?;
    let failed = {
        let mut controller = inbound
            .state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        if !controller.bar_request_is_current(generation) {
            return Some(InboundOutcome::Continue);
        }
        let request = controller.bar_job_request()?;
        let phase = controller.bar_job_phase()?;
        controller.finish_bars();
        BarPageOutcome::Failed {
            request,
            phase,
            message,
            error_code: Some(code),
        }
    };
    apply(inbound, generation, failed);
    Some(InboundOutcome::Continue)
}

/// Removes the expected-request slot when `matches` accepts its id.
fn take_expected(inbound: &Inbound<'_>, matches: impl Fn(&str) -> bool) -> Option<u64> {
    let mut slot = inbound
        .state
        .expected_profile_bars
        .lock()
        .expect("profile bars mutex poisoned");
    if !slot.as_ref().is_some_and(|(_, id, _)| matches(id)) {
        return None;
    }
    slot.take().map(|(generation, _, _)| generation)
}

fn apply(inbound: &Inbound<'_>, generation: u64, outcome: BarPageOutcome) {
    let state = inbound.state;
    match outcome {
        BarPageOutcome::Stale => {}
        BarPageOutcome::Next(generation, request, progress) => {
            bridge_emit(inbound.events, "tick-profile-progress", progress);
            *state
                .pending_profile_bars
                .lock()
                .expect("profile bars mutex poisoned") = Some((generation, request));
        }
        BarPageOutcome::Retry {
            profile,
            request,
            progress,
            exhausted_timeframe,
            oldest_ms,
        } => {
            log_info(&retry_line(
                &profile,
                &exhausted_timeframe,
                oldest_ms,
                &request.timeframe,
            ));
            bridge_emit(inbound.events, "tick-profile-progress", progress);
            *state
                .pending_profile_bars
                .lock()
                .expect("profile bars mutex poisoned") = Some((generation, request));
        }
        BarPageOutcome::Estimated {
            request,
            timeframe,
            bars,
            covered,
        } => {
            let decision = choose_source(state, &request, &timeframe, &bars, covered);
            log_decision(state, &request, &decision);
            match decision.source {
                ProfileSource::Ticks => resume_tick_load(state, generation),
                ProfileSource::Bars => start_bar_collect(inbound.events, state, request),
            }
        }
        BarPageOutcome::Collected {
            request,
            timeframe,
            bars,
            pages,
        } => {
            let elapsed_ms = state
                .tick_controller
                .lock()
                .expect("tick controller mutex poisoned")
                .profile_stats()
                .0;
            emit_bar_profile(inbound.events, state, &request, &timeframe, &bars);
            log_info(&completion_line(
                &request,
                ProfileSource::Bars,
                elapsed_ms,
                pages,
                Some(bars.len()),
            ));
            log_partial_history(&request, &timeframe, &bars);
        }
        // The estimate is only advice: without it the exact load runs.
        BarPageOutcome::Failed {
            request,
            phase: BarPhase::Estimate,
            error_code,
            ..
        } => {
            let reason = error_code.map_or(
                SourceReason::EstimatePageInvalid,
                SourceReason::EstimateError,
            );
            log_decision(state, &request, &SourceDecision::ticks(reason));
            resume_tick_load(state, generation);
        }
        BarPageOutcome::Failed {
            request,
            phase: BarPhase::Collect,
            message,
            ..
        } => emit_profile_error(inbound.events, &request, message),
    }
}
