//! The desktop indicator series route end to end: the page it writes, the
//! `indicator-series` event it publishes, the latest request per key, the
//! correlated error and the symbol guard.
use super::*;

const WAIT: Duration = Duration::from_secs(2);

/// One valid candle as the EA writes it, offset so pages are distinguishable.
fn series_candle_json(time_ms: i64) -> serde_json::Value {
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
/// with `EURUSD` candles in place — the chart the series reads must not disturb.
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
                "candles": [series_candle_json(1_000), series_candle_json(2_000)],
            }),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(WAIT, || harness
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

/// The payload of the first `event` the server emitted.
fn emitted(harness: &BridgeHarness, event: &str) -> serde_json::Value {
    harness
        .events
        .events()
        .into_iter()
        .find(|(name, _)| name == event)
        .map(|(_, payload)| payload)
        .expect("event emitted")
}

/// Every `indicator-series` payload emitted so far, in emission order.
fn series_events(harness: &BridgeHarness) -> Vec<serde_json::Value> {
    harness
        .events
        .events()
        .into_iter()
        .filter(|(event, _)| event == "indicator-series")
        .map(|(_, payload)| payload)
        .collect()
}

/// Queues one series read through the command and reads the page it wrote.
async fn write_series_page(
    harness: &BridgeHarness,
    client: &mut BridgeClient,
    key: &str,
    timeframe: &str,
    before_ms: Option<i64>,
) -> (String, HistoryRequest) {
    request_indicator_series_inner(
        &harness.state,
        key.to_owned(),
        "EURUSD".into(),
        timeframe.to_owned(),
        200,
        before_ms,
    )
    .expect("series queued");
    let page = client.recv(WAIT).await.expect("series page on the wire");
    assert_eq!(page.message_type, MessageType::HistoryRequest);
    assert!(page.id.starts_with("rust-series-"));
    let request: HistoryRequest = serde_json::from_value(page.payload).expect("page payload");
    (page.id, request)
}

/// Answers a series page the way the EA does.
async fn send_series_snapshot(
    client: &mut BridgeClient,
    session: &str,
    request_id: &str,
    request: &HistoryRequest,
    candles: Vec<serde_json::Value>,
) {
    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-series",
            Some(session),
            serde_json::json!({
                "request_id": request_id,
                "symbol": request.symbol,
                "timeframe": request.timeframe,
                "complete": true,
                "before_ms": request.before_ms,
                "candles": candles,
            }),
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn series_page_is_written_with_its_anchor_and_published_on_its_own_event() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;

    let (request_id, request) =
        write_series_page(&harness, &mut client, "macd-h1", "H1", Some(1_000)).await;
    assert_eq!(request.symbol, "EURUSD");
    assert_eq!(request.timeframe, "H1");
    assert_eq!(request.bars, 200);
    assert_eq!(request.before_ms, Some(1_000));
    assert!(request.is_page(), "the EA must serve it as a page");

    send_series_snapshot(
        &mut client,
        &session,
        &request_id,
        &request,
        vec![series_candle_json(500), series_candle_json(900)],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-series")).await,
        "the series must be published"
    );
    let series = emitted(&harness, "indicator-series");
    assert_eq!(series["key"], "macd-h1");
    assert_eq!(series["symbol"], "EURUSD");
    assert_eq!(series["timeframe"], "H1");
    assert_eq!(series["complete"], true);
    assert_eq!(series["beforeMs"], 1_000);
    assert_eq!(
        series["candles"].as_array().expect("candles array").len(),
        2
    );
    // A series read is not a chart page and not a market snapshot: the chart's
    // own candles and the order ticket's series stay untouched.
    assert!(!harness.events.has_event("history-page"));
    let market = harness.state.market.lock().unwrap();
    assert_eq!(market.candles.len(), 2);
    assert_eq!(market.candles[1].time_ms, 2_000);
    drop(market);
    assert!(harness
        .state
        .indicator_series
        .lock()
        .unwrap()
        .take_awaited(&request_id)
        .is_none());
}

#[tokio::test]
async fn newest_bars_are_asked_for_past_the_wall_clock_and_echo_a_null_anchor() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;

    let (request_id, request) =
        write_series_page(&harness, &mut client, "rsi-m15", "M15", None).await;
    assert!(
        request.before_ms.is_some_and(|anchor| anchor > now_ms()),
        "the newest bars need an anchor past the wall clock"
    );

    send_series_snapshot(
        &mut client,
        &session,
        &request_id,
        &request,
        vec![series_candle_json(2_000)],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-series")).await,
        "the newest series must be published"
    );
    assert_eq!(
        emitted(&harness, "indicator-series")["beforeMs"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn two_keys_in_flight_each_answer_under_their_own_key() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;

    let first = write_series_page(&harness, &mut client, "ema-h4", "H4", Some(1_000)).await;
    let second = write_series_page(&harness, &mut client, "rsi-d1", "D1", Some(1_000)).await;
    assert_ne!(first.0, second.0, "one id per request");

    send_series_snapshot(
        &mut client,
        &session,
        &second.0,
        &second.1,
        vec![series_candle_json(500)],
    )
    .await;
    send_series_snapshot(
        &mut client,
        &session,
        &first.0,
        &first.1,
        vec![series_candle_json(400), series_candle_json(800)],
    )
    .await;

    assert!(
        wait_until(WAIT, || series_events(&harness).len() == 2).await,
        "both series must be published"
    );
    let series = series_events(&harness);
    assert_eq!(series[0]["key"], "rsi-d1");
    assert_eq!(series[1]["key"], "ema-h4");
    assert_eq!(series[1]["timeframe"], "H4");
}

#[tokio::test]
async fn a_second_request_for_one_key_drops_the_first_response() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;

    let (replaced_id, replaced) =
        write_series_page(&harness, &mut client, "ema-h4", "H4", Some(2_000)).await;
    let (current_id, current) =
        write_series_page(&harness, &mut client, "ema-h4", "H4", Some(1_000)).await;

    send_series_snapshot(
        &mut client,
        &session,
        &replaced_id,
        &replaced,
        vec![series_candle_json(1_500)],
    )
    .await;
    send_series_snapshot(
        &mut client,
        &session,
        &current_id,
        &current,
        vec![series_candle_json(500)],
    )
    .await;

    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-series")).await,
        "the newest request must be published"
    );
    let published = series_events(&harness);
    assert_eq!(published.len(), 1, "the replaced response is ignored");
    assert_eq!(published[0]["beforeMs"], 1_000);
    assert_eq!(
        published[0]["candles"][0]["time_ms"], 500,
        "the newest request's candles are the ones published"
    );
}

