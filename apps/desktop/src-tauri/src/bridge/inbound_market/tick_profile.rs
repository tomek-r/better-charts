use super::super::{
    bridge_emit, build_streamed_tick_profile, build_tick_profile, TickPageResult, TickProfileError,
    TickProfileProgress,
};
use super::{Inbound, InboundOutcome};
use trading_core::protocol::{Envelope, ErrorCode, ErrorPayload, TickHistorySnapshot};

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

fn finish_tick_page(
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
            inbound
                .state
                .tick_controller
                .lock()
                .expect("tick controller mutex poisoned")
                .finish();
            match build_streamed_tick_profile(inbound.state, compact, &request) {
                Ok(result) => bridge_emit(inbound.events, "tick-profile", result),
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
        TickPageResult::Limit(request) => {
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
                    message:
                        "Full profile exceeds page or distinct-price limits; select a shorter range"
                            .to_owned(),
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
    inbound
        .state
        .tick_controller
        .lock()
        .expect("tick controller mutex poisoned")
        .finish();
    bridge_emit(inbound.events, "tick-profile", result);
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
    // Recognize only IDs issued for tick pages. Unrelated protocol errors retain
    // the existing fail-closed handling; stale page failures are ignored.
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
