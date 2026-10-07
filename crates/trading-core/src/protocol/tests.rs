use super::*;

#[test]
fn decoder_handles_a_large_coalesced_batch_and_preserves_partial_tail() {
    let mut decoder = FrameDecoder::new();
    let frame = encode_frame(&[42]).unwrap();
    let mut batch = frame.repeat(10_000);
    batch.extend_from_slice(&[0, 0, 0, 2, 1]);
    let frames = decoder.push(&batch).unwrap();
    assert_eq!(frames.len(), 10_000);
    assert!(frames.iter().all(|frame| frame == &[42]));
    assert_eq!(decoder.push(&[2]).unwrap(), [vec![1, 2]]);
    assert!(decoder.buffer.is_empty());
}

#[test]
fn decoder_consumes_valid_prefix_before_reporting_invalid_trailing_header() {
    let mut decoder = FrameDecoder::new();
    let mut batch = encode_frame(&[42]).unwrap();
    batch.extend_from_slice(&[0, 0, 0, 0]);
    assert!(matches!(decoder.push(&batch), Err(FrameError::Empty)));
    assert_eq!(decoder.buffer, [0, 0, 0, 0]);
}

#[test]
fn transfer_limits_negotiate_and_preserve_legacy_handshakes() {
    let modern = TransferLimits::measured_default();
    assert_eq!(
        modern.negotiate(TransferLimits::default()).unwrap(),
        TransferLimits::default()
    );
    let peer = TransferLimits {
        max_frame_bytes: 16 * 1024 * 1024,
        max_ticks_per_page: 30_000,
    };
    assert_eq!(
        modern.negotiate(peer).unwrap(),
        TransferLimits {
            max_frame_bytes: modern.max_frame_bytes,
            max_ticks_per_page: peer.max_ticks_per_page,
        }
    );
    let ack: HelloAckPayload = serde_json::from_value(serde_json::json!({
        "heartbeat_interval_ms": 2000,
        "heartbeat_timeout_ms": 6000,
        "trading_enabled": false,
    }))
    .unwrap();
    assert_eq!(ack.transfer_limits, TransferLimits::default());
    for invalid in [
        TransferLimits {
            max_frame_bytes: 0,
            ..modern
        },
        TransferLimits {
            max_frame_bytes: u32::MAX,
            ..modern
        },
        TransferLimits {
            max_ticks_per_page: 0,
            ..modern
        },
    ] {
        assert!(modern.negotiate(invalid).is_err());
    }
}

#[test]
fn negotiated_frames_accept_large_fragmented_payloads_and_reject_oversize_headers() {
    let payload = vec![b'a'; 2 * MAX_FRAME_SIZE];
    assert!(encode_frame(&payload).is_err());
    let wire = encode_frame_with_limit(&payload, payload.len()).unwrap();
    let mut legacy = FrameDecoder::new();
    assert!(matches!(legacy.push(&wire[..4]), Err(FrameError::TooLarge)));
    let mut decoder = FrameDecoder::with_max_frame_size(payload.len());
    let mut frames = Vec::new();
    for chunk in wire.chunks(8192) {
        frames.extend(decoder.push(chunk).unwrap());
    }
    assert_eq!(frames, vec![payload]);
    let mut decoder = FrameDecoder::with_max_frame_size(2 * MAX_FRAME_SIZE);
    assert!(matches!(
        decoder.push(&(2 * MAX_FRAME_SIZE as u32 + 1).to_be_bytes()),
        Err(FrameError::TooLarge)
    ));
}

#[test]
fn decoder_handles_fragmentation_and_multiple_frames() {
    let mut wire = encode_frame(b"one").unwrap();
    wire.extend(encode_frame(b"two").unwrap());
    let mut decoder = FrameDecoder::new();
    assert!(decoder.push(&wire[..2]).unwrap().is_empty());
    assert_eq!(decoder.push(&wire[2..7]).unwrap(), vec![b"one".to_vec()]);
    assert_eq!(decoder.push(&wire[7..]).unwrap(), vec![b"two".to_vec()]);
}

#[test]
fn rejects_empty_and_oversized_frames() {
    assert_eq!(
        encode_frame(&[]).unwrap_err().to_string(),
        "frame payload is empty"
    );
    let mut decoder = FrameDecoder::new();
    assert!(matches!(
        decoder.push(&(MAX_FRAME_SIZE as u32 + 1).to_be_bytes()),
        Err(FrameError::TooLarge)
    ));
}

#[test]
fn validates_ordered_m1_history_and_rejects_bad_decimal() {
    let request = HistoryRequest {
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        bars: 2,
        before_ms: None,
    };
    let candle = |time_ms, close: &str| MarketCandle {
        time_ms,
        open: "1.0".into(),
        high: "2.0".into(),
        low: "0.5".into(),
        close: close.into(),
        tick_volume: 1,
        spread: 2,
        real_volume: 0,
    };
    let snapshot = HistorySnapshot {
        request_id: "r".into(),
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        complete: true,
        candles: vec![candle(1, "1.2"), candle(2, "1.3")],
        before_ms: None,
    };
    assert!(snapshot.validate(&request).is_ok());
    let bad = HistorySnapshot {
        candles: vec![candle(1, "NaN")],
        ..snapshot.clone()
    };
    assert!(bad.validate(&request).is_err());
}

#[test]
fn older_history_pages_are_an_additive_optional_extension() {
    let window = HistoryRequest {
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        bars: 1000,
        before_ms: None,
    };
    // A window request keeps the pre-extension wire shape: no new field.
    let encoded = serde_json::to_value(&window).unwrap();
    assert!(encoded.get("before_ms").is_none());
    assert_eq!(
        serde_json::from_value::<HistoryRequest>(encoded).unwrap(),
        window
    );
    assert!(!window.is_page());

    let mut page = window.clone();
    page.before_ms = Some(1_700_000_000_000);
    assert!(page.is_page());
    assert_eq!(page.validate(), Ok(()));
    let encoded = serde_json::to_value(&page).unwrap();
    assert_eq!(
        encoded.get("before_ms"),
        Some(&serde_json::json!(1_700_000_000_000i64))
    );
    assert_eq!(
        serde_json::from_value::<HistoryRequest>(encoded).unwrap(),
        page
    );

    // A non-positive anchor can never address a bar.
    for before_ms in [0, -1, i64::MIN] {
        let invalid = HistoryRequest {
            before_ms: Some(before_ms),
            ..page.clone()
        };
        assert_eq!(invalid.validate(), Err("invalid history request"));
    }
}

