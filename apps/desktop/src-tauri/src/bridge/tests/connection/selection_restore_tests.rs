//! A reconnect of the same terminal and account reopens the chart selection the
//! previous session was showing, not the EA's chart symbol and the default
//! timeframe. A selection the terminal cannot serve is replaced once, by the
//! chart symbol, and the user is told.
use super::account_switch_tests::start_sequential_bridge;
use super::*;

const WAIT: Duration = Duration::from_secs(2);

async fn bridge_for_sessions(sessions: u64) -> BridgeHarness {
    start_sequential_bridge(
        BridgeState::default(),
        ExecutionAdapterState::new(ExecutionSafetyState::unavailable()),
        sessions,
    )
    .await
}

fn history_snapshot(request_id: &str, symbol: &str, timeframe: &str) -> serde_json::Value {
    serde_json::json!({
        "request_id": request_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "complete": true,
        "candles": [
            {"time_ms": 1, "open": "1.1", "high": "1.2", "low": "1.09", "close": "1.11", "tick_volume": 5, "spread": 2, "real_volume": 0}
        ]
    })
}

/// The next window request the server writes, skipping the other frames it
/// sends after a selection.
async fn next_window_request(client: &mut BridgeClient) -> (String, HistoryRequest) {
    loop {
        let frame = client.recv(WAIT).await.expect("window history request");
        if frame.message_type == MessageType::HistoryRequest {
            let request = serde_json::from_value(frame.payload).expect("history payload");
            return (frame.id, request);
        }
    }
}

/// Plays a session that shows the handshake's own window, then one the user chose.
async fn show_user_selection(
    harness: &BridgeHarness,
    client: &mut BridgeClient,
    symbol: &str,
    timeframe: &str,
) {
    let handshake = complete_handshake(client, harness).await;
    request_history_inner(
        &harness.state,
        symbol.into(),
        timeframe.into(),
        trading_core::protocol::initial_history_bars(),
    )
    .expect("selection queued");
    let (id, request) = next_window_request(client).await;
    assert_eq!(
        (request.symbol.as_str(), request.timeframe.as_str()),
        (symbol, timeframe)
    );
    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-user",
            Some(&handshake.session),
            history_snapshot(&id, symbol, timeframe),
        ))
        .await
        .unwrap();
    let shown = wait_until(WAIT, || {
        harness.state.market.lock().unwrap().symbol.as_deref() == Some(symbol)
    })
    .await;
    assert!(shown, "the user's selection is on screen");
}

/// Closes the EA side and waits until the server ended that session.
async fn drop_connection(harness: &BridgeHarness, client: BridgeClient) {
    drop(client);
    let ended = wait_until(WAIT, || {
        harness.state.current_session.lock().unwrap().is_none()
    })
    .await;
    assert!(ended, "the session ended");
}

fn hello_with(mutate: impl FnOnce(&mut serde_json::Value)) -> Envelope {
    let mut hello = valid_hello(None);
    mutate(&mut hello.payload);
    hello
}

fn selection(request: &HistoryRequest) -> (&str, &str) {
    (request.symbol.as_str(), request.timeframe.as_str())
}

#[tokio::test]
async fn reconnect_of_the_same_account_reopens_the_users_selection() {
    let harness = bridge_for_sessions(2).await;
    let mut first = BridgeClient::connect(harness.addr).await.unwrap();
    show_user_selection(&harness, &mut first, "GBPUSD", "H1").await;
    drop_connection(&harness, first).await;

    let mut second = BridgeClient::connect(harness.addr).await.unwrap();
    let reopened = complete_handshake(&mut second, &harness).await;
    assert_eq!(selection(&reopened.history), ("GBPUSD", "H1"));
    assert!(!harness.events.has_event("selection-fallback"));
}

#[tokio::test]
async fn reconnect_of_another_account_starts_from_the_chart_symbol() {
    let harness = bridge_for_sessions(2).await;
    let mut first = BridgeClient::connect(harness.addr).await.unwrap();
    show_user_selection(&harness, &mut first, "GBPUSD", "H1").await;
    drop_connection(&harness, first).await;

    let mut second = BridgeClient::connect(harness.addr).await.unwrap();
    let hello = hello_with(|payload| payload["account_login"] = serde_json::json!("009999"));
    let fresh = complete_handshake_with_hello(&mut second, hello).await;
    assert_eq!(
        selection(&fresh.history),
        ("EURUSD", trading_core::protocol::default_timeframe())
    );
}

