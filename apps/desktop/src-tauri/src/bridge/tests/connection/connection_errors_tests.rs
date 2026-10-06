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

#[tokio::test]
async fn bridge_listener_recovers_when_an_occupied_port_is_released() {
    let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = occupied.local_addr().unwrap();
    let state = BridgeState::default();
    let recorded = RecordingEvents::new();
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    let bind_state = state.clone();
    let binding = tokio::spawn(async move {
        super::super::super::connection::bind_listener(address, &events, &bind_state).await
    });
    assert!(
        wait_until(Duration::from_secs(1), || {
            state.status.lock().unwrap().state == BridgeConnectionState::ProtocolError
        })
        .await
    );
    assert!(!binding.is_finished(), "bind failure must keep retrying");
    assert!(
        wait_until(Duration::from_secs(2), || {
            recorded
                .events()
                .iter()
                .filter(|(name, payload)| {
                    name == "bridge-status" && payload["state"] == "protocol_error"
                })
                .count()
                >= 2
        })
        .await,
        "a second failed bind must also keep retrying"
    );
    drop(occupied);
    let listener = tokio::time::timeout(Duration::from_secs(3), binding)
        .await
        .expect("bind retry recovers")
        .unwrap();
    assert_eq!(listener.local_addr().unwrap(), address);
    assert_eq!(
        state.status.lock().unwrap().state,
        BridgeConnectionState::Connecting
    );
    let mut client = TcpStream::connect(address).await.unwrap();
    let (mut server, _) = listener.accept().await.unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    client.write_all(b"reconnected").await.unwrap();
    let mut received = [0u8; 11];
    server.read_exact(&mut received).await.unwrap();
    assert_eq!(&received, b"reconnected");
    assert!(recorded
        .events()
        .iter()
        .any(|(name, payload)| { name == "bridge-status" && payload["state"] == "connecting" }));
}