#[test]
fn page_snapshot_echo_must_agree_with_the_request_that_asked_for_it() {
    let candle = |time_ms| MarketCandle {
        time_ms,
        open: "1.0".into(),
        high: "2.0".into(),
        low: "0.5".into(),
        close: "1.5".into(),
        tick_volume: 1,
        spread: 2,
        real_volume: 0,
    };
    let snapshot = |before_ms| HistorySnapshot {
        request_id: "r".into(),
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        complete: false,
        candles: vec![candle(1)],
        before_ms,
    };
    let window = HistoryRequest {
        symbol: "NAS100".into(),
        timeframe: "M1".into(),
        bars: 1000,
        before_ms: None,
    };
    let page = HistoryRequest {
        before_ms: Some(500),
        ..window.clone()
    };

    // A window answer never claims a page anchor, and a page answer either
    // echoes the anchor it was asked for or omits it entirely (a peer that
    // predates the extension).
    assert_eq!(snapshot(None).validate(&window), Ok(()));
    assert!(snapshot(Some(500)).validate(&window).is_err());
    assert_eq!(snapshot(Some(500)).validate(&page), Ok(()));
    assert_eq!(snapshot(None).validate(&page), Ok(()));
    assert!(snapshot(Some(499)).validate(&page).is_err());
    assert!(snapshot(Some(0)).validate(&page).is_err());
}

#[test]
fn validates_half_open_tick_history_with_duplicate_timestamps() {
    let request = TickHistoryRequest {
        symbol: "NAS100".into(),
        from_ms: 100,
        to_ms: 200,
        max_ticks: 2,
    };
    let tick = |time_ms| MarketTick {
        time_ms,
        bid: "20000.1".into(),
        ask: "20000.3".into(),
        last: "0".into(),
        volume: 0,
        volume_real: "0".into(),
        flags: 6,
    };
    let snapshot = TickHistorySnapshot {
        request_id: "ticks-1".into(),
        symbol: "NAS100".into(),
        from_ms: 100,
        to_ms: 200,
        tick_size: "0.1".into(),
        complete: true,
        ticks: vec![tick(100), tick(100)],
    };
    assert!(snapshot.validate(&request).is_ok());
    let outside = TickHistorySnapshot {
        ticks: vec![tick(200)],
        ..snapshot
    };
    assert!(outside.validate(&request).is_err());
}

#[test]
fn validates_exact_price_summary_and_rejects_ambiguous_boundaries_or_counts() {
    let request = TickHistoryRequest {
        symbol: "NAS".into(),
        from_ms: 10,
        to_ms: 20,
        max_ticks: 100,
    };
    let snapshot = TickPriceHistorySnapshot {
        request_id: "page".into(),
        symbol: "NAS".into(),
        from_ms: 10,
        to_ms: 20,
        tick_size: "0.1".into(),
        complete: false,
        through_ms: 15,
        loaded_ticks: 3,
        rejected_ticks: 0,
        min_quote: Some("100".into()),
        max_quote: Some("101".into()),
        prices: vec![
            TickPriceCount {
                price: "100".into(),
                total: 3,
                bid: 2,
                ask: 0,
                bid_seen: true,
            },
            TickPriceCount {
                price: "101".into(),
                total: 0,
                bid: 0,
                ask: 2,
                bid_seen: false,
            },
        ],
    };
    assert!(snapshot.validate(&request).is_ok());
    let mut bad = snapshot.clone();
    bad.complete = true;
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.through_ms = 10;
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.loaded_ticks = 2;
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.prices[0].bid = 4;
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.prices[1].ask = 4;
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.prices.push(bad.prices[0].clone());
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.prices[1].price = "100.0".into();
    assert!(bad.validate(&request).is_err());
    let mut bad = snapshot.clone();
    bad.min_quote = None;
    assert!(bad.validate(&request).is_err());
    let mut empty = snapshot;
    empty.through_ms = 10;
    empty.loaded_ticks = 0;
    empty.prices.clear();
    empty.min_quote = None;
    empty.max_quote = None;
    assert!(empty.validate(&request).is_ok());
    empty.complete = true;
    empty.through_ms = 20;
    assert!(empty.validate(&request).is_ok());
}

#[test]
fn validates_symbol_search_and_serializes_snake_case() {
    let request = SymbolSearchRequest {
        query: "nas".into(),
        limit: 2,
    };
    request.validate().unwrap();
    let symbol = BrokerSymbol {
        symbol: "NAS100".into(),
        description: "Nasdaq".into(),
        digits: 1,
        tick_size: "0.1".into(),
        point_size: "0.1".into(),
        contract_size: "1".into(),
        volume_min: "0.01".into(),
        volume_max: "100".into(),
        volume_step: "0.01".into(),
        trade_mode: 4,
        stops_level: 0,
        freeze_level: 0,
        filling_mode: 1,
        order_mode: 127,
        expiration_mode: 15,
        trade_execution: 2,
    };
    let result = SymbolSearchResult {
        request_id: "req-1".into(),
        query: "nas".into(),
        symbols: vec![symbol.clone()],
    };
    result.validate(&request).unwrap();
    assert!(BrokerSymbol {
        point_size: "0".into(),
        ..symbol.clone()
    }
    .validate()
    .is_err());
    assert!(BrokerSymbol {
        contract_size: "NaN".into(),
        ..symbol.clone()
    }
    .validate()
    .is_err());
    let info_request = SymbolInfoRequest {
        symbol: "NAS100".into(),
    };
    let info_result = SymbolInfoResult {
        request_id: "info-1".into(),
        symbol_info: symbol.clone(),
    };
    assert!(info_result.validate("info-1", &info_request).is_ok());
    assert!(info_result.validate("old-info", &info_request).is_err());
    assert!(SymbolInfoResult {
        request_id: "info-1".into(),
        symbol_info: BrokerSymbol {
            symbol: "OTHER".into(),
            ..symbol.clone()
        },
    }
    .validate("info-1", &info_request)
    .is_err());
    let json = serde_json::to_value(&result).unwrap();
    assert!(json.get("request_id").is_some());
    assert!(json.get("requestId").is_none());
    assert!(SymbolSearchRequest {
        query: " ".into(),
        limit: 1
    }
    .validate()
    .is_err());
    assert!(SymbolSearchRequest {
        query: "x".into(),
        limit: 51
    }
    .validate()
    .is_err());
    let duplicate = SymbolSearchResult {
        request_id: "r".into(),
        query: "nas".into(),
        symbols: vec![symbol.clone(), symbol],
    };
    assert!(duplicate
        .validate(&SymbolSearchRequest {
            query: "nas".into(),
            limit: 2
        })
        .is_err());
}

