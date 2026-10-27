//! Hybrid profile over the real connection loop: the bridge plays the Rust
//! side, the test plays the EA.
use super::*;
use crate::bridge::inbound_market::finish_tick_page;
use crate::bridge::tests::profile_bars::{
    bar, bar_snapshot, bars_every, profile_request, seed_symbol, RANGE_END, RANGE_FROM,
};
use crate::bridge::{request_tick_profile_inner, MarketCandle};
use trading_core::volume_profile::{RowLayout, DEFAULT_VALUE_AREA_PERCENT};

const MINUTE: i64 = 60_000;
const WAIT: Duration = Duration::from_secs(2);
const QUIET: Duration = Duration::from_millis(300);

struct ProfileConnection {
    harness: BridgeHarness,
    client: BridgeClient,
    session: String,
}

async fn profile_connection() -> ProfileConnection {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    seed_symbol(&harness.state, "EURUSD");
    harness.state.market.lock().unwrap().symbol = Some("EURUSD".into());
    ProfileConnection {
        harness,
        client,
        session: handshake.session,
    }
}

impl ProfileConnection {
    fn start_profile(&self) {
        request_tick_profile_inner(
            &self.harness.state,
            "EURUSD".into(),
            RANGE_FROM,
            RANGE_END,
            RowLayout::default(),
            DEFAULT_VALUE_AREA_PERCENT,
        )
        .map(|_| ())
        .unwrap();
    }

    /// Next profile bar request the bridge writes to the wire.
    async fn recv_bar_request(&mut self) -> (String, HistoryRequest) {
        let frame = self.client.recv(WAIT).await.expect("bar request");
        assert_eq!(frame.message_type, MessageType::HistoryRequest);
        assert!(frame.id.starts_with("rust-profile-bars-"), "{}", frame.id);
        let request = serde_json::from_value(frame.payload).unwrap();
        (frame.id, request)
    }

    async fn send_bars(
        &mut self,
        id: &str,
        timeframe: &str,
        before_ms: i64,
        complete: bool,
        candles: Vec<MarketCandle>,
    ) {
        let snapshot = bar_snapshot(id, timeframe, before_ms, complete, candles);
        let envelope = BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "profile-bars",
            Some(&self.session),
            serde_json::to_value(snapshot).unwrap(),
        );
        self.client.send(envelope).await.unwrap();
    }

    async fn expect_tick_request(&mut self) {
        let frame = self.client.recv(WAIT).await.expect("tick request");
        assert_eq!(frame.message_type, MessageType::TickHistoryRequest);
    }

    async fn expect_silence(&mut self) {
        assert!(self.client.recv(QUIET).await.is_none());
    }

    async fn send_internal_error(&mut self, id: &str) {
        self.client
            .send(BridgeClient::envelope(
                MessageType::Error,
                id,
                Some(&self.session),
                serde_json::json!({"code": "INTERNAL_ERROR", "message": "page not synchronized", "retryable": false}),
            ))
            .await
            .unwrap();
    }

    fn expect_page(&self, id: &str) {
        let request = trading_core::protocol::HistoryRequest {
            symbol: "EURUSD".into(),
            timeframe: "M5".into(),
            bars: 300,
            before_ms: Some(5),
        };
        *self.harness.state.expected_history_page.lock().unwrap() = Some((id.into(), request));
    }

    fn page_is_expected(&self) -> bool {
        self.harness
            .state
            .expected_history_page
            .lock()
            .unwrap()
            .is_some()
    }

    /// The session survived: it is still current and a new profile still queues.
    async fn assert_session_alive(&mut self) {
        assert_eq!(
            self.harness
                .state
                .current_session
                .lock()
                .unwrap()
                .as_deref(),
            Some(self.session.as_str())
        );
        self.start_profile();
        self.recv_bar_request().await;
    }

    fn start_profile_until(&self, end_ms: i64) {
        request_tick_profile_inner(
            &self.harness.state,
            "EURUSD".into(),
            RANGE_FROM,
            end_ms,
            RowLayout::default(),
            DEFAULT_VALUE_AREA_PERCENT,
        )
        .map(|_| ())
        .unwrap();
    }

    fn events_named(&self, name: &str) -> Vec<serde_json::Value> {
        self.harness
            .events
            .events()
            .into_iter()
            .filter(|(event, _)| event == name)
            .map(|(_, payload)| payload)
            .collect()
    }

    fn event(&self, name: &str) -> Option<serde_json::Value> {
        self.harness
            .events
            .events()
            .into_iter()
            .find(|(event, _)| event == name)
            .map(|(_, payload)| payload)
    }
}

