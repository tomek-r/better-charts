//! The desktop indicator ticks route end to end: the raw page it writes, the
//! `indicator-ticks` event it publishes, its own answer next to a tick profile
//! page, the latest request per key, the correlated error and the symbol guard.
use super::*;
use trading_core::volume_profile::RowLayout;

const WAIT: Duration = Duration::from_secs(2);

/// One tick as the EA writes it, with distinguishable quotes.
fn tick_json(time_ms: i64, bid: &str, ask: &str) -> serde_json::Value {
    serde_json::json!({
        "time_ms": time_ms,
        "bid": bid,
        "ask": ask,
        "last": "0",
        "volume": 0,
        "volume_real": "0",
        "flags": 6
    })
}

/// Shows `symbol` on the chart the way a window snapshot does, without paging
/// candles this route never reads.
fn show_chart_symbol(harness: &BridgeHarness, symbol: &str) {
    *harness.state.market.lock().unwrap() = MarketSnapshot {
        symbol: Some(symbol.into()),
        timeframe: Some("M1".into()),
        complete: true,
        candles: Vec::new(),
    };
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

/// Every `indicator-ticks` payload emitted so far, in emission order.
fn ticks_events(harness: &BridgeHarness) -> Vec<serde_json::Value> {
    harness
        .events
        .events()
        .into_iter()
        .filter(|(event, _)| event == "indicator-ticks")
        .map(|(_, payload)| payload)
        .collect()
}

/// Queues one ticks read through the command and reads the page it wrote.
async fn write_ticks_page(
    harness: &BridgeHarness,
    client: &mut BridgeClient,
    key: &str,
    from_ms: i64,
    to_ms: i64,
    max_ticks: u32,
) -> (String, TickHistoryRequest) {
    request_indicator_ticks_inner(
        &harness.state,
        key.to_owned(),
        "EURUSD".into(),
        from_ms,
        to_ms,
        max_ticks,
    )
    .expect("ticks queued");
    let page = client.recv(WAIT).await.expect("ticks page on the wire");
    assert_eq!(page.message_type, MessageType::TickHistoryRequest);
    assert!(page.id.starts_with("rust-indicator-ticks-"));
    assert!(
        page.payload.get("price_counts").is_none(),
        "the route never asks for price counts"
    );
    let request: TickHistoryRequest = serde_json::from_value(page.payload).expect("page payload");
    (page.id, request)
}

/// Answers a ticks page the way the EA does.
async fn send_ticks_snapshot(
    client: &mut BridgeClient,
    session: &str,
    request_id: &str,
    request: &TickHistoryRequest,
    complete: bool,
    ticks: Vec<serde_json::Value>,
) {
    client
        .send(BridgeClient::envelope(
            MessageType::TickHistorySnapshot,
            "snap-ticks",
            Some(session),
            serde_json::json!({
                "request_id": request_id,
                "symbol": request.symbol,
                "from_ms": request.from_ms,
                "to_ms": request.to_ms,
                "tick_size": "0.1",
                "complete": complete,
                "ticks": ticks,
            }),
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn ticks_page_is_written_with_its_range_and_published_on_its_own_event() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");

    let (request_id, request) =
        write_ticks_page(&harness, &mut client, "volume-100", 1_000, 2_000, 500).await;
    assert_eq!(request.symbol, "EURUSD");
    assert_eq!(request.from_ms, 1_000);
    assert_eq!(request.to_ms, 2_000);
    assert_eq!(request.max_ticks, 500);

    send_ticks_snapshot(
        &mut client,
        &session,
        &request_id,
        &request,
        true,
        vec![
            tick_json(1_100, "25000.1", "25000.3"),
            tick_json(1_900, "25000.4", "25000.6"),
        ],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-ticks")).await,
        "the ticks must be published"
    );
    let page = emitted(&harness, "indicator-ticks");
    assert_eq!(page["key"], "volume-100");
    assert_eq!(page["symbol"], "EURUSD");
    assert_eq!(page["fromMs"], 1_000);
    assert_eq!(page["toMs"], 2_000);
    assert_eq!(page["complete"], true);
    assert_eq!(
        page["ticks"].as_array().expect("ticks array").len(),
        2,
        "every tick of the page is published"
    );
    // Prices stay the decimal strings the wire carries.
    assert_eq!(page["ticks"][0]["timeMs"], 1_100);
    assert_eq!(page["ticks"][0]["bid"], "25000.1");
    assert_eq!(page["ticks"][0]["ask"], "25000.3");
    assert_eq!(page["ticks"][0]["last"], "0");
    assert_eq!(page["ticks"][0]["volume"], 0);
    assert!(page["ticks"][0].get("volumeReal").is_none());
    assert!(page["ticks"][0].get("flags").is_none());

    // A ticks read is neither a profile page nor a profile event.
    assert!(!harness.events.has_event("tick-profile"));
    assert!(!harness.events.has_event("tick-profile-progress"));
    let state = &harness.state;
    assert!(state.pending_tick_profile.lock().unwrap().is_none());
    assert!(state.expected_tick_profile.lock().unwrap().is_none());
    assert!(state.tick_controller.lock().unwrap().active.is_none());
    assert!(ticks_slots(state).take_awaited(&request_id).is_none());
}

#[tokio::test]
async fn a_tick_profile_page_waits_while_an_indicator_ticks_page_is_awaited() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");

    let (ticks_id, ticks_request) =
        write_ticks_page(&harness, &mut client, "volume-100", 1_000, 2_000, 500).await;

    // The profile asks for its own page while the ticks page awaits its answer: the EA serves one tick
    // request at a time, so the profile's page stays pending instead of cancelling the ticks read.
    request_tick_profile_inner(
        &harness.state,
        "EURUSD".into(),
        100,
        1_000,
        RowLayout::default(),
        70,
    )
    .expect("profile queued");
    assert!(
        client.recv(WAIT).await.is_none(),
        "no profile page may go out while the ticks page is awaited"
    );
    assert!(harness.state.pending_tick_profile.lock().unwrap().is_some());

    send_ticks_snapshot(
        &mut client,
        &session,
        &ticks_id,
        &ticks_request,
        true,
        vec![tick_json(1_500, "25000.1", "25000.3")],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-ticks")).await,
        "the ticks page must be published"
    );

    let profile_page = client
        .recv(WAIT)
        .await
        .expect("the profile page follows the ticks answer");
    assert_eq!(profile_page.message_type, MessageType::TickHistoryRequest);
    assert!(profile_page.id.starts_with("rust-ticks-"));
    let profile_request: TickHistoryRequest =
        serde_json::from_value(profile_page.payload).expect("profile payload");
    assert_eq!(profile_request.from_ms, 100);
    assert_eq!(profile_request.to_ms, 1_000);

    send_ticks_snapshot(
        &mut client,
        &session,
        &profile_page.id,
        &profile_request,
        true,
        vec![tick_json(500, "25001.0", "25001.2")],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("tick-profile")).await,
        "the profile page must still be published"
    );
    let ticks = emitted(&harness, "indicator-ticks");
    assert_eq!(ticks["key"], "volume-100");
    assert_eq!(ticks["ticks"][0]["bid"], "25000.1");
    let profile = emitted(&harness, "tick-profile");
    assert_eq!(profile["fromMs"], 100);
    assert_eq!(profile["endMs"], 1_000);
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(session.as_str())
    );
}

