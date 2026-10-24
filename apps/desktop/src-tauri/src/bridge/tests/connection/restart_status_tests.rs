//! Status a successful MT5 restart leaves behind.
//!
//! A refusal belongs to the terminal that presented it. Once the restart closed
//! that terminal and launched the freshly installed EA, the refusal is stale, so
//! the bridge has to wait again instead of keeping `tokenMismatch` /
//! `componentOutdated` on screen until the new session answers.
use super::*;
use crate::bridge::accept::RESTARTED_TERMINAL_WAITING;

/// A status the stopped terminal left behind. `refusal` names the flag it carried.
fn status_after(refusal: &str) -> BridgeStatus {
    match refusal {
        "token" => BridgeStatus {
            state: BridgeConnectionState::ProtocolError,
            message: Some("EA presented a different bridge token".into()),
            token_mismatch: true,
            ..BridgeStatus::default()
        },
        "outdated" => BridgeStatus {
            state: BridgeConnectionState::ProtocolError,
            message: Some("EA 1.010 is outdated; reinstall it".into()),
            component_outdated: true,
            ..BridgeStatus::default()
        },
        _ => BridgeStatus {
            state: BridgeConnectionState::Disconnected,
            ..BridgeStatus::default()
        },
    }
}

#[test]
fn a_restart_clears_the_refusal_of_the_terminal_it_stopped() {
    for refusal in ["token", "outdated", "disconnected"] {
        let state = BridgeState::default();
        *state.status.lock().unwrap() = status_after(refusal);
        let recorded = RecordingEvents::new();
        let events: Arc<dyn BridgeEvents> = recorded.clone();

        expect_restarted_terminal(&events, &state);

        let status = state.status.lock().unwrap().clone();
        assert_eq!(
            status.state,
            BridgeConnectionState::Connecting,
            "the {refusal} status waits again"
        );
        assert!(
            !status.token_mismatch,
            "the {refusal} status clears the token mismatch flag"
        );
        assert!(
            !status.component_outdated,
            "the {refusal} status clears the outdated flag"
        );
        assert_eq!(status.message.as_deref(), Some(RESTARTED_TERMINAL_WAITING));

        let emitted = recorded.events();
        assert_eq!(
            emitted.len(),
            1,
            "one bridge-status event for the {refusal} status: {emitted:?}"
        );
        assert_eq!(emitted[0].0, "bridge-status");
        assert_eq!(emitted[0].1["state"], "connecting");
        assert_eq!(emitted[0].1["tokenMismatch"], false);
        assert_eq!(emitted[0].1["componentOutdated"], false);
        assert_eq!(emitted[0].1["message"], RESTARTED_TERMINAL_WAITING);
    }
}

#[test]
fn a_connected_bridge_is_left_to_the_disconnect_path() {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-old".into());
    *state.status.lock().unwrap() = BridgeStatus {
        state: BridgeConnectionState::Connected,
        account: Some("001234".into()),
        ..BridgeStatus::default()
    };
    let recorded = RecordingEvents::new();
    let events: Arc<dyn BridgeEvents> = recorded.clone();

    expect_restarted_terminal(&events, &state);

    let status = state.status.lock().unwrap().clone();
    assert_eq!(status.state, BridgeConnectionState::Connected);
    assert!(
        status.message.is_none(),
        "the live session keeps its status untouched"
    );
    assert_eq!(
        state.current_session.lock().unwrap().as_deref(),
        Some("session-old"),
        "the live session is untouched"
    );
    assert!(
        recorded.events().is_empty(),
        "a connected bridge publishes nothing"
    );
}

#[test]
fn a_refusal_from_the_restarted_terminal_is_reported_normally() {
    let state = BridgeState::default();
    *state.status.lock().unwrap() = status_after("token");
    let recorded = RecordingEvents::new();
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    expect_restarted_terminal(&events, &state);
    let waited = recorded.events().len();

    // The new terminal presents a token this app does not expect.
    protocol_error_token_mismatch(&events, &state, "EA presented a different bridge token");

    let status = state.status.lock().unwrap().clone();
    assert_eq!(status.state, BridgeConnectionState::ProtocolError);
    assert!(status.token_mismatch, "the new refusal sets the flag");
    assert!(!status.component_outdated);
    assert_eq!(
        status.message.as_deref(),
        Some("EA presented a different bridge token")
    );
    let emitted = recorded.events();
    assert!(
        emitted.len() > waited,
        "the refusal of the restarted terminal is published: {emitted:?}"
    );
    assert!(emitted.iter().any(|(event, payload)| {
        event == "bridge-status" && payload["state"] == "protocol_error"
    }));
}
