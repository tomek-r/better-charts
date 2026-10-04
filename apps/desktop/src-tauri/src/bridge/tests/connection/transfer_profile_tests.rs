use super::*;

#[test]
fn frame_configuration_accepts_measured_sizes_and_rejects_invalid_values() {
    assert_eq!(
        configured_transfer_limits(None).unwrap(),
        trading_core::protocol::TransferLimits::measured_default()
    );
    assert_eq!(
        configured_transfer_limits(Some("33554432"))
            .unwrap()
            .max_frame_bytes,
        32 * 1024 * 1024
    );
    for invalid in ["0", "1023", "4294967295", "not-a-number"] {
        assert!(configured_transfer_limits(Some(invalid)).is_err());
    }
}

#[tokio::test]
async fn invalid_transfer_limits_are_rejected_before_establishing_a_session() {
    let state = BridgeState::with_symbol_cache_path(None);
    let harness = start_bridge(
        state.clone(),
        ExecutionAdapterState::new(ExecutionSafetyState::unavailable()),
    )
    .await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["transfer_limits"] =
        serde_json::json!({"max_frame_bytes": 0, "max_ticks_per_page": 5000});
    client.send(hello).await.unwrap();
    let response = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(response.message_type, MessageType::Error);
    assert!(state.current_session.lock().unwrap().is_none());
}

#[tokio::test]
async fn negotiated_price_counts_reach_profile_with_tiny_payloads_and_legacy_fallback() {
    use trading_core::protocol::{MarketTick, TransferLimits};
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["transfer_limits"] =
        serde_json::to_value(TransferLimits::measured_default()).unwrap();
    hello.payload["tick_price_counts"] = true.into();
    let handshake = complete_handshake_with_hello(&mut client, hello).await;
    assert!(*harness.state.tick_price_counts.lock().unwrap());
    let request = TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "EURUSD".into(),
            from_ms: 0,
            to_ms: 400_000,
            max_ticks: 65535,
        },
        rows: 128,
    };
    harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .begin(request.clone());
    *harness.state.pending_tick_profile.lock().unwrap() = Some(request);
    harness.state.wake_outbound();
    let mut bytes = 0;
    for page_index in 0..5 {
        let page = client.recv(Duration::from_secs(2)).await.unwrap();
        assert_eq!(page.payload["price_counts"], true);
        let wire: TickHistoryRequest = serde_json::from_value(page.payload).unwrap();
        let end = (wire.from_ms + i64::from(wire.max_ticks)).min(300_000);
        let complete = end == 300_000;
        let raw = TickHistorySnapshot {
            request_id: page.id,
            symbol: wire.symbol,
            from_ms: wire.from_ms,
            to_ms: wire.to_ms,
            tick_size: "0.1".into(),
            complete,
            ticks: (wire.from_ms..end)
                .map(|index| MarketTick {
                    time_ms: index,
                    bid: if index < 250_000 { "100" } else { "400" }.into(),
                    ask: if index < 250_000 { "101" } else { "401" }.into(),
                    last: "0".into(),
                    volume: 0,
                    volume_real: "0".into(),
                    flags: 6,
                })
                .collect(),
        };
        // A high-cardinality summary may use the already-read raw page instead.
        let (message_type, payload) = if page_index == 1 {
            (
                MessageType::TickHistorySnapshot,
                serde_json::to_value(raw).unwrap(),
            )
        } else {
            let summary = super::tests::tick_cache::price_summary(
                raw,
                if complete { wire.to_ms } else { end - 1 },
            );
            let payload = serde_json::to_value(summary).unwrap();
            bytes += serde_json::to_vec(&payload).unwrap().len();
            (MessageType::TickPriceHistorySnapshot, payload)
        };
        let envelope = BridgeClient::envelope(
            message_type,
            "price-page",
            Some(&handshake.session),
            payload,
        );
        let frame = trading_core::protocol::encode_frame_with_limit(
            &serde_json::to_vec(&envelope).unwrap(),
            handshake.transfer_limits.max_frame_bytes as usize,
        )
        .unwrap();
        client.stream.write_all(&frame).await.unwrap();
        assert!(
            wait_until(Duration::from_secs(2), || harness
                .events
                .events()
                .iter()
                .any(|(event, payload)| event == "tick-profile-progress"
                    && payload["completedPages"] == page_index + 1))
            .await
        );
    }
    assert!(
        wait_until(Duration::from_secs(2), || harness
            .events
            .has_event("tick-profile"))
        .await
    );
    let (_, profile) = harness
        .events
        .events()
        .into_iter()
        .find(|(event, _)| event == "tick-profile")
        .unwrap();
    assert_eq!(profile["complete"], true);
    assert_eq!(profile["totalWeight"], 300_000);
    assert!(
        bytes < 4000,
        "four summary pages should be much smaller than raw tick JSON"
    );
    assert!(!harness.events.has_event("tick-profile-error"));
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(handshake.session.as_str())
    );
}