fn covering_m2_bars(volume: u64) -> Vec<MarketCandle> {
    bars_every(RANGE_FROM - 2 * MINUTE, 2 * MINUTE, 721, volume)
}

#[tokio::test]
async fn affordable_range_loads_exact_ticks_after_the_estimate() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (id, request) = connection.recv_bar_request().await;
    assert_eq!(request.timeframe, "M2");
    assert_eq!(request.before_ms, Some(RANGE_END));
    connection
        .send_bars(&id, "M2", RANGE_END, true, covering_m2_bars(100))
        .await;
    connection.expect_tick_request().await;
    assert!(connection.event("tick-profile").is_none());
}

#[tokio::test]
async fn over_budget_range_pages_bars_back_to_the_range_start_and_emits_a_bar_profile() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (estimate_id, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            &estimate_id,
            "M2",
            RANGE_END,
            true,
            covering_m2_bars(100_000),
        )
        .await;
    let (first_id, first) = connection.recv_bar_request().await;
    assert_eq!((first.timeframe.as_str(), first.bars), ("M1", 1000));
    assert_eq!(first.before_ms, Some(RANGE_END));
    let first_oldest = RANGE_END - 1000 * MINUTE;
    connection
        .send_bars(
            &first_id,
            "M1",
            RANGE_END,
            true,
            bars_every(first_oldest, MINUTE, 1000, 10),
        )
        .await;
    let (second_id, second) = connection.recv_bar_request().await;
    assert_eq!(second.before_ms, Some(first_oldest));
    assert!(
        wait_until(WAIT, || connection
            .harness
            .events
            .has_event("tick-profile-progress"))
        .await
    );
    // 441 bars: the oldest opens one minute before the range start.
    connection
        .send_bars(
            &second_id,
            "M1",
            first_oldest,
            true,
            bars_every(RANGE_FROM - MINUTE, MINUTE, 441, 10),
        )
        .await;
    assert!(wait_until(WAIT, || connection.harness.events.has_event("tick-profile")).await);
    let profile = connection.event("tick-profile").unwrap();
    assert_eq!(profile["source"], "bars");
    assert_eq!(profile["barTimeframe"], "M1");
    assert_eq!(profile["complete"], true);
    // Exactly the 1440 one-minute bars inside the day; the bar before it is clipped.
    assert_eq!(profile["totalWeight"], 14_400);
    assert!(connection.event("tick-profile-error").is_none());
    connection.expect_silence().await;
}

#[tokio::test]
async fn estimate_error_frame_falls_back_to_ticks_and_keeps_the_session() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (id, _) = connection.recv_bar_request().await;
    connection
        .client
        .send(BridgeClient::envelope(
            MessageType::Error,
            &id,
            Some(&connection.session),
            serde_json::json!({"code": "INTERNAL_ERROR", "message": "no history", "retryable": false}),
        ))
        .await
        .unwrap();
    connection.expect_tick_request().await;
    assert!(connection.event("tick-profile-error").is_none());
}

#[tokio::test]
async fn invalid_estimate_snapshot_falls_back_to_ticks() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (id, _) = connection.recv_bar_request().await;
    // Wrong timeframe than requested.
    connection
        .send_bars(&id, "M5", RANGE_END, true, covering_m2_bars(100_000))
        .await;
    connection.expect_tick_request().await;
}

#[tokio::test]
async fn bar_page_error_during_collection_reports_an_error_for_the_range() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (estimate_id, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            &estimate_id,
            "M2",
            RANGE_END,
            true,
            covering_m2_bars(100_000),
        )
        .await;
    let (page_id, _) = connection.recv_bar_request().await;
    connection
        .client
        .send(BridgeClient::envelope(
            MessageType::Error,
            &page_id,
            Some(&connection.session),
            serde_json::json!({"code": "INTERNAL_ERROR", "message": "history unavailable", "retryable": false}),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(WAIT, || connection
            .harness
            .events
            .has_event("tick-profile-error"))
        .await
    );
    let error = connection.event("tick-profile-error").unwrap();
    assert_eq!(error["fromMs"], RANGE_FROM);
    assert_eq!(error["endMs"], RANGE_END);
    assert!(connection.event("tick-profile").is_none());
}

