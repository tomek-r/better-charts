use super::*;

#[test]
fn adapter_error_frame_maps_mismatch_and_journal_errors() {
    // An F-5 account-binding mismatch is the caller's fault: INVALID_MESSAGE.
    let (code, message) = adapter_error_frame(&ExecutionAdapterError::AccountMismatch);
    assert_eq!(code, ErrorCode::InvalidMessage);
    assert_eq!(message, "command account binding mismatch");
    // Every other apply failure is our fault: INTERNAL_ERROR, no details.
    let (code, message) =
        adapter_error_frame(&ExecutionAdapterError::Journal(JournalError::Truncated));
    assert_eq!(code, ErrorCode::InternalError);
    assert_eq!(message, "command journal unavailable");
}

#[test]
fn only_loopback_addresses_are_allowed() {
    assert!(validate_bind_address("127.0.0.1:8765").is_ok());
    assert!(validate_bind_address("[::1]:8765").is_ok());
    assert!(validate_bind_address("0.0.0.0:8765").is_err());
    assert!(validate_bind_address("not-an-address").is_err());
}

#[test]
fn stale_disconnect_cannot_clear_replacement_session() {
    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-new".to_owned());
    state.status.lock().unwrap().state = BridgeConnectionState::Connected;
    let events: Arc<dyn BridgeEvents> = RecordingEvents::new();
    let journal = test_journal_path();
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::open(&journal));
    adapter.session_started_for_session("session-new", true, "001234", "Broker-Demo");

    disconnect(&events, &state, &adapter, "session-old");

    assert_eq!(
        state.current_session.lock().unwrap().as_deref(),
        Some("session-new")
    );
    assert_eq!(
        state.status.lock().unwrap().state,
        BridgeConnectionState::Connected
    );
    cleanup_journal(&journal);
}