#[tokio::test]
async fn negotiated_tick_page_larger_than_one_mib_reaches_the_profile() {
    use trading_core::protocol::{encode_frame_with_limit, MarketTick, TransferLimits};
    let state = BridgeState::with_symbol_cache_path(None);
    let harness = start_bridge(
        state.clone(),
        ExecutionAdapterState::new(ExecutionSafetyState::unavailable()),
    )
    .await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let limits = TransferLimits {
        max_frame_bytes: 4 * 1024 * 1024,
        max_ticks_per_page: 20_000,
    };
    let mut hello = valid_hello(None);
    hello.payload["transfer_limits"] = serde_json::to_value(limits).unwrap();
    let handshake = complete_handshake_with_hello(&mut client, hello).await;
    assert_eq!(handshake.transfer_limits, limits);
    assert_eq!(*state.transfer_limits.lock().unwrap(), limits);

    let request = TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "EURUSD".into(),
            from_ms: 100,
            to_ms: 50_000,
            max_ticks: limits.max_ticks_per_page,
        },
        rows: 32,
    };
    state.tick_controller.lock().unwrap().begin(request.clone());
    *state.pending_tick_profile.lock().unwrap() = Some(request);
    state.wake_outbound();
    let page = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(page.message_type, MessageType::TickHistoryRequest);
    let wire: TickHistoryRequest = serde_json::from_value(page.payload).unwrap();
    assert_eq!(wire.max_ticks, 20_000);
    let snapshot = TickHistorySnapshot {
        request_id: page.id,
        symbol: wire.symbol,
        from_ms: wire.from_ms,
        to_ms: wire.to_ms,
        tick_size: "0.1".into(),
        complete: true,
        ticks: (0..20_000)
            .map(|index| MarketTick {
                time_ms: 100 + index,
                bid: "100.0".into(),
                ask: "100.1".into(),
                last: "0".into(),
                volume: 0,
                volume_real: "0".into(),
                flags: 6,
            })
            .collect(),
    };
    let envelope = BridgeClient::envelope(
        MessageType::TickHistorySnapshot,
        "synthetic-large-page",
        Some(&handshake.session),
        serde_json::to_value(snapshot).unwrap(),
    );
    let payload = serde_json::to_vec(&envelope).unwrap();
    assert!(payload.len() > trading_core::protocol::MAX_FRAME_SIZE);
    let frame = encode_frame_with_limit(&payload, limits.max_frame_bytes as usize).unwrap();
    client.stream.write_all(&frame).await.unwrap();
    assert!(
        wait_until(Duration::from_secs(2), || harness
            .events
            .has_event("tick-profile"))
        .await
    );
    let (_, profile) = harness
        .events
        .events()
        .into_iter()
        .find(|(name, _)| name == "tick-profile")
        .unwrap();
    assert_eq!(profile["complete"], true);
    assert_eq!(profile["totalWeight"], 20_000);
}