#[tokio::test]
async fn timeframe_the_terminal_no_longer_supports_is_not_reopened() {
    let harness = bridge_for_sessions(2).await;
    let mut first = BridgeClient::connect(harness.addr).await.unwrap();
    show_user_selection(&harness, &mut first, "GBPUSD", "H1").await;
    drop_connection(&harness, first).await;

    let mut second = BridgeClient::connect(harness.addr).await.unwrap();
    let hello = hello_with(|payload| payload["supported_timeframes"] = serde_json::json!(["M1"]));
    let fresh = complete_handshake_with_hello(&mut second, hello).await;
    assert_eq!(selection(&fresh.history), ("EURUSD", "M1"));
}

/// The restored window fails with `message` under its own request id; the
/// session stays up and asks for the chart symbol once, telling the user.
async fn assert_falls_back_in_session_after(message: &str) {
    let harness = bridge_for_sessions(2).await;
    let mut first = BridgeClient::connect(harness.addr).await.unwrap();
    show_user_selection(&harness, &mut first, "GBPUSD", "H1").await;
    drop_connection(&harness, first).await;

    let mut second = BridgeClient::connect(harness.addr).await.unwrap();
    let reopened = complete_handshake(&mut second, &harness).await;
    assert_eq!(selection(&reopened.history), ("GBPUSD", "H1"));
    second
        .send(BridgeClient::envelope(
            MessageType::Error,
            &reopened.history_id,
            Some(&reopened.session),
            serde_json::json!({
                "code": "INTERNAL_ERROR",
                "message": message,
                "retryable": false
            }),
        ))
        .await
        .unwrap();

    let (_, fallback) = next_window_request(&mut second).await;
    assert_eq!(selection(&fallback), ("EURUSD", "M1"));
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(reopened.session.as_str()),
        "the session is not torn down"
    );
    let notice = harness
        .events
        .events()
        .into_iter()
        .find(|(event, _)| event == "selection-fallback")
        .expect("the user is told")
        .1;
    assert_eq!(
        notice,
        serde_json::json!({"symbol": "GBPUSD", "timeframe": "H1", "shownSymbol": "EURUSD"})
    );
    assert!(!harness.events.has_event("history-unavailable"));
}

#[tokio::test]
async fn unsynchronized_restored_series_falls_back_to_the_chart_symbol_once() {
    assert_falls_back_in_session_after("history synchronization timed out").await;
}

#[tokio::test]
async fn unavailable_restored_symbol_falls_back_to_the_chart_symbol_without_a_teardown() {
    assert_falls_back_in_session_after("symbol not available").await;
}

#[tokio::test]
async fn rejected_restored_symbol_is_not_asked_for_again_after_the_session_ends() {
    let harness = bridge_for_sessions(3).await;
    let mut first = BridgeClient::connect(harness.addr).await.unwrap();
    show_user_selection(&harness, &mut first, "GBPUSD", "H1").await;
    drop_connection(&harness, first).await;

    let mut second = BridgeClient::connect(harness.addr).await.unwrap();
    let reopened = complete_handshake(&mut second, &harness).await;
    assert_eq!(selection(&reopened.history), ("GBPUSD", "H1"));
    // The EA answers an unknown symbol with an error that carries no request id.
    second
        .send(BridgeClient::envelope(
            MessageType::Error,
            "ea-1",
            Some(&reopened.session),
            serde_json::json!({
                "code": "INVALID_MESSAGE",
                "message": "unsupported history request",
                "retryable": false
            }),
        ))
        .await
        .unwrap();
    let ended = wait_until(WAIT, || {
        harness.state.current_session.lock().unwrap().is_none()
    })
    .await;
    assert!(ended, "the rejected request ends the session");

    let mut third = BridgeClient::connect(harness.addr).await.unwrap();
    let fresh = complete_handshake(&mut third, &harness).await;
    assert_eq!(selection(&fresh.history), ("EURUSD", "M1"));
    assert!(wait_until(WAIT, || harness.events.has_event("selection-fallback")).await);
}

#[tokio::test]
async fn plain_drop_before_the_restored_window_keeps_asking_for_the_users_selection() {
    let harness = bridge_for_sessions(3).await;
    let mut first = BridgeClient::connect(harness.addr).await.unwrap();
    show_user_selection(&harness, &mut first, "GBPUSD", "H1").await;
    drop_connection(&harness, first).await;

    let mut second = BridgeClient::connect(harness.addr).await.unwrap();
    complete_handshake(&mut second, &harness).await;
    drop_connection(&harness, second).await;

    let mut third = BridgeClient::connect(harness.addr).await.unwrap();
    let reopened = complete_handshake(&mut third, &harness).await;
    assert_eq!(selection(&reopened.history), ("GBPUSD", "H1"));
    assert!(!harness.events.has_event("selection-fallback"));
}