#[test]
fn rejects_invalid_broker_symbol_parameters() {
    let invalid = BrokerSymbol {
        symbol: "EURUSD".into(),
        description: String::new(),
        digits: 5,
        tick_size: "0".into(),
        point_size: "0".into(),
        contract_size: "0".into(),
        volume_min: "0".into(),
        volume_max: "1".into(),
        volume_step: "0.01".into(),
        trade_mode: 0,
        stops_level: 0,
        freeze_level: 0,
        filling_mode: 0,
        order_mode: 0,
        expiration_mode: 0,
        trade_execution: 0,
    };
    assert!(invalid.validate().is_err());
}

#[test]
fn validates_quote_decimal_values_and_identity() {
    let quote = QuoteUpdate {
        symbol: "NAS100".into(),
        time_ms: 10,
        bid: "1.0".into(),
        ask: "1.1".into(),
        last: "0".into(),
        volume: 1,
        volume_real: "0".into(),
        flags: 6,
    };
    assert!(quote.validate("NAS100").is_ok());
    assert!(quote.validate("EURUSD").is_err());
    assert!(QuoteUpdate {
        bid: "0".into(),
        ..quote.clone()
    }
    .validate("NAS100")
    .is_err());
    assert!(QuoteUpdate {
        time_ms: -1,
        ..quote
    }
    .validate("NAS100")
    .is_err());
}

#[test]
fn validates_stop_distance_margins_against_quote_sides() {
    // The incident shape: NAS100, tick/point 0.01, stops_level 0, live quote
    // sides, min = max(stops_level*point, 20*tick) = 0.20.
    let bid = "30459.64".parse::<Decimal>().unwrap();
    let ask = "30460.64".parse::<Decimal>().unwrap();
    let point = "0.01".parse::<Decimal>().unwrap();
    let tick = "0.01".parse::<Decimal>().unwrap();
    // An SL 5.0 below entry is far beyond the margin, so it passes.
    let far_sl = "30454.64".parse::<Decimal>().unwrap();
    assert_eq!(
        validate_stop_distances(
            OrderSide::Buy,
            Some(&far_sl),
            None,
            0,
            point,
            tick,
            bid,
            ask,
        ),
        Ok(())
    );
    // A stop inside the margin from bid is rejected with the shared wording
    // (identical to the EA preflight message).
    let close_sl = "30459.50".parse::<Decimal>().unwrap();
    assert_eq!(
        validate_stop_distances(
            OrderSide::Buy,
            Some(&close_sl),
            None,
            0,
            point,
            tick,
            bid,
            ask,
        )
        .unwrap_err(),
        "stop_loss too close: distance 0.14, required >= 0.20 (20 ticks margin)"
    );
    // BUY take profit is measured from ask; a SELL mirrors the rule.
    let close_tp = "30460.80".parse::<Decimal>().unwrap();
    assert_eq!(
        validate_stop_distances(
            OrderSide::Buy,
            Some(&far_sl),
            Some(close_tp),
            0,
            point,
            tick,
            bid,
            ask,
        )
        .unwrap_err(),
        "take_profit too close: distance 0.16, required >= 0.20 (20 ticks margin)"
    );
    let sell_sl = "30460.70".parse::<Decimal>().unwrap();
    assert_eq!(
        validate_stop_distances(
            OrderSide::Sell,
            Some(&sell_sl),
            None,
            0,
            point,
            tick,
            bid,
            ask,
        )
        .unwrap_err(),
        "stop_loss too close: distance 0.06, required >= 0.20 (20 ticks margin)"
    );
    // stops_level in points can dominate the 20-tick floor: 50 * 0.01 = 0.50.
    let close_sl = "30459.20".parse::<Decimal>().unwrap(); // distance 0.44 < 0.50
    assert_eq!(
        validate_stop_distances(
            OrderSide::Buy,
            Some(&close_sl),
            None,
            50,
            point,
            tick,
            bid,
            ask,
        )
        .unwrap_err(),
        "stop_loss too close: distance 0.44, required >= 0.50 (20 ticks margin)"
    );
}

#[test]
fn validates_account_snapshot_values() {
    let account = AccountSnapshot {
        account_login: "123".into(),
        broker_server: "Demo".into(),
        currency: "USD".into(),
        balance: "100".into(),
        equity: "99".into(),
        margin: "1".into(),
        free_margin: "98".into(),
        margin_level: "9900".into(),
        leverage: 100,
        margin_mode: 0,
        trade_allowed: true,
        expert_allowed: true,
        account_trade_mode: 0,
        account_trade_mode_name: "demo".into(),
    };
    assert!(account.validate().is_ok());
    assert!(AccountSnapshot {
        equity: "0.50".into(),
        free_margin: "-0.50".into(),
        margin_level: "50".into(),
        ..account.clone()
    }
    .validate()
    .is_ok());
    assert!(AccountSnapshot {
        equity: "-1".into(),
        free_margin: "-2".into(),
        margin_level: "-100".into(),
        ..account.clone()
    }
    .validate()
    .is_ok());
    for invalid in ["NaN", "", "not-a-number"] {
        assert!(AccountSnapshot {
            free_margin: invalid.into(),
            ..account.clone()
        }
        .validate()
        .is_err());
    }
    assert!(AccountSnapshot {
        leverage: 0,
        ..account.clone()
    }
    .validate()
    .is_err());
    assert!(AccountSnapshot {
        margin: "-1".into(),
        ..account.clone()
    }
    .validate()
    .is_err());
    assert!(AccountSnapshot {
        balance: "-1".into(),
        ..account
    }
    .validate()
    .is_ok());
}