#[tokio::test]
async fn indicator_ticks_wait_while_a_tick_profile_page_is_awaited() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");

    // The tick profile's own page owns the EA's one tick slot first.
    request_tick_profile_inner(
        &harness.state,
        "EURUSD".into(),
        100,
        1_000,
        RowLayout::default(),
        70,
    )
    .expect("profile queued");
    let profile_page = client.recv(WAIT).await.expect("profile page on the wire");
    assert_eq!(profile_page.message_type, MessageType::TickHistoryRequest);
    assert!(profile_page.id.starts_with("rust-ticks-"));
    let profile_request: TickHistoryRequest =
        serde_json::from_value(profile_page.payload).expect("profile payload");

    request_indicator_ticks_inner(
        &harness.state,
        "volume-100".into(),
        "EURUSD".into(),
        1_000,
        2_000,
        500,
    )
    .expect("ticks queued");
    assert!(
        client.recv(WAIT).await.is_none(),
        "no ticks page may go out while the profile page is awaited"
    );
    assert!(!ticks_slots(&harness.state).is_awaited());

    send_ticks_snapshot(
        &mut client,
        &session,
        &profile_page.id,
        &profile_request,
        true,
        vec![tick_json(500, "25001.0", "25001.2")],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("tick-profile")).await,
        "the profile page must be published"
    );

    let ticks_page = client
        .recv(WAIT)
        .await
        .expect("the ticks page follows the profile answer");
    assert_eq!(ticks_page.message_type, MessageType::TickHistoryRequest);
    assert!(ticks_page.id.starts_with("rust-indicator-ticks-"));
    let ticks_request: TickHistoryRequest =
        serde_json::from_value(ticks_page.payload).expect("ticks payload");
    send_ticks_snapshot(
        &mut client,
        &session,
        &ticks_page.id,
        &ticks_request,
        true,
        vec![tick_json(1_500, "25000.1", "25000.3")],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-ticks")).await,
        "the queued ticks page must still be published"
    );
    assert_eq!(emitted(&harness, "indicator-ticks")["key"], "volume-100");
}