#[tokio::test]
async fn estimate_response_of_a_superseded_request_is_ignored() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (stale_id, _) = connection.recv_bar_request().await;
    connection.start_profile();
    let (current_id, _) = connection.recv_bar_request().await;
    assert_ne!(stale_id, current_id);
    connection
        .send_bars(&stale_id, "M2", RANGE_END, true, covering_m2_bars(100_000))
        .await;
    connection.expect_silence().await;
    connection
        .send_bars(&current_id, "M2", RANGE_END, true, covering_m2_bars(100))
        .await;
    connection.expect_tick_request().await;
}

#[tokio::test]
async fn estimate_response_after_cancel_is_ignored() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (id, _) = connection.recv_bar_request().await;
    let cancelled = crate::bridge::commands::cancel_active_tick_profile(&connection.harness.state);
    assert!(cancelled.is_some());
    connection
        .send_bars(&id, "M2", RANGE_END, true, covering_m2_bars(100_000))
        .await;
    connection.expect_silence().await;
    assert!(connection.event("tick-profile").is_none());
    assert!(connection.event("tick-profile-error").is_none());
}

#[tokio::test]
async fn collected_pages_after_cancel_are_ignored() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (estimate_id, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            &estimate_id,
            "M2",
            RANGE_END,
            true,
            covering_m2_bars(100_000),
        )
        .await;
    let (page_id, _) = connection.recv_bar_request().await;
    crate::bridge::commands::cancel_active_tick_profile(&connection.harness.state);
    connection
        .send_bars(
            &page_id,
            "M1",
            RANGE_END,
            false,
            bars_every(RANGE_END - 10 * MINUTE, MINUTE, 10, 1),
        )
        .await;
    connection.expect_silence().await;
    assert!(connection.event("tick-profile").is_none());
}

#[tokio::test]
async fn bar_response_with_a_mismatching_request_id_is_not_taken_for_the_profile() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (_, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            "rust-profile-bars-9999",
            "M2",
            RANGE_END,
            true,
            covering_m2_bars(100_000),
        )
        .await;
    connection.expect_silence().await;
}

#[tokio::test]
async fn tick_page_limit_switches_to_a_bar_profile_for_the_whole_range() {
    let mut connection = profile_connection().await;
    let request = profile_request();
    {
        let mut controller = connection.harness.state.tick_controller.lock().unwrap();
        controller.begin(request.clone());
        controller.active.as_mut().unwrap().completed_pages = MAX_ACTIVE_TICK_PAGES;
    }
    *connection
        .harness
        .state
        .pending_tick_profile
        .lock()
        .unwrap() = Some(request);
    connection.harness.state.wake_outbound();
    let page = connection.client.recv(WAIT).await.unwrap();
    assert_eq!(page.message_type, MessageType::TickHistoryRequest);
    connection
        .client
        .send(BridgeClient::envelope(
            MessageType::TickHistorySnapshot,
            "limit-page",
            Some(&connection.session),
            serde_json::json!({
                "request_id": page.id, "symbol": "EURUSD", "from_ms": RANGE_FROM, "to_ms": RANGE_END,
                "tick_size": "1", "complete": true, "ticks": []
            }),
        ))
        .await
        .unwrap();
    let (bars_id, bars) = connection.recv_bar_request().await;
    assert_eq!(bars.timeframe, "M1");
    assert_eq!(bars.before_ms, Some(RANGE_END));
    // History ends inside the range for every timeframe: each coarser one is
    // tried for the whole range, then the finest of the furthest-reaching is
    // reported as a partial profile.
    let partial_bars = bars_every(RANGE_END - 5 * MINUTE, MINUTE, 5, 7);
    let mut asked = vec![bars.timeframe.clone()];
    let (mut id, mut page) = (bars_id, bars);
    loop {
        connection
            .send_bars(&id, &page.timeframe, RANGE_END, false, partial_bars.clone())
            .await;
        // A retry follows at once; the final profile is followed by silence.
        let Some(frame) = connection.client.recv(QUIET).await else {
            break;
        };
        assert_eq!(frame.message_type, MessageType::HistoryRequest);
        page = serde_json::from_value(frame.payload).unwrap();
        id = frame.id;
        assert_eq!(page.before_ms, Some(RANGE_END));
        asked.push(page.timeframe.clone());
    }
    assert!(wait_until(WAIT, || connection.harness.events.has_event("tick-profile")).await);
    assert_eq!(
        asked,
        ["M1", "M2", "M4", "M10", "M20", "H1", "H2", "H4", "H8", "D1"]
    );
    let profile = connection.event("tick-profile").unwrap();
    assert_eq!(profile["source"], "bars");
    assert_eq!(profile["barTimeframe"], "M1");
    assert_eq!(profile["coveredFromMs"], RANGE_END - 5 * MINUTE);
    assert_eq!(profile["totalWeight"], 35);
    assert!(connection.event("tick-profile-error").is_none());
}