#[test]
fn order_submit_accepts_stop_limit_and_time_in_force_and_rejects_bad_combinations() {
    // Absent fields are today's request: valid and byte-compatible.
    let absent = order_submit_request();
    absent.validate().unwrap();
    let absent_json = serde_json::to_string(&absent).unwrap();
    assert!(
        !absent_json.contains("time_in_force") && !absent_json.contains("limit_price"),
        "absent optional fields must not appear on the wire: {absent_json}"
    );

    // Every allowed time-in-force validates on any kind.
    for time_in_force in ["gtc", "day", "ioc", "fok"] {
        assert!(
            OrderSubmitRequest {
                time_in_force: Some(time_in_force.into()),
                ..order_submit_request()
            }
            .validate()
            .is_ok(),
            "{time_in_force} must be accepted"
        );
    }
    // Unknown time-in-force values are rejected with a clear message.
    assert_eq!(
        OrderSubmitRequest {
            time_in_force: Some("GTC".into()),
            ..order_submit_request()
        }
        .validate(),
        Err("time_in_force must be gtc, day, ioc, or fok")
    );
    assert!(OrderSubmitRequest {
        time_in_force: Some("gtc ".into()),
        ..order_submit_request()
    }
    .validate()
    .is_err());

    // stop_limit requires a well-formed positive limit_price.
    let stop_limit = OrderSubmitRequest {
        order_kind: "stop_limit".into(),
        limit_price: Some("25010.0".into()),
        ..order_submit_request()
    };
    stop_limit.clone().validate().unwrap();
    assert_eq!(
        OrderSubmitRequest {
            order_kind: "stop_limit".into(),
            limit_price: None,
            ..order_submit_request()
        }
        .validate(),
        Err("stop_limit requires limit_price (resting limit price)")
    );
    for bad in ["0", "-1", "1e3", "abc"] {
        assert_eq!(
            OrderSubmitRequest {
                limit_price: Some(bad.into()),
                ..stop_limit.clone()
            }
            .validate(),
            Err("limit_price must be a positive decimal"),
            "{bad} must be rejected as limit_price"
        );
    }

    // limit_price on the other kinds is ignored, but a malformed value is
    // still rejected; an unknown order kind never reaches the new rules.
    assert!(OrderSubmitRequest {
        limit_price: Some("25010.0".into()),
        ..order_submit_request()
    }
    .validate()
    .is_ok());
    assert_eq!(
        OrderSubmitRequest {
            limit_price: Some("nope".into()),
            ..order_submit_request()
        }
        .validate(),
        Err("limit_price must be a positive decimal")
    );

    // Round-trip of the new fields stays snake_case.
    let value = serde_json::to_value(&stop_limit).unwrap();
    assert_eq!(value["order_kind"], "stop_limit");
    assert_eq!(value["limit_price"], "25010.0");
    assert!(value.get("time_in_force").is_none());
    let mut with_tif = stop_limit;
    with_tif.time_in_force = Some("ioc".into());
    let value = serde_json::to_value(&with_tif).unwrap();
    assert_eq!(value["time_in_force"], "ioc");
    let parsed: OrderSubmitRequest = serde_json::from_value(value).unwrap();
    parsed.validate().unwrap();
}

#[test]
fn order_check_preflight_accepts_stop_limit_and_time_in_force_with_echo_rules() {
    let request = OrderCheckRequest {
        order_kind: OrderKind::StopLimit,
        limit_price: Some("1.1010".into()),
        time_in_force: Some(TimeInForce::Ioc),
        ..order_check_request_for_test()
    };
    request.validate().unwrap();

    // stop_limit without a limit_price is rejected with a clear message.
    assert_eq!(
        OrderCheckRequest {
            limit_price: None,
            ..request.clone()
        }
        .validate(),
        Err("stop_limit requires limit_price (resting limit price)")
    );
    // A malformed limit_price is rejected on every kind.
    assert_eq!(
        OrderCheckRequest {
            limit_price: Some("-2".into()),
            ..request.clone()
        }
        .validate(),
        Err("limit_price must be a positive decimal")
    );
    // Unknown time-in-force values never deserialize from the wire.
    assert!(
        serde_json::from_value::<OrderCheckRequest>(serde_json::json!({
            "draft_id": "d", "account_login": "1", "broker_server": "s",
            "symbol": "EURUSD", "side": "buy", "order_kind": "stop_limit",
            "volume": "0.1", "entry": "1.1", "stop_loss": "1.0",
            "take_profit": null, "limit_price": "1.2", "time_in_force": "soon"
        }))
        .is_err()
    );

    let mut result = order_check_result_for_test();
    result.order_kind = OrderKind::StopLimit;
    result.limit_price = Some("1.1010".into());
    result.time_in_force = Some(TimeInForce::Ioc);
    result.validate(&request).unwrap();
    // The result must echo the draft's new fields exactly.
    assert_eq!(
        OrderCheckResult {
            time_in_force: Some(TimeInForce::Fok),
            ..result.clone()
        }
        .validate(&request),
        Err("order check mismatch")
    );
    assert_eq!(
        OrderCheckResult {
            limit_price: Some("1.1011".into()),
            ..result.clone()
        }
        .validate(&request),
        Err("order check mismatch")
    );
    // Absent-on-both-sides stays valid: an old-style result (defaults)
    // against an old-style request is byte-for-byte today's contract.
    let plain_request = order_check_request_for_test();
    let plain_result = order_check_result_for_test();
    plain_result.validate(&plain_request).unwrap();
    assert!(plain_result.time_in_force.is_none());
    assert!(plain_result.limit_price.is_none());
    // Mirror of the submit test: absent optional fields never appear on
    // the wire, so the request payload is byte-compatible with today's.
    plain_request.validate().unwrap();
    let plain_json = serde_json::to_string(&plain_request).unwrap();
    assert!(
        !plain_json.contains("time_in_force") && !plain_json.contains("limit_price"),
        "absent optional fields must not appear on the wire: {plain_json}"
    );
}

fn order_check_request_for_test() -> OrderCheckRequest {
    OrderCheckRequest {
        draft_id: "draft-echo".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "EURUSD".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Limit,
        volume: "0.10".into(),
        entry: "1.1000".into(),
        stop_loss: Some("1.0900".into()),
        take_profit: Some("1.1200".into()),
        time_in_force: None,
        limit_price: None,
    }
}

fn order_check_result_for_test() -> OrderCheckResult {
    OrderCheckResult {
        draft_id: "draft-echo".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "EURUSD".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Limit,
        volume: "0.10".into(),
        requested_entry: "1.1000".into(),
        check_price: "1.1000".into(),
        stop_loss: Some("1.0900".into()),
        take_profit: Some("1.1200".into()),
        check_passed: true,
        retcode: 0,
        last_error: 0,
        balance: "1000".into(),
        equity: "1000".into(),
        profit: "0".into(),
        margin: "10".into(),
        free_margin: "990".into(),
        margin_level: "10000".into(),
        comment: "done".into(),
        checked_at_ms: 2,
        time_in_force: None,
        limit_price: None,
    }
}

#[test]
fn stop_limit_protective_geometry_uses_resting_price() {
    for (side, resting, take) in [
        (OrderSide::Buy, "1.0800", "1.0900"),
        (OrderSide::Sell, "1.1400", "1.1300"),
    ] {
        let mut request = order_check_request_for_test();
        request.side = side;
        request.order_kind = OrderKind::StopLimit;
        request.stop_loss = None;
        request.limit_price = Some(resting.into());
        request.take_profit = Some(take.into());
        request.validate().unwrap();
        request.take_profit = Some(resting.into());
        assert!(request.validate().is_err());
        request.take_profit = Some(
            if side == OrderSide::Buy {
                "1.0700"
            } else {
                "1.1500"
            }
            .into(),
        );
        assert!(request.validate().is_err());
    }
}