#[tokio::test]
async fn two_queued_keys_go_out_one_at_a_time_and_answer_under_their_own_key() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");

    // Two callers ask at once; the EA serves one tick request at a time, so only the oldest is written.
    request_indicator_ticks_inner(
        &harness.state,
        "atr-14".into(),
        "EURUSD".into(),
        1_000,
        2_000,
        500,
    )
    .expect("first ticks queued");
    request_indicator_ticks_inner(
        &harness.state,
        "sar-3".into(),
        "EURUSD".into(),
        3_000,
        4_000,
        400,
    )
    .expect("second ticks queued");

    let first = client
        .recv(WAIT)
        .await
        .expect("the oldest page on the wire");
    assert_eq!(first.message_type, MessageType::TickHistoryRequest);
    assert!(first.id.starts_with("rust-indicator-ticks-"));
    let first_request: TickHistoryRequest =
        serde_json::from_value(first.payload).expect("first payload");
    assert_eq!(first_request.from_ms, 1_000);

    assert!(
        client.recv(WAIT).await.is_none(),
        "the second page waits for the first answer"
    );

    send_ticks_snapshot(
        &mut client,
        &session,
        &first.id,
        &first_request,
        true,
        vec![tick_json(1_500, "25000.1", "25000.3")],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-ticks")).await,
        "the first page must be published"
    );

    let second = client
        .recv(WAIT)
        .await
        .expect("the second page follows the first answer");
    assert_eq!(second.message_type, MessageType::TickHistoryRequest);
    assert!(second.id.starts_with("rust-indicator-ticks-"));
    assert_ne!(second.id, first.id, "one id per request");
    let second_request: TickHistoryRequest =
        serde_json::from_value(second.payload).expect("second payload");
    assert_eq!(second_request.from_ms, 3_000);

    send_ticks_snapshot(
        &mut client,
        &session,
        &second.id,
        &second_request,
        false,
        vec![tick_json(3_500, "25002.0", "25002.2")],
    )
    .await;

    assert!(
        wait_until(WAIT, || ticks_events(&harness).len() == 2).await,
        "both pages must be published"
    );
    let pages = ticks_events(&harness);
    assert_eq!(pages[0]["key"], "atr-14");
    assert_eq!(pages[0]["fromMs"], 1_000);
    assert_eq!(pages[1]["key"], "sar-3");
    assert_eq!(pages[1]["complete"], false);
}

#[tokio::test]
async fn a_second_request_for_one_key_drops_the_first_response() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");

    let replaced = write_ticks_page(&harness, &mut client, "volume-100", 1_000, 2_000, 500).await;
    let current = write_ticks_page(&harness, &mut client, "volume-100", 3_000, 4_000, 500).await;

    send_ticks_snapshot(
        &mut client,
        &session,
        &replaced.0,
        &replaced.1,
        true,
        vec![tick_json(1_500, "25000.1", "25000.3")],
    )
    .await;
    send_ticks_snapshot(
        &mut client,
        &session,
        &current.0,
        &current.1,
        true,
        vec![tick_json(3_500, "25002.0", "25002.2")],
    )
    .await;

    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-ticks")).await,
        "the newest request must be published"
    );
    let published = ticks_events(&harness);
    assert_eq!(published.len(), 1, "the replaced response is ignored");
    assert_eq!(published[0]["fromMs"], 3_000);
    assert_eq!(
        published[0]["ticks"][0]["timeMs"], 3_500,
        "the newest request's ticks are the ones published"
    );
}