#[tokio::test]
async fn correlated_series_error_reports_unavailable_and_keeps_the_session() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;
    let (request_id, _) =
        write_series_page(&harness, &mut client, "macd-h1", "H1", Some(1_000)).await;

    client
        .send(BridgeClient::envelope(
            MessageType::Error,
            &request_id,
            Some(&session),
            serde_json::json!({
                "code": "INTERNAL_ERROR",
                "message": "history page synchronization timed out",
                "retryable": false
            }),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(WAIT, || harness
            .events
            .has_event("indicator-series-unavailable"))
        .await,
        "the failed series must be reported"
    );
    let unavailable = emitted(&harness, "indicator-series-unavailable");
    assert_eq!(unavailable["key"], "macd-h1");
    assert_eq!(unavailable["symbol"], "EURUSD");
    assert_eq!(unavailable["timeframe"], "H1");
    assert_eq!(
        unavailable["message"],
        "history page synchronization timed out"
    );
    assert!(!harness.events.has_event("indicator-series"));

    // The session, its reconciliation request and the chart's slots are intact.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-series",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client.recv(WAIT).await.expect("session still open");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(session.as_str())
    );
    assert!(harness
        .state
        .indicator_series
        .lock()
        .unwrap()
        .take_awaited(&request_id)
        .is_none());
}

#[tokio::test]
async fn series_request_for_another_symbol_is_refused() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    bridge_with_window_history(&mut client, &harness).await;

    assert_eq!(
        request_indicator_series_inner(
            &harness.state,
            "macd-h1".into(),
            "GBPUSD".into(),
            "H1".into(),
            200,
            None,
        ),
        Err("symbol is not the chart's symbol".to_owned())
    );
    assert!(harness
        .state
        .indicator_series
        .lock()
        .unwrap()
        .claim_waiting(&harness.state.next_request_id)
        .is_empty());
}

#[tokio::test]
async fn symbol_change_drops_the_series_in_flight() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = bridge_with_window_history(&mut client, &harness).await;
    let (request_id, request) =
        write_series_page(&harness, &mut client, "macd-h1", "H1", Some(1_000)).await;

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
    send_series_snapshot(
        &mut client,
        &session,
        &request_id,
        &request,
        vec![series_candle_json(500)],
    )
    .await;
    // The connection is in-order: a heartbeat ack that follows proves the series
    // snapshot was already dispatched (and ignored) when nothing was published.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-series",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client.recv(WAIT).await.expect("still connected");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert!(
        !harness.events.has_event("indicator-series"),
        "a series for the previous symbol must not be published"
    );
}