#[test]
fn stop_loss_is_optional_on_check_and_submit_and_present_payloads_stay_byte_stable() {
    // Absent = no stop loss: valid, and every SL-specific rule is skipped.
    let mut request = order_check_request_for_test();
    request.stop_loss = None;
    request.validate().unwrap();
    // Present keeps the original directional rules (a buy SL must stay
    // below entry — entry here is 1.1000).
    let mut bad = request.clone();
    bad.stop_loss = Some("1.2000".into());
    assert_eq!(bad.validate(), Err("invalid buy geometry"));
    // `null` on the wire deserializes to the same absent value.
    let mut null_json = serde_json::to_value(order_check_request_for_test()).unwrap();
    null_json["stop_loss"] = serde_json::Value::Null;
    let parsed: OrderCheckRequest = serde_json::from_value(null_json).unwrap();
    assert_eq!(parsed.stop_loss, None);
    parsed.validate().unwrap();
    // The key-missing spelling ("brak pola") parses identically to null.
    let mut missing_json = serde_json::to_value(order_check_request_for_test()).unwrap();
    missing_json
        .as_object_mut()
        .expect("object payload")
        .remove("stop_loss");
    let parsed_missing: OrderCheckRequest = serde_json::from_value(missing_json).unwrap();
    assert_eq!(parsed_missing.stop_loss, None);
    parsed_missing.validate().unwrap();
    // A present payload serializes byte-identically to the required-field era…
    let present = serde_json::to_string(&order_check_request_for_test()).unwrap();
    assert!(
        present.contains("\"stop_loss\":\"1.0900\""),
        "present stop_loss must keep its spelling: {present}"
    );
    // …while an absent one is an explicit null.
    let absent = serde_json::to_string(&request).unwrap();
    assert!(absent.contains("\"stop_loss\":null"), "{absent}");

    // Same rules on the submit path.
    assert!(OrderSubmitRequest {
        stop_loss: None,
        ..order_submit_request()
    }
    .validate()
    .is_ok());
    assert!(OrderSubmitRequest {
        stop_loss: Some("NaN".into()),
        ..order_submit_request()
    }
    .validate()
    .is_err());

    // The min-distance preflight skips a missing level entirely and still
    // checks the level that is present.
    let bid = "30459.64".parse::<Decimal>().unwrap();
    let ask = "30460.64".parse::<Decimal>().unwrap();
    let point = "0.01".parse::<Decimal>().unwrap();
    let tick = "0.01".parse::<Decimal>().unwrap();
    assert_eq!(
        validate_stop_distances(OrderSide::Buy, None, None, 0, point, tick, bid, ask),
        Ok(())
    );
    let close_tp = "30460.80".parse::<Decimal>().unwrap();
    assert_eq!(
        validate_stop_distances(
            OrderSide::Buy,
            None,
            Some(close_tp),
            0,
            point,
            tick,
            bid,
            ask
        ),
        Err("take_profit too close: distance 0.16, required >= 0.20 (20 ticks margin)".into())
    );
}

#[test]
fn account_snapshot_tolerates_old_eas_and_round_trips_the_trade_mode() {
    // A payload from an older EA carries neither field: it parses to the
    // documented sentinel (-1 / "unknown") and still validates.
    let old = serde_json::json!({
        "account_login": "123", "broker_server": "Demo", "currency": "USD",
        "balance": "100", "equity": "99", "margin": "1", "free_margin": "98",
        "margin_level": "9900", "leverage": 100, "margin_mode": 0,
        "trade_allowed": true, "expert_allowed": true
    });
    let parsed: AccountSnapshot = serde_json::from_value(old).unwrap();
    assert_eq!(parsed.account_trade_mode, -1);
    assert_eq!(parsed.account_trade_mode_name, "unknown");
    parsed.validate().unwrap();

    // A new payload round-trips both fields untouched.
    let account = AccountSnapshot {
        account_trade_mode: 1,
        account_trade_mode_name: "contest".into(),
        ..parsed
    };
    account.validate().unwrap();
    let encoded = serde_json::to_value(&account).unwrap();
    assert_eq!(encoded["account_trade_mode"], 1);
    assert_eq!(encoded["account_trade_mode_name"], "contest");
    assert_eq!(
        serde_json::from_value::<AccountSnapshot>(encoded).unwrap(),
        account
    );

    // Unknown raw values still keep the recognized-name vocabulary.
    let unknown = AccountSnapshot {
        account_trade_mode: 42,
        account_trade_mode_name: "unknown".into(),
        ..account.clone()
    };
    unknown.validate().unwrap();
    assert!(AccountSnapshot {
        account_trade_mode_name: "demo-ish".into(),
        ..account
    }
    .validate()
    .is_err());
}

#[test]
fn validates_portfolio_limits_and_unique_ids() {
    let position = OpenPosition {
        position_id: "p1".into(),
        ticket: "t1".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        volume: "1".into(),
        price_open: "10".into(),
        price_current: "11".into(),
        stop_loss: None,
        take_profit: Some("12".into()),
        profit: "1".into(),
        swap: "0".into(),
        time_ms: 1,
        magic: "m".into(),
    };
    let snapshot = PortfolioSnapshot {
        account_login: "a".into(),
        captured_at_ms: 1,
        positions: vec![position.clone()],
        orders: vec![],
    };
    assert!(snapshot.validate().is_ok());
    assert!(PortfolioSnapshot {
        positions: vec![position.clone(), position],
        ..snapshot
    }
    .validate()
    .is_err());
}