#[tokio::test]
async fn correlated_ticks_error_reports_unavailable_and_keeps_the_session() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");
    let (request_id, _) =
        write_ticks_page(&harness, &mut client, "volume-100", 1_000, 2_000, 500).await;

    client
        .send(BridgeClient::envelope(
            MessageType::Error,
            &request_id,
            Some(&session),
            serde_json::json!({
                "code": "INTERNAL_ERROR",
                "message": "tick history synchronization timed out",
                "retryable": false
            }),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(WAIT, || harness
            .events
            .has_event("indicator-ticks-unavailable"))
        .await,
        "the failed page must be reported"
    );
    let unavailable = emitted(&harness, "indicator-ticks-unavailable");
    assert_eq!(unavailable["key"], "volume-100");
    assert_eq!(unavailable["symbol"], "EURUSD");
    assert_eq!(
        unavailable["message"],
        "tick history synchronization timed out"
    );
    assert!(!harness.events.has_event("indicator-ticks"));
    assert!(!harness.events.has_event("tick-profile-error"));

    // The session and the tick profile's slots stay as they were.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-ticks",
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
    assert!(ticks_slots(&harness.state)
        .take_awaited(&request_id)
        .is_none());
}

#[tokio::test]
async fn a_stale_ticks_error_is_ignored() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");
    let (request_id, request) =
        write_ticks_page(&harness, &mut client, "volume-100", 1_000, 2_000, 500).await;
    send_ticks_snapshot(
        &mut client,
        &session,
        &request_id,
        &request,
        true,
        vec![tick_json(1_500, "25000.1", "25000.3")],
    )
    .await;
    assert!(
        wait_until(WAIT, || harness.events.has_event("indicator-ticks")).await,
        "the page must be published"
    );

    client
        .send(BridgeClient::envelope(
            MessageType::Error,
            &request_id,
            Some(&session),
            serde_json::json!({
                "code": "INTERNAL_ERROR",
                "message": "late failure",
                "retryable": false
            }),
        ))
        .await
        .unwrap();
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-ticks-stale",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client.recv(WAIT).await.expect("still connected");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert!(!harness.events.has_event("indicator-ticks-unavailable"));
}

#[tokio::test]
async fn ticks_request_for_another_symbol_is_refused() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    complete_handshake(&mut client, &harness).await;
    show_chart_symbol(&harness, "EURUSD");

    assert_eq!(
        request_indicator_ticks_inner(
            &harness.state,
            "volume-100".into(),
            "GBPUSD".into(),
            1_000,
            2_000,
            500,
        ),
        Err("symbol is not the chart's symbol".to_owned())
    );
    assert!(ticks_slots(&harness.state)
        .claim_next(&harness.state.next_request_id, std::time::Instant::now())
        .is_none());
}

#[tokio::test]
async fn symbol_change_drops_the_ticks_in_flight() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let session = complete_handshake(&mut client, &harness).await.session;
    show_chart_symbol(&harness, "EURUSD");
    let (request_id, request) =
        write_ticks_page(&harness, &mut client, "volume-100", 1_000, 2_000, 500).await;

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
    send_ticks_snapshot(
        &mut client,
        &session,
        &request_id,
        &request,
        true,
        vec![tick_json(1_500, "25000.1", "25000.3")],
    )
    .await;
    // The connection is in-order: a heartbeat ack that follows proves the ticks
    // snapshot was already dispatched (and ignored) when nothing was published.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-ticks-symbol",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client.recv(WAIT).await.expect("still connected");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert!(
        !harness.events.has_event("indicator-ticks"),
        "ticks for the previous symbol must not be published"
    );
}