#[tokio::test]
async fn pending_h1_tick_history_keeps_heartbeats_alive_and_failure_preserves_session() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let request = TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "EURUSD".into(),
            from_ms: 100,
            to_ms: 86_400_100,
            max_ticks: 5000,
        },
        rows: 128,
    };
    harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .begin(request.clone());
    *harness.state.pending_tick_profile.lock().unwrap() = Some(request);
    harness.state.wake_outbound();
    let page = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(page.message_type, MessageType::TickHistoryRequest);
    // Historical synchronization lasts longer than the unchanged six-second
    // heartbeat deadline. The asynchronous reader still services each heartbeat.
    for sequence in 1..=4 {
        tokio::time::sleep(Duration::from_secs(2)).await;
        client.send(BridgeClient::envelope(MessageType::Heartbeat, "hb-slow-history", Some(&handshake.session),
            serde_json::json!({"sequence": sequence, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}))).await.unwrap();
        assert_eq!(
            client
                .recv(Duration::from_secs(2))
                .await
                .unwrap()
                .message_type,
            MessageType::HeartbeatAck
        );
    }
    client.send(BridgeClient::envelope(MessageType::Error, &page.id, Some(&handshake.session),
        serde_json::json!({"code": "INTERNAL_ERROR", "message": "tick history synchronization timed out", "retryable": false}))).await.unwrap();
    assert!(
        wait_until(Duration::from_secs(2), || harness
            .events
            .has_event("tick-profile-error"))
        .await
    );
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(handshake.session.as_str())
    );
    assert!(harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .active
        .is_none());
    assert!(!harness.events.has_event("tick-profile"));
    // A stale failure cannot cancel a newer request.
    harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .begin(TickProfileRequest {
            wire: TickHistoryRequest {
                symbol: "EURUSD".into(),
                from_ms: 200,
                to_ms: 300,
                max_ticks: 5000,
            },
            rows: 128,
        });
    client.send(BridgeClient::envelope(MessageType::Error, &page.id, Some(&handshake.session),
        serde_json::json!({"code": "INTERNAL_ERROR", "message": "stale page", "retryable": false}))).await.unwrap();
    client.send(BridgeClient::envelope(MessageType::Heartbeat, "hb-after-error", Some(&handshake.session),
        serde_json::json!({"sequence": 5, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}))).await.unwrap();
    assert_eq!(
        client
            .recv(Duration::from_secs(2))
            .await
            .unwrap()
            .message_type,
        MessageType::HeartbeatAck
    );
    assert!(harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .active
        .is_some());
}

#[tokio::test]
async fn profile_page_limit_reports_error_without_painting_prefix_or_resetting_session() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let request = TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "EURUSD".into(),
            from_ms: 100,
            to_ms: 1000,
            max_ticks: 5000,
        },
        rows: 128,
    };
    {
        let mut controller = harness.state.tick_controller.lock().unwrap();
        controller.begin(request.clone());
        controller.active.as_mut().unwrap().completed_pages = MAX_ACTIVE_TICK_PAGES;
    }
    *harness.state.pending_tick_profile.lock().unwrap() = Some(request);
    harness.state.wake_outbound();
    let page = client.recv(Duration::from_secs(2)).await.unwrap();
    client
        .send(BridgeClient::envelope(
            MessageType::TickHistorySnapshot,
            "limit-page",
            Some(&handshake.session),
            serde_json::json!({
                "request_id": page.id, "symbol": "EURUSD", "from_ms": 100, "to_ms": 1000,
                "tick_size": "1", "complete": true, "ticks": []
            }),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(Duration::from_secs(2), || harness
            .events
            .has_event("tick-profile-error"))
        .await
    );
    assert!(!harness.events.has_event("tick-profile"));
    assert!(harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .active
        .is_none());
    client.send(BridgeClient::envelope(MessageType::Heartbeat, "hb-after-limit", Some(&handshake.session), serde_json::json!({
        "sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"
    }))).await.unwrap();
    assert_eq!(
        client
            .recv(Duration::from_secs(2))
            .await
            .unwrap()
            .message_type,
        MessageType::HeartbeatAck
    );
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(handshake.session.as_str())
    );
}