#[test]
fn risk_quote_validates_non_negative_margin_for_its_reference_volume() {
    let request = RiskQuoteRequest {
        draft_id: "draft".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        entry: "100".into(),
        stop_loss: "90".into(),
        take_profit: Some("120".into()),
    };
    let result = RiskQuoteResult {
        draft_id: "draft".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        entry: "100".into(),
        stop_loss: "90".into(),
        take_profit: Some("120".into()),
        reference_volume: "1".into(),
        loss_at_reference: "240".into(),
        reward_at_reference: Some("480".into()),
        margin_at_reference: "1200".into(),
        currency: "USD".into(),
        tick_size: "0.1".into(),
        volume_min: "0.01".into(),
        volume_max: "10".into(),
        volume_step: "0.01".into(),
        quoted_at_ms: 1,
    };
    assert!(result.validate(&request).is_ok());
    assert!(RiskQuoteResult {
        margin_at_reference: "0".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_ok());
    assert!(RiskQuoteResult {
        margin_at_reference: "-1".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(RiskQuoteResult {
        margin_at_reference: "NaN".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(RiskQuoteResult {
        reference_volume: "1.005".into(),
        ..result
    }
    .validate(&request)
    .is_err());
}

#[test]
fn order_check_requires_valid_prices_and_exact_request_identity() {
    let request = OrderCheckRequest {
        draft_id: "draft-1".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "EURUSD".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Limit,
        volume: "0.10".into(),
        entry: "1.1000".into(),
        stop_loss: Some("1.0900".into()),
        take_profit: Some("1.1200".into()),
        time_in_force: None,
        limit_price: None,
    };
    let result = OrderCheckResult {
        draft_id: "draft-1".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "EURUSD".into(),
        side: OrderSide::Buy,
        order_kind: OrderKind::Limit,
        volume: "0.10".into(),
        requested_entry: "1.1000".into(),
        check_price: "1.1000".into(),
        stop_loss: Some("1.0900".into()),
        take_profit: Some("1.1200".into()),
        check_passed: true,
        retcode: 0,
        last_error: 0,
        balance: "1000".into(),
        equity: "1000".into(),
        profit: "0".into(),
        margin: "10".into(),
        free_margin: "990".into(),
        margin_level: "10000".into(),
        comment: "done".into(),
        checked_at_ms: 2,
        time_in_force: None,
        limit_price: None,
    };
    request.validate().unwrap();
    result.validate(&request).unwrap();
    assert!(OrderCheckRequest {
        stop_loss: Some(String::new()),
        ..request.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCheckRequest {
        volume: "NaN".into(),
        ..request.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCheckResult {
        account_login: "456".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(OrderCheckResult {
        requested_entry: "1.1001".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(OrderCheckResult {
        check_price: "0".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(OrderCheckResult {
        margin: "-1".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(OrderCheckResult {
        equity: "-1".into(),
        free_margin: "-2".into(),
        margin_level: "-100".into(),
        ..result.clone()
    }
    .validate(&request)
    .is_ok());
    assert!(OrderCheckResult {
        checked_at_ms: -1,
        ..result.clone()
    }
    .validate(&request)
    .is_err());
    assert!(OrderCheckResult {
        comment: "x".repeat(257),
        ..result
    }
    .validate(&request)
    .is_err());
}

#[test]
fn order_check_error_is_bound_to_its_draft() {
    let request = OrderCheckRequest {
        draft_id: "draft-2".into(),
        account_login: "123".into(),
        broker_server: "Demo".into(),
        symbol: "EURUSD".into(),
        side: OrderSide::Sell,
        order_kind: OrderKind::Market,
        volume: "1".into(),
        entry: "1.2".into(),
        stop_loss: Some("1.3".into()),
        take_profit: None,
        time_in_force: None,
        limit_price: None,
    };
    let error = OrderCheckError {
        draft_id: "draft-2".into(),
        code: "unavailable".into(),
        message: "no quote".into(),
    };
    assert!(error.validate(&request).is_ok());
    assert!(OrderCheckError {
        draft_id: "stale".into(),
        ..error
    }
    .validate(&request)
    .is_err());
}

fn reconcile_request() -> ReconcileRequest {
    ReconcileRequest {
        request_id: "reconcile-1".into(),
        account_login: "12345678".into(),
        broker_server: "Demo".into(),
        history_from_ms: 100,
        max_history_orders: 2,
        max_history_deals: 2,
    }
}

fn reconcile_snapshot() -> ReconcileSnapshot {
    ReconcileSnapshot {
        request_id: "reconcile-1".into(),
        account_login: "12345678".into(),
        broker_server: "Demo".into(),
        snapshot_id: "snapshot-1".into(),
        history_from_ms: 100,
        history_to_ms: 200,
        sequence_before: 4,
        sequence_after: 4,
        complete: true,
        captured_at_ms: 200,
        positions: vec![],
        active_orders: vec![],
        history_orders: vec![HistoryOrder {
            order_id: "o1".into(),
            position_id: Some("p1".into()),
            time_setup_ms: 110,
            time_done_ms: 120,
            symbol: "NAS100".into(),
            magic: "42".into(),
            order_type: "buy".into(),
            state: "filled".into(),
            volume_initial: "0.1".into(),
            volume_current: "0".into(),
            price_open: "10".into(),
            price_current: "0".into(),
            stop_loss: None,
            take_profit: None,
            comment: None,
        }],
        history_deals: vec![HistoryDeal {
            deal_id: "d1".into(),
            order_id: "o1".into(),
            position_id: Some("p1".into()),
            time_ms: 120,
            symbol: "NAS100".into(),
            magic: "42".into(),
            deal_type: "buy".into(),
            entry: "in".into(),
            volume: "0.1".into(),
            price: "10".into(),
            profit: "-1.25".into(),
            commission: "-0.2".into(),
            swap: "0".into(),
            fee: "0".into(),
            comment: None,
        }],
    }
}

#[test]
fn reconciliation_message_types_serialize_snake_case() {
    assert_eq!(
        serde_json::to_string(&MessageType::ReconcileRequest).unwrap(),
        "\"reconcile_request\""
    );
    assert_eq!(
        serde_json::to_string(&MessageType::ReconcileSnapshot).unwrap(),
        "\"reconcile_snapshot\""
    );
    assert_eq!(
        serde_json::to_string(&MessageType::ReconcileError).unwrap(),
        "\"reconcile_error\""
    );
    let value = serde_json::to_value(reconcile_request()).unwrap();
    assert!(value.get("request_id").is_some());
    assert!(value.get("max_history_orders").is_some());
    assert!(value.get("historyFromMs").is_none());
    let snapshot = serde_json::to_value(reconcile_snapshot()).unwrap();
    assert!(snapshot.get("history_from_ms").is_some());
    assert!(snapshot.get("active_orders").is_some());
    assert!(snapshot.get("history_orders").is_some());
}

#[test]
fn reconciliation_validates_limits_duplicates_and_ranges() {
    let request = reconcile_request();
    assert!(request.validate().is_ok());
    assert!(ReconcileRequest {
        max_history_orders: 0,
        ..request.clone()
    }
    .validate()
    .is_err());
    assert!(ReconcileRequest {
        max_history_deals: 1001,
        ..request.clone()
    }
    .validate()
    .is_err());
    assert!(ReconcileSnapshot {
        history_orders: vec![
            reconcile_snapshot().history_orders[0].clone(),
            reconcile_snapshot().history_orders[0].clone(),
            reconcile_snapshot().history_orders[0].clone(),
        ],
        ..reconcile_snapshot()
    }
    .validate(&request)
    .is_err());
    assert!(ReconcileSnapshot {
        history_deals: vec![
            reconcile_snapshot().history_deals[0].clone(),
            reconcile_snapshot().history_deals[0].clone(),
        ],
        ..reconcile_snapshot()
    }
    .validate(&request)
    .is_err());
    assert!(ReconcileSnapshot {
        history_from_ms: 99,
        ..reconcile_snapshot()
    }
    .validate(&request)
    .is_err());
}

#[test]
fn reconciliation_complete_requires_stable_sequence() {
    let request = reconcile_request();
    let snapshot = reconcile_snapshot();
    assert!(snapshot.validate(&request).is_ok());
    assert!(ReconcileSnapshot {
        sequence_after: 5,
        ..snapshot.clone()
    }
    .validate(&request)
    .is_err());
    assert!(ReconcileSnapshot {
        sequence_after: 5,
        complete: false,
        ..snapshot.clone()
    }
    .validate(&request)
    .is_ok());
    assert!(ReconcileSnapshot {
        sequence_before: 5,
        sequence_after: 4,
        complete: false,
        ..snapshot
    }
    .validate(&request)
    .is_err());
}

#[test]
fn reconciliation_allows_order_setup_before_requested_history_window() {
    let request = reconcile_request();
    let snapshot = reconcile_snapshot();
    let mut order = snapshot.history_orders[0].clone();
    order.time_setup_ms = 90;
    order.time_done_ms = 120;
    assert!(ReconcileSnapshot {
        history_orders: vec![order],
        ..snapshot
    }
    .validate(&request)
    .is_ok());
}

#[test]
fn reconciliation_rejects_signed_non_financial_decimals_and_accepts_signed_cashflows() {
    let request = reconcile_request();
    let snapshot = reconcile_snapshot();
    assert!(snapshot.validate(&request).is_ok());
    assert!(ReconcileSnapshot {
        history_orders: vec![HistoryOrder {
            volume_initial: "-0".into(),
            ..snapshot.history_orders[0].clone()
        }],
        ..snapshot.clone()
    }
    .validate(&request)
    .is_err());
    assert!(ReconcileSnapshot {
        history_deals: vec![HistoryDeal {
            price: "-10".into(),
            ..snapshot.history_deals[0].clone()
        }],
        ..snapshot.clone()
    }
    .validate(&request)
    .is_err());
    assert!(ReconcileSnapshot {
        history_deals: vec![HistoryDeal {
            fee: "NaN".into(),
            ..snapshot.history_deals[0].clone()
        }],
        ..snapshot
    }
    .validate(&request)
    .is_err());
}

fn order_submit_request() -> OrderSubmitRequest {
    OrderSubmitRequest {
        command_id: "cmd-7f3a9c2e".into(),
        draft_id: "draft-12-9".into(),
        account_login: "12345678".into(),
        broker_server: "Broker-Demo".into(),
        symbol: "NAS100".into(),
        side: "buy".into(),
        order_kind: "limit".into(),
        volume: "0.10".into(),
        entry: "25000.0".into(),
        stop_loss: Some("24950.0".into()),
        take_profit: Some("25100.0".into()),
        time_in_force: None,
        limit_price: None,
    }
}

fn order_command_update() -> OrderCommandUpdate {
    OrderCommandUpdate {
        command_id: "cmd-7f3a9c2e".into(),
        status: "server_accepted".into(),
        retcode: Some(10009),
        last_error: Some(0),
        broker_order_id: Some("7005".into()),
        deal_id: None,
        position_id: None,
        filled_volume: None,
        message: Some("pending order placed".into()),
        updated_at_ms: 1770000001980,
        at_update: 2,
    }
}

#[test]
fn identity_ids_are_bounded_in_utf8_bytes_not_chars() {
    // 100 two-byte chars = 200 UTF-8 bytes: over the 128-byte id bound.
    assert!(OrderSubmitRequest {
        command_id: "ä".repeat(100),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    // A 128-byte ASCII id and symbol stay within the bound.
    assert!(OrderSubmitRequest {
        command_id: "a".repeat(128),
        symbol: "b".repeat(128),
        ..order_submit_request()
    }
    .validate()
    .is_ok());
    // The symbol bound is bytes everywhere: 70 two-byte chars = 140 bytes.
    assert!(OrderSubmitRequest {
        symbol: "ä".repeat(70),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        command_id: "a".repeat(129),
        ..order_submit_request()
    }
    .validate()
    .is_err());
}

#[test]
fn order_submit_validates_identity_enums_and_positive_decimals() {
    order_submit_request().validate().unwrap();
    assert!(OrderSubmitRequest {
        side: "hold".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        order_kind: "trailing".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        volume: "0".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        entry: "NaN".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        stop_loss: Some("-1".into()),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        take_profit: Some("0".into()),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        command_id: "".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        command_id: " cmd-1".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        draft_id: "x".repeat(129),
        ..order_submit_request()
    }
    .validate()
    .is_err());
    assert!(OrderSubmitRequest {
        symbol: " ".into(),
        ..order_submit_request()
    }
    .validate()
    .is_err());
}

#[test]
fn order_modify_close_cancel_validate_target_rules_and_bounds() {
    let modify = OrderModifyRequest {
        command_id: "cmd-7f3a9c2f".into(),
        account_login: "12345678".into(),
        broker_server: "Broker-Demo".into(),
        target_kind: "pending_order".into(),
        target_id: "7001".into(),
        stop_loss: Some("24940.0".into()),
        take_profit: Some("25100.0".into()),
        price: Some("24980.0".into()),
    };
    modify.validate().unwrap();
    assert!(OrderModifyRequest {
        target_kind: "position".into(),
        ..modify.clone()
    }
    .validate()
    .is_err());
    // pin: `Some` sets the level, `null` leaves it unchanged, and "0" is
    // the explicit REMOVE sentinel (MT5 clears a stop at price 0).
    assert!(OrderModifyRequest {
        stop_loss: None,
        take_profit: Some("25100.0".into()),
        price: None,
        ..modify.clone()
    }
    .validate()
    .is_ok());
    assert!(OrderModifyRequest {
        stop_loss: Some("24940.0".into()),
        take_profit: None,
        price: None,
        ..modify.clone()
    }
    .validate()
    .is_ok());
    assert!(OrderModifyRequest {
        stop_loss: None,
        take_profit: None,
        price: None,
        ..modify.clone()
    }
    .validate()
    .is_err());
    assert!(OrderModifyRequest {
        stop_loss: Some("0".into()),
        take_profit: None,
        price: None,
        ..modify.clone()
    }
    .validate()
    .is_ok());
    assert!(OrderModifyRequest {
        stop_loss: None,
        take_profit: Some("0".into()),
        price: None,
        ..modify.clone()
    }
    .validate()
    .is_ok());
    assert!(OrderModifyRequest {
        stop_loss: Some("-1.0".into()),
        take_profit: None,
        price: None,
        ..modify.clone()
    }
    .validate()
    .is_err());
    assert!(OrderModifyRequest {
        target_kind: "order".into(),
        ..modify.clone()
    }
    .validate()
    .is_err());
    assert!(OrderModifyRequest {
        target_id: " ".into(),
        ..modify
    }
    .validate()
    .is_err());

    let close = OrderCloseRequest {
        command_id: "cmd-7f3a9c30".into(),
        account_login: "12345678".into(),
        broker_server: "Broker-Demo".into(),
        position_id: "9001".into(),
        volume: None,
    };
    close.validate().unwrap();
    assert!(OrderCloseRequest {
        volume: Some("0.10".into()),
        ..close.clone()
    }
    .validate()
    .is_ok());
    assert!(OrderCloseRequest {
        volume: Some("0".into()),
        ..close.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCloseRequest {
        volume: Some("NaN".into()),
        ..close.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCloseRequest {
        position_id: "".into(),
        ..close
    }
    .validate()
    .is_err());

    let cancel = OrderCancelRequest {
        command_id: "cmd-7f3a9c31".into(),
        account_login: "12345678".into(),
        broker_server: "Broker-Demo".into(),
        order_id: "7001".into(),
    };
    cancel.validate().unwrap();
    assert!(OrderCancelRequest {
        order_id: " ".into(),
        ..cancel.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCancelRequest {
        command_id: "x".repeat(129),
        ..cancel
    }
    .validate()
    .is_err());
}

#[test]
fn order_command_update_and_error_validate_status_and_bounds() {
    order_command_update().validate().unwrap();
    for status in [
        "accepted",
        "dispatching",
        "server_accepted",
        "partially_filled",
        "filled",
        "rejected",
        "unknown",
    ] {
        assert!(OrderCommandUpdate {
            status: status.into(),
            ..order_command_update()
        }
        .validate()
        .is_ok());
    }
    assert!(OrderCommandUpdate {
        status: "Pending".into(),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        filled_volume: Some("0.05".into()),
        ..order_command_update()
    }
    .validate()
    .is_ok());
    assert!(OrderCommandUpdate {
        filled_volume: Some("0".into()),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        filled_volume: Some("-1".into()),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        message: Some("x".repeat(257)),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        message: Some(" padded ".into()),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        updated_at_ms: -1,
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        broker_order_id: Some("x".repeat(129)),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        deal_id: Some("".into()),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        position_id: Some(" pos-1".into()),
        ..order_command_update()
    }
    .validate()
    .is_err());
    assert!(OrderCommandUpdate {
        command_id: "x".repeat(129),
        ..order_command_update()
    }
    .validate()
    .is_err());

    let error = OrderCommandError {
        command_id: "cmd-7f3a9c30".into(),
        code: "JOURNAL_UNAVAILABLE".into(),
        message: "unable to write command journal".into(),
    };
    // valid: the code comes from the contract whitelist.
    error.validate().unwrap();
    for code in [
        "UNKNOWN_COMMAND",
        "DUPLICATE_CONFLICT",
        "PREFLIGHT_FAILED",
        "INVALID_REQUEST",
        "BROKER_UNAVAILABLE",
        "JOURNAL_UNAVAILABLE",
    ] {
        assert!(OrderCommandError {
            code: code.into(),
            ..error.clone()
        }
        .validate()
        .is_ok());
    }
    // unknown codes are rejected even when they fit the 64-char bound.
    assert!(OrderCommandError {
        code: "NOT_A_CONTRACT_CODE".into(),
        ..error.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCommandError {
        code: "".into(),
        ..error.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCommandError {
        code: "x".repeat(65),
        ..error.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCommandError {
        message: " x".into(),
        ..error.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCommandError {
        message: "x".repeat(257),
        ..error.clone()
    }
    .validate()
    .is_err());
    assert!(OrderCommandError {
        command_id: "x".repeat(129),
        ..error
    }
    .validate()
    .is_err());
}

#[test]
fn order_command_message_types_and_payloads_serialize_snake_case() {
    for (message_type, expected) in [
        (MessageType::OrderSubmitRequest, "order_submit_request"),
        (MessageType::OrderModifyRequest, "order_modify_request"),
        (MessageType::OrderCloseRequest, "order_close_request"),
        (MessageType::OrderCancelRequest, "order_cancel_request"),
        (MessageType::OrderCommandUpdate, "order_command_update"),
        (MessageType::OrderCommandError, "order_command_error"),
    ] {
        assert_eq!(
            serde_json::to_string(&message_type).unwrap(),
            format!("\"{expected}\"")
        );
    }

    // Payload fields follow the existing wire convention of the other
    // command payloads: Rust snake_case names, never camelCase.
    let submit = serde_json::to_value(order_submit_request()).unwrap();
    assert!(submit.get("command_id").is_some());
    assert!(submit.get("commandId").is_none());
    assert!(submit.get("order_kind").is_some());
    assert!(submit.get("take_profit").is_some());
    let parsed: OrderSubmitRequest = serde_json::from_value(submit).unwrap();
    parsed.validate().unwrap();

    let update = serde_json::to_value(order_command_update()).unwrap();
    assert!(update.get("updated_at_ms").is_some());
    assert!(update.get("at_update").is_some());
    assert!(update.get("updatedAtMs").is_none());
    assert!(update.get("broker_order_id").is_some());
    let parsed: OrderCommandUpdate = serde_json::from_value(update).unwrap();
    parsed.validate().unwrap();

    let error = serde_json::to_value(OrderCommandError {
        command_id: "cmd-1".into(),
        code: "UNKNOWN_COMMAND".into(),
        message: "no such command".into(),
    })
    .unwrap();
    assert!(error.get("command_id").is_some());
    let parsed: OrderCommandError = serde_json::from_value(error).unwrap();
    parsed.validate().unwrap();
}

#[test]
fn heartbeat_market_session_is_optional_and_validated() {
    // A legacy EA omits `market_session`: the heartbeat still parses and Rust
    // treats the session as unknown (fail closed at the execution gate).
    let legacy: HeartbeatPayload = serde_json::from_value(serde_json::json!({
        "sequence": 1,
        "terminal_connected": true,
        "account_connected": true,
        "broker_server": "Broker-Demo",
    }))
    .unwrap();
    assert!(legacy.market_session.is_none());

    let observed: HeartbeatPayload = serde_json::from_value(serde_json::json!({
        "sequence": 2,
        "terminal_connected": true,
        "account_connected": true,
        "broker_server": "Broker-Demo",
        "market_session": {
            "symbol": "NAS100",
            "is_open": false,
            "trade_mode": 4,
            "server_time_ms": 1_770_000_000_000_i64,
        },
    }))
    .unwrap();
    let session = observed.market_session.expect("market_session parsed");
    assert_eq!(session.symbol, "NAS100");
    assert!(!session.is_open);
    assert_eq!(session.trade_mode, 4);
    assert_eq!(session.server_time_ms, 1_770_000_000_000);
    session.validate().unwrap();

    let mut blank_symbol = session.clone();
    blank_symbol.symbol = "   ".into();
    assert!(blank_symbol.validate().is_err());
    let mut negative_time = session;
    negative_time.server_time_ms = -1;
    assert!(negative_time.validate().is_err());
}