fn drive_limit(connection: &ProfileConnection, limit: TickProfileLimit) {
    let request = profile_request();
    connection
        .harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .begin(request.clone());
    let events: Arc<dyn BridgeEvents> = connection.harness.events.clone();
    let inbound = Inbound {
        events: &events,
        state: &connection.harness.state,
        adapter: &connection.harness.adapter,
        session_id: &connection.session,
    };
    finish_tick_page(&inbound, TickPageResult::Limit(request, limit), None);
}

#[tokio::test]
async fn distinct_price_limit_switches_to_bars_and_other_limits_still_error() {
    let connection = profile_connection().await;
    drive_limit(&connection, TickProfileLimit::DistinctPrices);
    assert!(connection
        .harness
        .state
        .pending_profile_bars
        .lock()
        .unwrap()
        .is_some());
    assert!(connection.event("tick-profile-error").is_none());
    assert!(connection
        .harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .active
        .is_none());
}

#[tokio::test]
async fn non_fallback_limits_keep_their_errors() {
    for limit in [
        TickProfileLimit::CountOverflow,
        TickProfileLimit::TickSizeChanged,
        TickProfileLimit::InvalidTick,
        TickProfileLimit::UncertifiableMillisecond,
    ] {
        let connection = profile_connection().await;
        drive_limit(&connection, limit);
        let error = connection.event("tick-profile-error").expect("error event");
        assert_eq!(error["message"], limit.message().as_str());
        assert!(connection
            .harness
            .state
            .pending_profile_bars
            .lock()
            .unwrap()
            .is_none());
    }
}

#[tokio::test]
async fn safety_net_without_a_covering_timeframe_reports_an_error() {
    let connection = profile_connection().await;
    connection
        .harness
        .state
        .status
        .lock()
        .unwrap()
        .supported_timeframes
        .clear();
    drive_limit(&connection, TickProfileLimit::Pages);
    assert!(connection.event("tick-profile-error").is_some());
    assert!(connection
        .harness
        .state
        .pending_profile_bars
        .lock()
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn profile_bar_pages_and_chart_history_pages_do_not_consume_each_other() {
    let mut connection = profile_connection().await;
    let chart_page = HistoryRequest {
        symbol: "EURUSD".into(),
        timeframe: "M5".into(),
        bars: 300,
        before_ms: Some(5_000),
    };
    *connection
        .harness
        .state
        .pending_history_page
        .lock()
        .unwrap() = Some(chart_page);
    connection.start_profile();
    let chart = connection.client.recv(WAIT).await.unwrap();
    assert!(chart.id.starts_with("rust-history-page-"), "{}", chart.id);
    let (profile_id, _) = connection.recv_bar_request().await;
    // The profile response must leave the chart's expected page untouched.
    connection
        .send_bars(&profile_id, "M2", RANGE_END, true, covering_m2_bars(100))
        .await;
    connection.expect_tick_request().await;
    assert!(!connection.harness.events.has_event("history-page"));
    assert!(connection
        .harness
        .state
        .expected_history_page
        .lock()
        .unwrap()
        .is_some());
    // And the chart's page response must not touch the profile.
    connection
        .client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "chart-page",
            Some(&connection.session),
            serde_json::json!({
                "request_id": chart.id, "symbol": "EURUSD", "timeframe": "M5", "complete": true,
                "before_ms": 5000, "candles": [serde_json::to_value(bar(1_000, 5)).unwrap()],
            }),
        ))
        .await
        .unwrap();
    assert!(wait_until(WAIT, || connection.harness.events.has_event("history-page")).await);
}

