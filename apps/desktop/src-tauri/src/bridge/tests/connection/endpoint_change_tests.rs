use super::*;
use crate::bridge::connection::serve_endpoints;
use crate::bridge::endpoint::{BridgeEndpoint, BridgeEndpointControl};

const ROTATED_TOKEN: &str = "rotated-token";

/// A loopback address nothing listens on right now.
fn free_loopback_address() -> String {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind loopback listener")
        .local_addr()
        .expect("listener address")
        .to_string()
}

fn endpoint(address: &str, token: &str) -> BridgeEndpoint {
    BridgeEndpoint {
        address: address.to_owned(),
        token: token.to_owned(),
        max_frame_bytes: trading_core::protocol::default_frame_bytes(),
    }
}

/// How many times the server has bound a listener: each bind reports `connecting`.
fn listeners_bound(events: &RecordingEvents) -> usize {
    events
        .events()
        .iter()
        .filter(|(name, payload)| name == "bridge-status" && payload["state"] == "connecting")
        .count()
}

/// Runs the endpoint-following server task the way `run_server` does.
fn spawn_server(
    control: &BridgeEndpointControl,
    state: &BridgeState,
    adapter: &ExecutionAdapterState,
) -> Arc<RecordingEvents> {
    let recorded = RecordingEvents::new();
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    tokio::spawn(serve_endpoints(
        events,
        state.clone(),
        adapter.clone(),
        control.subscribe(),
    ));
    recorded
}

#[tokio::test]
async fn a_new_endpoint_ends_the_session_drops_queued_commands_and_serves_the_new_token() {
    let journal = test_journal_path();
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::open(&journal));
    let state = BridgeState::with_symbol_cache_path(None);
    let address = free_loopback_address();
    let control = BridgeEndpointControl::new(endpoint(&address, TEST_TOKEN));
    let recorded = spawn_server(&control, &state, &adapter);
    assert!(wait_until(Duration::from_secs(2), || listeners_bound(&recorded) == 1).await);
    let socket: SocketAddr = address.parse().unwrap();
    let mut client = BridgeClient::connect(socket).await.unwrap();
    let old = complete_handshake_with_hello(&mut client, valid_hello(None)).await;
    adapter
        .enqueue_for_session(
            &old.session,
            PendingCommand {
                command_id: "cmd-queued".into(),
                message_type: MessageType::OrderSubmitRequest,
                payload: serde_json::json!({ "command_id": "cmd-queued" }),
            },
            Some(place_order_intent("cmd-queued")),
            1,
        )
        .expect("queue a command behind the closed reconciliation gate");

    control.replace(endpoint(&address, ROTATED_TOKEN));

    assert!(
        wait_until(Duration::from_secs(2), || state
            .current_session
            .lock()
            .unwrap()
            .is_none())
        .await,
        "the endpoint change must end the session"
    );
    let view = adapter.queue_status();
    assert_eq!(view.pending, 0);
    assert_eq!(view.stranded, 1);
    assert!(
        client.recv(Duration::from_secs(2)).await.is_none(),
        "the old connection is closed"
    );
    assert!(
        wait_until(Duration::from_secs(5), || listeners_bound(&recorded) == 2).await,
        "the listener is bound again on the new endpoint"
    );
    let mut previous_token = BridgeClient::connect(socket).await.unwrap();
    previous_token.send(valid_hello(None)).await.unwrap();
    let refusal = previous_token.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(refusal.message_type, MessageType::Error);
    let mut fresh = BridgeClient::connect(socket).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["token"] = ROTATED_TOKEN.into();
    let reconnected = complete_handshake_with_hello(&mut fresh, hello).await;
    assert_ne!(reconnected.session, old.session);
    cleanup_journal(&journal);
}

#[tokio::test]
async fn an_invalid_address_waits_for_a_valid_endpoint_instead_of_stopping_the_server() {
    let state = BridgeState::with_symbol_cache_path(None);
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::unavailable());
    let control = BridgeEndpointControl::new(endpoint("not-an-address", TEST_TOKEN));
    let recorded = spawn_server(&control, &state, &adapter);
    assert!(
        wait_until(Duration::from_secs(2), || {
            state.status.lock().unwrap().state == BridgeConnectionState::ProtocolError
        })
        .await
    );

    let address = free_loopback_address();
    control.replace(endpoint(&address, TEST_TOKEN));

    assert!(wait_until(Duration::from_secs(5), || listeners_bound(&recorded) == 1).await);
    let mut client = BridgeClient::connect(address.parse().unwrap())
        .await
        .unwrap();
    complete_handshake_with_hello(&mut client, valid_hello(None)).await;
}

#[tokio::test]
async fn the_endpoint_frame_limit_is_the_one_the_handshake_negotiates() {
    let state = BridgeState::with_symbol_cache_path(None);
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::unavailable());
    let address = free_loopback_address();
    let two_mebibytes = 2 * 1024 * 1024;
    let control = BridgeEndpointControl::new(BridgeEndpoint {
        max_frame_bytes: two_mebibytes,
        ..endpoint(&address, TEST_TOKEN)
    });
    let recorded = spawn_server(&control, &state, &adapter);
    assert!(wait_until(Duration::from_secs(2), || listeners_bound(&recorded) == 1).await);
    let mut client = BridgeClient::connect(address.parse().unwrap())
        .await
        .unwrap();
    let mut hello = valid_hello(None);
    hello.payload["transfer_limits"] =
        serde_json::to_value(trading_core::protocol::TransferLimits::measured_default()).unwrap();

    let handshake = complete_handshake_with_hello(&mut client, hello).await;

    assert_eq!(handshake.transfer_limits.max_frame_bytes, two_mebibytes);
}
