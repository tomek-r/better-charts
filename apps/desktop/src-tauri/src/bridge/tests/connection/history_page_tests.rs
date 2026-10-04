use super::*;

/// One valid candle as the EA writes it, offset so pages are distinguishable.
fn page_candle_json(time_ms: i64) -> serde_json::Value {
    serde_json::json!({
        "time_ms": time_ms,
        "open": "1.1",
        "high": "1.2",
        "low": "1.09",
        "close": "1.11",
        "tick_volume": 5,
        "spread": 2,
        "real_volume": 0
    })
}

/// Completes the handshake and answers the window request, leaving the server
/// with `EURUSD` candles in place — the state a page must not disturb.
async fn bridge_with_window_history(client: &mut BridgeClient, harness: &BridgeHarness) -> String {
    let handshake = complete_handshake(client, harness).await;
    let session = handshake.session.clone();
    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-window",
            Some(&session),
            serde_json::json!({
                "request_id": handshake.history_id,
                "symbol": handshake.history.symbol,
                "timeframe": handshake.history.timeframe,
                "complete": true,
                "candles": [page_candle_json(1_000), page_candle_json(2_000)],
            }),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(Duration::from_secs(2), || harness
            .state
            .market
            .lock()
            .expect("market mutex poisoned")
            .symbol
            .as_deref()
            == Some("EURUSD"))
        .await,
        "window history applied"
    );
    session
}

#[tokio::test]
async fn history_page_response_is_ignored_after_the_symbol_changes() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;

    *harness
        .state
        .pending_history_page
        .lock()
        .expect("history page mutex poisoned") = Some(HistoryRequest {
        symbol: "EURUSD".into(),
        timeframe: "M1".into(),
        bars: 1000,
        before_ms: Some(1_000),
    });
    harness.state.wake_outbound();
    let page_request = client
        .recv(Duration::from_secs(2))
        .await
        .expect("page request on the wire");

    // The user switches ticker while the page is still in flight.
    let events: Arc<dyn BridgeEvents> = harness.events.clone();
    publish_market(
        &events,
        &harness.state,
        &session,
        MarketSnapshot {
            symbol: Some("GBPUSD".into()),
            timeframe: Some("M1".into()),
            complete: true,
            candles: vec![],
        },
    );
    assert!(harness
        .state
        .expected_history_page
        .lock()
        .expect("history page mutex poisoned")
        .is_none());

    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-page",
            Some(&session),
            serde_json::json!({
                "request_id": page_request.id,
                "symbol": "EURUSD",
                "timeframe": "M1",
                "complete": true,
                "before_ms": 1_000,
                "candles": [page_candle_json(-1_000)],
            }),
        ))
        .await
        .unwrap();

    // Prove the server read the frame before asserting it published nothing:
    // the connection is in-order, so a heartbeat ack that follows means the
    // page was already dispatched.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-1",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("still connected");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert!(
        !harness.events.has_event("history-page"),
        "a page for the previous ticker must not be prepended"
    );
}

#[tokio::test]
async fn history_page_is_published_without_replacing_the_market_snapshot() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;

    // Lazy loading asks for bars strictly older than the oldest held candle.
    *harness
        .state
        .pending_history_page
        .lock()
        .expect("history page mutex poisoned") = Some(HistoryRequest {
        symbol: "EURUSD".into(),
        timeframe: "M1".into(),
        bars: 1000,
        before_ms: Some(1_000),
    });
    harness.state.wake_outbound();
    let page_request = client
        .recv(Duration::from_secs(2))
        .await
        .expect("page request on the wire");
    assert_eq!(page_request.message_type, MessageType::HistoryRequest);
    assert!(page_request.id.starts_with("rust-history-page-"));
    let requested: HistoryRequest = serde_json::from_value(page_request.payload).unwrap();
    assert_eq!(requested.before_ms, Some(1_000));
    assert!(requested.is_page());

    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-page",
            Some(&session),
            serde_json::json!({
                "request_id": page_request.id,
                "symbol": "EURUSD",
                "timeframe": "M1",
                "complete": false,
                "before_ms": 1_000,
                "candles": [page_candle_json(-1_000), page_candle_json(0)],
            }),
        ))
        .await
        .unwrap();

    assert!(
        wait_until(Duration::from_secs(2), || harness
            .events
            .has_event("history-page"))
        .await,
        "page published on its own event"
    );
    let (_, page) = harness
        .events
        .events()
        .into_iter()
        .find(|(event, _)| event == "history-page")
        .expect("history-page payload");
    assert_eq!(page["symbol"], "EURUSD");
    assert_eq!(page["beforeMs"], 1_000);
    // `complete: false` is how the frontend learns history is exhausted.
    assert_eq!(page["complete"], false);
    assert_eq!(page["candles"].as_array().expect("candles array").len(), 2);
    // The window's candles and the live-feed anchors are untouched: the order
    // ticket and `bar_update` staleness still see the newest bars.
    let market = harness.state.market.lock().unwrap();
    assert_eq!(market.candles.len(), 2);
    assert_eq!(market.candles[1].time_ms, 2_000);
    assert!(harness
        .state
        .expected_history_page
        .lock()
        .expect("history page mutex poisoned")
        .is_none());
}