#[tokio::test]
async fn refreshing_an_open_bar_profile_asks_the_ea_only_for_the_newest_bars() {
    let mut connection = profile_connection().await;
    // First load: the estimate page plus two full pages and a short one.
    connection.start_profile();
    let (estimate_id, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            &estimate_id,
            "M2",
            RANGE_END,
            true,
            covering_m2_bars(100_000),
        )
        .await;
    let (first_id, _) = connection.recv_bar_request().await;
    let first_oldest = RANGE_END - 1000 * MINUTE;
    connection
        .send_bars(
            &first_id,
            "M1",
            RANGE_END,
            true,
            bars_every(first_oldest, MINUTE, 1000, 10),
        )
        .await;
    let (second_id, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            &second_id,
            "M1",
            first_oldest,
            true,
            bars_every(RANGE_FROM - MINUTE, MINUTE, 441, 10),
        )
        .await;
    assert!(wait_until(WAIT, || connection.harness.events.has_event("tick-profile")).await);
    assert_eq!(
        connection.event("tick-profile").unwrap()["totalWeight"],
        14_400
    );

    // Refresh five minutes later: one estimate page, then a single bar page
    // that overlaps the cached newest bar; the 1440 older bars are not asked.
    let refreshed_end = RANGE_END + 5 * MINUTE;
    connection.start_profile_until(refreshed_end);
    let (estimate_id, _) = connection.recv_bar_request().await;
    connection
        .send_bars(
            &estimate_id,
            "M2",
            refreshed_end,
            true,
            covering_m2_bars(100_000),
        )
        .await;
    let (page_id, page) = connection.recv_bar_request().await;
    assert_eq!(
        (page.timeframe.as_str(), page.before_ms),
        ("M1", Some(refreshed_end))
    );
    connection
        .send_bars(
            &page_id,
            "M1",
            refreshed_end,
            true,
            bars_every(RANGE_END - 10 * MINUTE, MINUTE, 15, 10),
        )
        .await;
    assert!(wait_until(WAIT, || connection.events_named("tick-profile").len() == 2).await);
    let profiles = connection.events_named("tick-profile");
    // 1445 minute bars in [FROM, FROM + 1445 min): the day plus five new ones.
    assert_eq!(profiles[1]["totalWeight"], 14_450);
    assert_eq!(profiles[1]["source"], "bars");
    assert!(connection.event("tick-profile-error").is_none());
    connection.expect_silence().await;
}

#[tokio::test]
async fn correlated_error_for_a_chart_history_page_clears_the_page_and_keeps_the_session() {
    let mut connection = profile_connection().await;
    connection.expect_page("rust-history-page-7");
    connection.send_internal_error("rust-history-page-7").await;
    assert!(
        wait_until(WAIT, || !connection.page_is_expected()).await,
        "the failed page request must be cleared"
    );
    connection.assert_session_alive().await;
}

#[tokio::test]
async fn stale_correlated_error_for_a_chart_history_page_is_ignored() {
    let mut connection = profile_connection().await;
    connection.expect_page("rust-history-page-8");
    connection.send_internal_error("rust-history-page-7").await;
    connection.assert_session_alive().await;
    assert!(connection.page_is_expected(), "the awaited page stays");
}

#[tokio::test]
async fn stale_correlated_error_for_a_profile_bar_page_is_ignored() {
    let mut connection = profile_connection().await;
    connection.start_profile();
    let (stale_id, _) = connection.recv_bar_request().await;
    connection.start_profile();
    let (current_id, _) = connection.recv_bar_request().await;
    connection.send_internal_error(&stale_id).await;
    connection.expect_silence().await;
    assert!(connection.event("tick-profile-error").is_none());
    connection
        .send_bars(&current_id, "M2", RANGE_END, true, covering_m2_bars(100))
        .await;
    connection.expect_tick_request().await;
}

#[tokio::test]
async fn uncorrelated_error_still_fails_closed() {
    let mut connection = profile_connection().await;
    connection.send_internal_error("ea-1").await;
    let reply = connection.client.recv(WAIT).await.expect("error reply");
    assert_eq!(reply.message_type, MessageType::Error);
    assert_eq!(reply.payload["code"], "INVALID_MESSAGE");
}