#[tokio::test]
async fn streamed_multi_day_profile_reaches_ui_without_truncation_or_session_reset() {
    use trading_core::protocol::{encode_frame_with_limit, MarketTick, TransferLimits};
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let limits = TransferLimits::measured_default();
    let mut hello = valid_hello(None);
    hello.payload["transfer_limits"] = serde_json::to_value(limits).unwrap();
    let handshake = complete_handshake_with_hello(&mut client, hello).await;
    let request = TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "EURUSD".into(),
            from_ms: 0,
            to_ms: 400_000,
            max_ticks: limits.max_ticks_per_page,
        },
        rows: 128,
    };
    harness
        .state
        .tick_controller
        .lock()
        .unwrap()
        .begin(request.clone());
    *harness.state.pending_tick_profile.lock().unwrap() = Some(request);
    harness.state.wake_outbound();
    for page_index in 0..5 {
        let page = client.recv(Duration::from_secs(3)).await.unwrap();
        assert_eq!(page.message_type, MessageType::TickHistoryRequest);
        // Keep the simulated EA live during a large transfer. On the second
        // page, span the full heartbeat deadline to guard against relying on
        // the entire test finishing within that deadline on a fast machine.
        let heartbeat_count = if page_index == 1 { 4 } else { 1 };
        for beat in 0..heartbeat_count {
            if beat > 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            let sequence = page_index * 4 + beat + 1;
            client
                .send(BridgeClient::envelope(
                    MessageType::Heartbeat,
                    "multi-day-heartbeat",
                    Some(&handshake.session),
                    serde_json::json!({
                        "sequence": sequence, "terminal_connected": true,
                        "account_connected": true, "broker_server": "Broker-Demo"
                    }),
                ))
                .await
                .unwrap();
            let ack = client.recv(Duration::from_secs(3)).await.unwrap();
            assert_eq!(ack.message_type, MessageType::HeartbeatAck);
            assert_eq!(ack.payload["sequence"], sequence);
        }
        let wire: TickHistoryRequest = serde_json::from_value(page.payload).unwrap();
        assert_eq!(wire.max_ticks, 65_535);
        let end = (wire.from_ms + i64::from(wire.max_ticks)).min(300_000);
        let snapshot = TickHistorySnapshot {
            request_id: page.id,
            symbol: wire.symbol,
            from_ms: wire.from_ms,
            to_ms: wire.to_ms,
            tick_size: "0.1".into(),
            complete: end == 300_000,
            ticks: (wire.from_ms..end)
                .map(|index| MarketTick {
                    time_ms: index,
                    bid: if index < 250_000 { "100" } else { "400" }.into(),
                    ask: if index < 250_000 { "101" } else { "401" }.into(),
                    last: "0".into(),
                    volume: 0,
                    volume_real: "0".into(),
                    flags: 6,
                })
                .collect(),
        };
        let envelope = BridgeClient::envelope(
            MessageType::TickHistorySnapshot,
            "multi-day-page",
            Some(&handshake.session),
            serde_json::to_value(snapshot).unwrap(),
        );
        let frame = encode_frame_with_limit(
            &serde_json::to_vec(&envelope).unwrap(),
            limits.max_frame_bytes as usize,
        )
        .unwrap();
        client.stream.write_all(&frame).await.unwrap();
        assert!(
            wait_until(Duration::from_secs(3), || harness
                .events
                .events()
                .iter()
                .any(|(event, payload)| {
                    event == "tick-profile-progress" && payload["completedPages"] == page_index + 1
                }))
            .await
        );
    }
    assert!(
        wait_until(Duration::from_secs(3), || harness
            .events
            .has_event("tick-profile"))
        .await
    );
    let (_, profile) = harness
        .events
        .events()
        .into_iter()
        .find(|(name, _)| name == "tick-profile")
        .unwrap();
    assert_eq!(profile["complete"], true);
    assert_eq!(profile["totalWeight"], 300_000);
    assert!(profile["bins"].as_array().unwrap().iter().any(|bin| {
        let low = bin["low"]
            .as_str()
            .unwrap()
            .parse::<rust_decimal::Decimal>()
            .unwrap();
        let high = bin["high"]
            .as_str()
            .unwrap()
            .parse::<rust_decimal::Decimal>()
            .unwrap();
        low <= rust_decimal::Decimal::from(400)
            && high > rust_decimal::Decimal::from(400)
            && bin["bid"] == 50_000
    }));
    assert!(!harness.events.has_event("tick-profile-error"));
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(handshake.session.as_str())
    );
}
