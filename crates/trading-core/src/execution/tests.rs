use super::*;

fn intent(command_id: &str) -> ExecutionIntent {
    ExecutionIntent::new(
        command_id,
        "001234",
        "Broker-Demo",
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "EURUSD".into(),
            side: OrderSide::Buy,
            kind: OrderKind::Limit,
            volume: "0.10".into(),
            entry: "1.1000".into(),
            stop_loss: Some("1.0900".into()),
            take_profit: Some("1.1200".into()),
            time_in_force: None,
            limit_price: None,
        }),
    )
    .unwrap()
}

#[test]
fn validates_order_fields_and_directional_stops() {
    let ExecutionOperation::PlaceOrder(mut order) = intent("a").operation else {
        panic!("test intent must be a place order");
    };
    order.volume = "0".into();
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::InvalidDecimal("volume"))
    ));
    order.volume = "0.1".into();
    order.stop_loss = Some("1.1000".into());
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::InvalidField(_))
    ));
    order.stop_loss = Some("1.0900".into());
    order.take_profit = Some("NaN".into());
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::InvalidDecimal("take_profit"))
    ));
}

#[test]
fn registration_is_idempotent_and_conflicts_on_payload_change() {
    let mut registry = ExecutionRegistry::new();
    let first = registry.register(intent("same"), 1).unwrap().clone();
    let duplicate = registry.register(intent("same"), 99).unwrap();
    assert_eq!(duplicate, &first);
    assert_eq!(duplicate.events()[0].at_ms, 1);
    let mut changed = intent("same");
    let ExecutionOperation::PlaceOrder(order) = &mut changed.operation else {
        panic!("changed intent must be a place order");
    };
    order.volume = "0.20".into();
    assert_eq!(
        registry.register(changed, 2),
        Err(ExecutionError::CommandIdConflict("same".into()))
    );
    assert_eq!(registry.len(), 1);
    assert_eq!(
        registry.get("same").unwrap().state(),
        ExecutionState::Prepared
    );
}

#[test]
fn accepts_forward_lifecycle_and_rejects_rewind_or_terminal_change() {
    let mut registry = ExecutionRegistry::new();
    registry.register(intent("flow"), 0).unwrap();
    for state in [
        ExecutionState::Validated,
        ExecutionState::Dispatching,
        ExecutionState::ServerAccepted,
        ExecutionState::PartiallyFilled,
        ExecutionState::Filled,
    ] {
        registry
            .transition("flow", ExecutionEvent::new(1, state))
            .unwrap();
    }
    assert_eq!(registry.get("flow").unwrap().events().len(), 6);
    assert_eq!(
        registry.transition("flow", ExecutionEvent::new(2, ExecutionState::Dispatching)),
        Err(ExecutionError::InvalidTransition {
            from: ExecutionState::Filled,
            to: ExecutionState::Dispatching
        })
    );
    assert_eq!(
        registry.get("flow").unwrap().state(),
        ExecutionState::Filled
    );
}

#[test]
fn unknown_can_only_be_resolved_from_broker_evidence() {
    let mut registry = ExecutionRegistry::new();
    registry.register(intent("uncertain"), 0).unwrap();
    registry
        .transition(
            "uncertain",
            ExecutionEvent::new(1, ExecutionState::Validated),
        )
        .unwrap();
    registry
        .transition(
            "uncertain",
            ExecutionEvent::new(2, ExecutionState::Dispatching),
        )
        .unwrap();
    registry
        .transition("uncertain", ExecutionEvent::new(3, ExecutionState::Unknown))
        .unwrap();
    assert_eq!(
        registry.transition(
            "uncertain",
            ExecutionEvent::new(4, ExecutionState::Dispatching)
        ),
        Err(ExecutionError::InvalidTransition {
            from: ExecutionState::Unknown,
            to: ExecutionState::Dispatching
        })
    );
    assert_eq!(
        registry.transition(
            "uncertain",
            ExecutionEvent::new(5, ExecutionState::ServerAccepted)
        ),
        Err(ExecutionError::MissingBrokerEvidence)
    );
    registry
        .transition(
            "uncertain",
            ExecutionEvent::new(5, ExecutionState::ServerAccepted)
                .with_result(Some(10009), Some("accepted".into()))
                .unwrap(),
        )
        .unwrap();
}

#[test]
fn timestamps_are_monotonic_and_partial_fill_cannot_be_rejected() {
    let mut registry = ExecutionRegistry::new();
    registry.register(intent("monotonic"), 10).unwrap();
    assert_eq!(
        registry.transition(
            "monotonic",
            ExecutionEvent::new(9, ExecutionState::Validated)
        ),
        Err(ExecutionError::TimestampRegression {
            previous: 10,
            next: 9
        })
    );
    registry
        .transition(
            "monotonic",
            ExecutionEvent::new(10, ExecutionState::Validated),
        )
        .unwrap();
    registry
        .transition(
            "monotonic",
            ExecutionEvent::new(11, ExecutionState::Dispatching),
        )
        .unwrap();
    registry
        .transition(
            "monotonic",
            ExecutionEvent::new(12, ExecutionState::PartiallyFilled),
        )
        .unwrap();
    assert!(matches!(
        registry.transition(
            "monotonic",
            ExecutionEvent::new(13, ExecutionState::Rejected)
        ),
        Err(ExecutionError::InvalidTransition {
            from: ExecutionState::PartiallyFilled,
            to: ExecutionState::Rejected
        })
    ));
}

#[test]
fn identity_and_result_text_reject_whitespace_and_control_characters() {
    assert!(matches!(
        ExecutionIntent::new(
            "account",
            " 001234 ",
            "Broker-Demo",
            intent("inner").operation
        ),
        Err(ExecutionError::InvalidText("account_login"))
    ));
    assert!(matches!(
        ExecutionEvent::new(0, ExecutionState::Rejected)
            .with_result(Some(1), Some("bad\nmessage".into())),
        Err(ExecutionError::InvalidText("message"))
    ));
    assert!(matches!(
        ExecutionEvent::new(0, ExecutionState::ServerAccepted).with_broker_ids(
            Some(" order-1".into()),
            None,
            None
        ),
        Err(ExecutionError::InvalidText("broker_order_id"))
    ));
}

#[test]
fn serde_uses_snake_case_and_deserialization_validates_intent() {
    let json = serde_json::to_value(intent("json")).unwrap();
    assert!(json.get("command_id").is_some());
    assert!(json["operation"]["place_order"]["stop_loss"].is_string());
    let invalid = r#"{"command_id":"x","account_login":"1","broker_server":"s","operation":{"place_order":{"symbol":"EURUSD","side":"buy","kind":"market","volume":"-1","entry":"1","stop_loss":"0.5","take_profit":null}}}"#;
    assert!(serde_json::from_str::<ExecutionIntent>(invalid).is_err());
}

#[test]
fn recovery_snapshot_is_sorted_camel_case_and_does_not_change_state() {
    let mut registry = ExecutionRegistry::new();
    registry.register(intent("z-last"), 1).unwrap();
    registry.register(intent("a-first"), 2).unwrap();
    registry
        .transition(
            "z-last",
            ExecutionEvent::new(3, ExecutionState::Validated)
                .with_result(Some(10009), None)
                .unwrap(),
        )
        .unwrap();
    let before = registry.recovery_snapshot();

    let snapshot = registry.recovery_snapshot();
    assert_eq!(snapshot[0].command_id, "a-first");
    assert_eq!(snapshot[1].command_id, "z-last");
    assert_eq!(snapshot[0].state, "prepared");
    assert_eq!(snapshot[0].recovery_status, "recovery_required");
    assert_eq!(snapshot[1].state, "validated");
    assert_eq!(snapshot[1].recovery_status, "validated_local");
    assert_eq!(snapshot[1].retcode, Some(10009));
    assert_eq!(
        registry.get("a-first").unwrap().state(),
        ExecutionState::Prepared
    );
    assert_eq!(
        registry.get("z-last").unwrap().state(),
        ExecutionState::Validated
    );
    assert_eq!(registry.recovery_snapshot(), before);

    let json = serde_json::to_value(snapshot).unwrap();
    assert_eq!(json[0]["commandId"], "a-first");
    assert_eq!(json[0]["accountLogin"], "001234");
    assert_eq!(json[0]["updatedAtMs"], 2);
    assert_eq!(json[0]["state"], "prepared");
    assert_eq!(json[0]["operation"]["kind"], "place_order");
    assert_eq!(json[0]["operation"]["orderKind"], "limit");
    assert_eq!(json[0]["operation"]["stopLoss"], "1.0900");
    assert!(json[0].get("command_id").is_none());
    assert!(json[0]["operation"].get("order_kind").is_none());
}

fn update(status: CommandStatus, updated_at_ms: i64, at_update: u64) -> ExecutionUpdate {
    ExecutionUpdate {
        status,
        retcode: Some(0),
        last_error: Some(0),
        broker_order_id: Some(format!("brk-{at_update}")),
        deal_id: None,
        position_id: None,
        filled_volume: None,
        message: Some("ok".into()),
        updated_at_ms,
    }
}

fn place_intent(command_id: &str, kind: OrderKind) -> ExecutionIntent {
    ExecutionIntent::new(
        command_id,
        "001234",
        "Broker-Demo",
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "NAS100".into(),
            side: OrderSide::Buy,
            kind,
            volume: "0.10".into(),
            entry: "25000.0".into(),
            stop_loss: Some("24950.0".into()),
            take_profit: Some("25100.0".into()),
            time_in_force: None,
            limit_price: None,
        }),
    )
    .unwrap()
}

fn no_evidence() -> BrokerEvidence {
    BrokerEvidence {
        broker_order_id: None,
        broker_deal_id: None,
        broker_position_id: None,
        retcode: None,
    }
}

fn broker_evidence() -> BrokerEvidence {
    BrokerEvidence {
        broker_order_id: Some("7005".into()),
        broker_deal_id: None,
        broker_position_id: None,
        retcode: Some(0),
    }
}

#[test]
fn market_and_limit_commands_walk_to_filled_via_updates() {
    let mut registry = ExecutionRegistry::new();
    registry
        .register(place_intent("mkt-1", OrderKind::Market), 0)
        .unwrap();
    registry
        .register(place_intent("lim-1", OrderKind::Limit), 0)
        .unwrap();

    for (status, at) in [
        (CommandStatus::Accepted, 1i64),
        (CommandStatus::Dispatching, 2),
        (CommandStatus::ServerAccepted, 3),
        (CommandStatus::Filled, 4),
    ] {
        let record = registry
            .apply_update("mkt-1", update(status, at, at as u64), at as u64)
            .unwrap()
            .expect("fresh update applies");
        assert_eq!(record.state(), status.execution_state());
    }
    let market = registry.get("mkt-1").unwrap();
    assert_eq!(market.state(), ExecutionState::Filled);
    assert_eq!(market.events().len(), 5);

    for (status, at) in [
        (CommandStatus::Accepted, 1i64),
        (CommandStatus::Dispatching, 2),
        (CommandStatus::ServerAccepted, 3),
    ] {
        registry
            .apply_update("lim-1", update(status, at, at as u64), at as u64)
            .unwrap()
            .expect("fresh update applies");
    }
    let mut partial = update(CommandStatus::PartiallyFilled, 4, 4);
    partial.filled_volume = Some("0.05".into());
    let record = registry.apply_update("lim-1", partial, 4).unwrap().unwrap();
    assert_eq!(record.state(), ExecutionState::PartiallyFilled);
    assert_eq!(
        record.events().last().unwrap().filled_volume.as_deref(),
        Some("0.05")
    );
    registry
        .apply_update("lim-1", update(CommandStatus::Filled, 5, 5), 5)
        .unwrap()
        .unwrap();
    let limit = registry.get("lim-1").unwrap();
    assert_eq!(limit.state(), ExecutionState::Filled);
    assert_eq!(limit.events().len(), 6);
}

#[test]
fn rejected_commands_are_terminal_after_the_dispatching_reject_path() {
    let mut registry = ExecutionRegistry::new();
    registry
        .register(place_intent("rej-1", OrderKind::Market), 0)
        .unwrap();
    for (status, at) in [
        (CommandStatus::Accepted, 1i64),
        (CommandStatus::Dispatching, 2),
    ] {
        registry
            .apply_update("rej-1", update(status, at, at as u64), at as u64)
            .unwrap()
            .unwrap();
    }
    let mut rejected = update(CommandStatus::Rejected, 3, 3);
    rejected.retcode = Some(10004);
    let record = registry
        .apply_update("rej-1", rejected, 3)
        .unwrap()
        .unwrap();
    assert_eq!(record.state(), ExecutionState::Rejected);
    assert_eq!(record.events().last().unwrap().retcode, Some(10004));
    assert_eq!(
        registry.apply_update("rej-1", update(CommandStatus::Filled, 4, 4), 4),
        Err(ExecutionError::InvalidTransition {
            from: ExecutionState::Rejected,
            to: ExecutionState::Filled,
        })
    );
}

#[test]
fn stale_at_update_is_ignored_before_any_state_change() {
    let mut registry = ExecutionRegistry::new();
    registry
        .register(place_intent("stale-1", OrderKind::Market), 0)
        .unwrap();
    registry
        .apply_update("stale-1", update(CommandStatus::Accepted, 1, 1), 1)
        .unwrap()
        .unwrap();
    let after_first = registry.get("stale-1").unwrap().events().len();

    // Duplicate delivery of the same counter is ignored without history growth.
    assert!(registry
        .apply_update("stale-1", update(CommandStatus::Accepted, 1, 1), 1)
        .unwrap()
        .is_none());
    // A lower counter is stale even when its status would violate transitions.
    assert!(registry
        .apply_update("stale-1", update(CommandStatus::Filled, 2, 0), 0)
        .unwrap()
        .is_none());
    assert_eq!(registry.get("stale-1").unwrap().events().len(), after_first);
    assert_eq!(
        registry.get("stale-1").unwrap().state(),
        ExecutionState::Validated
    );

    // A fresh counter applies and continues the walk.
    registry
        .apply_update("stale-1", update(CommandStatus::Dispatching, 2, 2), 2)
        .unwrap()
        .unwrap();
    assert_eq!(
        registry.get("stale-1").unwrap().state(),
        ExecutionState::Dispatching
    );
}

#[test]
fn unknown_never_exits_via_updates_and_resolves_only_on_broker_evidence() {
    let mut registry = ExecutionRegistry::new();
    registry
        .register(place_intent("unk-1", OrderKind::Market), 0)
        .unwrap();
    for (status, at) in [
        (CommandStatus::Accepted, 1i64),
        (CommandStatus::Dispatching, 2),
    ] {
        registry
            .apply_update("unk-1", update(status, at, at as u64), at as u64)
            .unwrap()
            .unwrap();
    }
    registry
        .apply_update("unk-1", update(CommandStatus::Unknown, 3, 3), 3)
        .unwrap()
        .unwrap();
    assert_eq!(
        registry.get("unk-1").unwrap().state(),
        ExecutionState::Unknown
    );

    // No fresh update may leave Unknown — not even a legal successor status...
    assert_eq!(
        registry.apply_update("unk-1", update(CommandStatus::ServerAccepted, 4, 4), 4),
        Err(ExecutionError::UnknownRequiresResolution("unk-1".into()))
    );
    // ...while stale duplicates are still ignored before the Unknown gate.
    assert!(registry
        .apply_update("unk-1", update(CommandStatus::Dispatching, 4, 2), 2)
        .unwrap()
        .is_none());
    assert_eq!(
        registry.get("unk-1").unwrap().state(),
        ExecutionState::Unknown
    );

    // Every resolution needs broker evidence.
    assert_eq!(
        registry.resolve_unknown("unk-1", UnknownResolution::Filled, no_evidence(), 4),
        Err(ExecutionError::MissingBrokerEvidence)
    );
    // Resolution with evidence completes the command.
    let record = registry
        .resolve_unknown(
            "unk-1",
            UnknownResolution::Filled,
            BrokerEvidence {
                broker_order_id: Some("7005".into()),
                broker_deal_id: Some("9001".into()),
                broker_position_id: Some("9001".into()),
                retcode: Some(0),
            },
            4,
        )
        .unwrap();
    assert_eq!(record.state(), ExecutionState::Filled);
    // Resolving twice is a transition violation, not a retry.
    assert_eq!(
        registry.resolve_unknown("unk-1", UnknownResolution::Rejected, broker_evidence(), 5,),
        Err(ExecutionError::InvalidTransition {
            from: ExecutionState::Filled,
            to: ExecutionState::Rejected,
        })
    );

    // A resting limit order resolves back to server_accepted, and the
    // update pipeline continues normally afterwards.
    registry
        .register(place_intent("unk-2", OrderKind::Limit), 0)
        .unwrap();
    for (status, at) in [
        (CommandStatus::Accepted, 1i64),
        (CommandStatus::Dispatching, 2),
        (CommandStatus::Unknown, 3),
    ] {
        registry
            .apply_update("unk-2", update(status, at, at as u64), at as u64)
            .unwrap()
            .unwrap();
    }
    assert_eq!(
        registry.resolve_unknown("unk-2", UnknownResolution::Resting, no_evidence(), 4),
        Err(ExecutionError::MissingBrokerEvidence)
    );
    let record = registry
        .resolve_unknown("unk-2", UnknownResolution::Resting, broker_evidence(), 4)
        .unwrap();
    assert_eq!(record.state(), ExecutionState::ServerAccepted);
    registry
        .apply_update("unk-2", update(CommandStatus::Filled, 5, 4), 4)
        .unwrap()
        .unwrap();
    assert_eq!(
        registry.get("unk-2").unwrap().state(),
        ExecutionState::Filled
    );

    // A partial resolution records its volume and validates it.
    registry
        .register(place_intent("unk-3", OrderKind::Market), 0)
        .unwrap();
    for (status, at) in [
        (CommandStatus::Accepted, 1i64),
        (CommandStatus::Dispatching, 2),
        (CommandStatus::Unknown, 3),
    ] {
        registry
            .apply_update("unk-3", update(status, at, at as u64), at as u64)
            .unwrap()
            .unwrap();
    }
    assert_eq!(
        registry.resolve_unknown(
            "unk-3",
            UnknownResolution::Partial { volume: "0".into() },
            broker_evidence(),
            4,
        ),
        Err(ExecutionError::InvalidDecimal("volume"))
    );
    let record = registry
        .resolve_unknown(
            "unk-3",
            UnknownResolution::Partial {
                volume: "0.05".into(),
            },
            broker_evidence(),
            4,
        )
        .unwrap();
    assert_eq!(record.state(), ExecutionState::PartiallyFilled);
    assert_eq!(
        record.events().last().unwrap().filled_volume.as_deref(),
        Some("0.05")
    );
}

#[test]
fn modify_close_cancel_intents_validate_and_walk_the_lifecycle() {
    let reject = |operation| ExecutionIntent::new("op-bad", "001234", "Broker-Demo", operation);
    assert!(reject(ExecutionOperation::ModifyOrder(ModifyOrder {
        target_kind: TargetKind::Position,
        target_id: "9001".into(),
        stop_loss: Some("1.0900".into()),
        take_profit: None,
        price: Some("1.1000".into()),
    }))
    .is_err());
    assert!(reject(ExecutionOperation::ModifyOrder(ModifyOrder {
        target_kind: TargetKind::PendingOrder,
        target_id: "7001".into(),
        stop_loss: None,
        take_profit: None,
        price: None,
    }))
    .is_err());
    assert!(reject(ExecutionOperation::ModifyOrder(ModifyOrder {
        target_kind: TargetKind::PendingOrder,
        target_id: "7001".into(),
        stop_loss: Some("-1.0".into()),
        take_profit: None,
        price: None,
    }))
    .is_err());
    assert!(reject(ExecutionOperation::CloseOrder(CloseOrder {
        position_id: "9001".into(),
        volume: Some("-1".into()),
    }))
    .is_err());
    assert!(reject(ExecutionOperation::CancelOrder(CancelOrder {
        order_id: " ".into(),
    }))
    .is_err());

    let mut registry = ExecutionRegistry::new();
    let operations = [
        ExecutionOperation::ModifyOrder(ModifyOrder {
            target_kind: TargetKind::PendingOrder,
            target_id: "7001".into(),
            stop_loss: Some("24940.0".into()),
            take_profit: Some("25100.0".into()),
            price: Some("24980.0".into()),
        }),
        ExecutionOperation::CloseOrder(CloseOrder {
            position_id: "9001".into(),
            volume: None,
        }),
        ExecutionOperation::CancelOrder(CancelOrder {
            order_id: "7001".into(),
        }),
    ];
    for (index, operation) in operations.into_iter().enumerate() {
        let command_id = format!("op-{index}");
        registry
            .register(
                ExecutionIntent::new(command_id.clone(), "001234", "Broker-Demo", operation)
                    .unwrap(),
                0,
            )
            .unwrap();
        for (status, at) in [
            (CommandStatus::Accepted, 1i64),
            (CommandStatus::Dispatching, 2),
            (CommandStatus::ServerAccepted, 3),
            (CommandStatus::Filled, 4),
        ] {
            registry
                .apply_update(&command_id, update(status, at, at as u64), at as u64)
                .unwrap()
                .unwrap();
        }
        assert_eq!(
            registry.get(&command_id).unwrap().state(),
            ExecutionState::Filled
        );
    }

    let snapshot = registry.recovery_snapshot();
    let json = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(json[0]["operation"]["kind"], "modify_order");
    assert_eq!(json[0]["operation"]["targetKind"], "pending_order");
    assert_eq!(json[0]["operation"]["targetId"], "7001");
    assert_eq!(json[0]["operation"]["price"], "24980.0");
    assert_eq!(json[1]["operation"]["kind"], "close_order");
    assert_eq!(json[1]["operation"]["positionId"], "9001");
    assert!(json[1]["operation"]["volume"].is_null());
    assert_eq!(json[2]["operation"]["kind"], "cancel_order");
    assert_eq!(json[2]["operation"]["orderId"], "7001");
}

#[test]
fn modify_some_levels_set_and_none_levels_leave_unchanged_through_validation() {
    let modify = |stop_loss: Option<&str>, take_profit: Option<&str>, price: Option<&str>| {
        ExecutionIntent::new(
            "mod-null",
            "001234",
            "Broker-Demo",
            ExecutionOperation::ModifyOrder(ModifyOrder {
                target_kind: TargetKind::PendingOrder,
                target_id: "7001".into(),
                stop_loss: stop_loss.map(str::to_owned),
                take_profit: take_profit.map(str::to_owned),
                price: price.map(str::to_owned),
            }),
        )
    };
    // `Some` sets the level; `None` leaves it unchanged, so any single
    // present level survives validation.
    assert!(modify(Some("24940.0"), None, None).is_ok());
    assert!(modify(None, Some("25100.0"), None).is_ok());
    assert!(modify(None, None, Some("24980.0")).is_ok());
    // "0" is the explicit REMOVE sentinel (MT5 clears a stop at price 0).
    assert!(modify(Some("0"), None, None).is_ok());
    assert!(modify(None, Some("0"), None).is_ok());
    // Removing every level at once would be a no-op — remove levels one by
    // one with the "0" sentinel instead.
    assert!(matches!(
        modify(None, None, None),
        Err(ExecutionError::InvalidField(
            "modify requires stop_loss, take_profit, or price"
        ))
    ));
    // Present levels still carry the strict decimal grammar.
    assert!(matches!(
        modify(Some("1e3"), None, None),
        Err(ExecutionError::InvalidDecimal("stop_loss"))
    ));
}

#[test]
fn updates_regress_only_against_the_previous_update_not_the_local_clock() {
    let local_now: u64 = 1_770_000_000_000;
    // The EA clock runs a consistent one hour behind the local Rust clock.
    let ea_now: i64 = local_now as i64 - 3_600_000;
    let mut registry = ExecutionRegistry::new();
    registry
        .register(place_intent("skew-1", OrderKind::Market), local_now)
        .unwrap();

    // The first update carries no constraint against the local clock...
    registry
        .apply_update("skew-1", update(CommandStatus::Accepted, ea_now, 1), 1)
        .unwrap()
        .unwrap();
    // ...and a consistently skewed EA clock keeps applying in order.
    for (status, offset, counter) in [
        (CommandStatus::Dispatching, 10i64, 2u64),
        (CommandStatus::ServerAccepted, 20, 3),
        (CommandStatus::Filled, 30, 4),
    ] {
        registry
            .apply_update("skew-1", update(status, ea_now + offset, counter), counter)
            .unwrap()
            .unwrap();
    }
    assert_eq!(
        registry.get("skew-1").unwrap().state(),
        ExecutionState::Filled
    );

    // An update older than the previous UPDATE is rejected as a regression.
    registry
        .register(place_intent("skew-2", OrderKind::Market), local_now)
        .unwrap();
    registry
        .apply_update("skew-2", update(CommandStatus::Accepted, ea_now, 1), 1)
        .unwrap()
        .unwrap();
    assert_eq!(
        registry.apply_update(
            "skew-2",
            update(CommandStatus::Dispatching, ea_now - 5, 2),
            2
        ),
        Err(ExecutionError::TimestampRegression {
            previous: ea_now as u64,
            next: (ea_now - 5) as u64,
        })
    );
    // The rejected update does not consume the counter watermark.
    registry
        .apply_update(
            "skew-2",
            update(CommandStatus::Dispatching, ea_now + 10, 2),
            2,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        registry.get("skew-2").unwrap().state(),
        ExecutionState::Dispatching
    );
}

#[test]
fn stop_limit_resting_geometry_and_legacy_journals_replay() {
    let order = PlaceOrder {
        symbol: "NAS100".into(),
        side: OrderSide::Buy,
        kind: OrderKind::StopLimit,
        volume: "0.1".into(),
        entry: "120".into(),
        stop_loss: Some("80".into()),
        take_profit: Some("100".into()),
        time_in_force: None,
        limit_price: Some("90".into()),
    };
    let fresh = ExecutionIntent::new(
        "new",
        "123",
        "Demo",
        ExecutionOperation::PlaceOrder(order.clone()),
    )
    .unwrap();
    let json = serde_json::to_string(&fresh).unwrap();
    assert_eq!(
        serde_json::from_str::<ExecutionIntent>(&json).unwrap(),
        fresh
    );
    for take in ["90", "85"] {
        let mut bad = order.clone();
        bad.take_profit = Some(take.into());
        assert!(bad.validate().is_err());
    }
    let mut sell = order.clone();
    sell.side = OrderSide::Sell;
    sell.entry = "80".into();
    sell.limit_price = Some("120".into());
    sell.stop_loss = Some("130".into());
    sell.take_profit = Some("110".into());
    sell.validate().unwrap();
    for take in ["120", "125"] {
        sell.take_profit = Some(take.into());
        assert!(sell.validate().is_err());
    }
    // This geometry was accepted before resting-price validation existed.
    let mut legacy = serde_json::to_value(fresh).unwrap();
    legacy["operation"]["place_order"]["limit_price"] = serde_json::json!("140");
    legacy["operation"]["place_order"]["take_profit"] = serde_json::json!("130");
    let decoded: ExecutionIntent = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded.clone()).unwrap(), legacy);
    let ExecutionOperation::PlaceOrder(legacy_order) = decoded.operation() else {
        panic!("place order")
    };
    assert!(legacy_order.validate().is_err());
}

#[test]
fn stop_limit_intent_requires_limit_price_and_rejects_malformed_values() {
    let stop_limit = |limit_price: Option<&str>| {
        ExecutionIntent::new(
            "sl-1",
            "001234",
            "Broker-Demo",
            ExecutionOperation::PlaceOrder(PlaceOrder {
                symbol: "NAS100".into(),
                side: OrderSide::Buy,
                kind: OrderKind::StopLimit,
                volume: "0.10".into(),
                entry: "25000.0".into(),
                stop_loss: Some("24950.0".into()),
                take_profit: Some("25100.0".into()),
                time_in_force: Some(crate::protocol::TimeInForce::Ioc),
                limit_price: limit_price.map(str::to_owned),
            }),
        )
    };
    stop_limit(Some("25010.0")).unwrap();
    assert_eq!(
        stop_limit(None),
        Err(ExecutionError::InvalidField(
            "stop_limit requires limit_price (resting limit price)"
        ))
    );
    assert_eq!(
        stop_limit(Some("0")),
        Err(ExecutionError::InvalidDecimal("limit_price"))
    );
    // The other kinds accept a well-formed limit_price (it is ignored)
    // and reject a malformed one.
    let ExecutionOperation::PlaceOrder(mut order) = intent("sl-2").operation else {
        panic!("test intent must be a place order");
    };
    order.limit_price = Some("1.1010".into());
    assert!(order.validate().is_ok());
    order.limit_price = Some("nope".into());
    assert_eq!(
        order.validate(),
        Err(ExecutionError::InvalidDecimal("limit_price"))
    );
}

#[test]
fn place_order_journal_round_trip_tolerates_old_entries_and_encodes_new_fields() {
    // Old journals (no new fields) deserialize as gtc / no limit_price…
    let old = r#"{"command_id":"old-1","account_login":"001234","broker_server":"Broker-Demo","operation":{"place_order":{"symbol":"EURUSD","side":"buy","kind":"limit","volume":"0.10","entry":"1.1000","stop_loss":"1.0900","take_profit":null}}}"#;
    let parsed: ExecutionIntent = serde_json::from_str(old).unwrap();
    let ExecutionOperation::PlaceOrder(order) = parsed.operation else {
        panic!("old journal entry must be a place order");
    };
    assert_eq!(order.time_in_force, None);
    assert_eq!(order.limit_price, None);
    // …and re-serializing keeps the old bytes: no new keys appear.
    let reencoded = serde_json::to_value(
        ExecutionIntent::new(
            "old-1",
            "001234",
            "Broker-Demo",
            ExecutionOperation::PlaceOrder(order),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(
        reencoded["operation"]["place_order"]
            .get("time_in_force")
            .is_none()
            && reencoded["operation"]["place_order"]
                .get("limit_price")
                .is_none(),
        "gtc intent must keep its old journal bytes: {reencoded}"
    );

    // New fields round-trip through the journal JSON.
    let intent = ExecutionIntent::new(
        "new-1",
        "001234",
        "Broker-Demo",
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "NAS100".into(),
            side: OrderSide::Buy,
            kind: OrderKind::StopLimit,
            volume: "0.10".into(),
            entry: "25000.0".into(),
            stop_loss: Some("24950.0".into()),
            take_profit: None,
            time_in_force: Some(crate::protocol::TimeInForce::Day),
            limit_price: Some("25010.0".into()),
        }),
    )
    .unwrap();
    let json = serde_json::to_value(&intent).unwrap();
    assert_eq!(json["operation"]["place_order"]["time_in_force"], "day");
    assert_eq!(json["operation"]["place_order"]["kind"], "stop_limit");
    assert_eq!(json["operation"]["place_order"]["limit_price"], "25010.0");
    assert_eq!(
        serde_json::from_value::<ExecutionIntent>(json).unwrap(),
        intent
    );
}

#[test]
fn registration_treats_the_new_fields_as_part_of_the_payload() {
    let mut registry = ExecutionRegistry::new();
    registry.register(intent("same-tif"), 1).unwrap();
    // Same command_id, same everything, but an explicit `gtc` where the
    // first intent had none: structurally a different payload, so it is a
    // conflict rather than an idempotent retry.
    let mut changed = intent("same-tif");
    let ExecutionOperation::PlaceOrder(order) = &mut changed.operation else {
        panic!("changed intent must be a place order");
    };
    order.time_in_force = Some(crate::protocol::TimeInForce::Gtc);
    assert_eq!(
        registry.register(changed, 2),
        Err(ExecutionError::CommandIdConflict("same-tif".into()))
    );
    // An identical retry (same absence of fields) stays idempotent.
    assert!(registry.register(intent("same-tif"), 3).is_ok());
    assert_eq!(registry.len(), 1);
}

#[test]
fn place_order_stop_loss_is_optional_and_old_journals_replay_as_present() {
    // Old journal shape: stop_loss present → Some, SL rules alive.
    let old = r#"{"command_id":"old-sl","account_login":"001234","broker_server":"Broker-Demo","operation":{"place_order":{"symbol":"EURUSD","side":"buy","kind":"limit","volume":"0.10","entry":"1.1000","stop_loss":"1.0000","take_profit":null}}}"#;
    let parsed: ExecutionIntent = serde_json::from_str(old).unwrap();
    let ExecutionOperation::PlaceOrder(order) = parsed.operation else {
        panic!("old journal entry must be a place order");
    };
    assert_eq!(order.stop_loss, Some("1.0000".into()));
    order.validate().unwrap();

    // Present values keep the SL-specific direction rule (a buy SL above
    // entry is still rejected verbatim)…
    let mut bad = order.clone();
    bad.stop_loss = Some("1.2000".into());
    assert_eq!(
        bad.validate(),
        Err(ExecutionError::InvalidField(
            "buy stop_loss must be below entry"
        ))
    );

    // …while absent means "no stop loss": the SL-specific rule is skipped.
    let mut no_sl = order.clone();
    no_sl.stop_loss = None;
    no_sl.validate().unwrap();

    // New journal shape with an explicit null replays as the same no-SL
    // intent, and a present value keeps its byte-identical spelling.
    let new = r#"{"command_id":"new-sl","account_login":"001234","broker_server":"Broker-Demo","operation":{"place_order":{"symbol":"EURUSD","side":"buy","kind":"limit","volume":"0.10","entry":"1.1000","stop_loss":null,"take_profit":null}}}"#;
    let parsed: ExecutionIntent = serde_json::from_str(new).unwrap();
    let ExecutionOperation::PlaceOrder(order) = parsed.operation else {
        panic!("new journal entry must be a place order");
    };
    assert_eq!(order.stop_loss, None);
    order.validate().unwrap();

    let intent = ExecutionIntent::new(
        "sl-bytes",
        "001234",
        "Broker-Demo",
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "EURUSD".into(),
            side: OrderSide::Buy,
            kind: OrderKind::Limit,
            volume: "0.10".into(),
            entry: "1.1000".into(),
            stop_loss: Some("1.0900".into()),
            take_profit: None,
            time_in_force: None,
            limit_price: None,
        }),
    )
    .unwrap();
    let json = serde_json::to_value(&intent).unwrap();
    assert_eq!(
        json["operation"]["place_order"]["stop_loss"], "1.0900",
        "a present stop_loss journals its required-field-era spelling"
    );
}

#[test]
fn symbol_bound_is_128_bytes_and_messages_256_chars() {
    let ExecutionOperation::PlaceOrder(mut order) = intent("bounds").operation else {
        panic!("test intent must be a place order");
    };
    // 128 UTF-8 bytes fit — the same symbol bound as the wire protocol.
    order.symbol = "b".repeat(128);
    assert!(order.validate().is_ok());
    order.symbol = "b".repeat(129);
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::FieldTooLong("symbol", 128))
    ));
    // 65 two-byte chars = 130 bytes: over the byte bound, within the char bound.
    order.symbol = "ä".repeat(65);
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::FieldTooLong("symbol", 128))
    ));
    // retcode messages are bounded at 256 characters.
    assert!(ExecutionEvent::new(0, ExecutionState::Filled)
        .with_result(Some(0), Some("m".repeat(256)))
        .is_ok());
    assert!(matches!(
        ExecutionEvent::new(0, ExecutionState::Filled).with_result(Some(0), Some("m".repeat(257))),
        Err(ExecutionError::FieldTooLong("message", 256))
    ));
}

#[test]
fn positive_decimal_rejects_exponents_and_surrounding_whitespace() {
    let ExecutionOperation::PlaceOrder(mut order) = intent("grammar").operation else {
        panic!("test intent must be a place order");
    };
    // Same strict grammar as the wire's `order_decimal`: no exponents...
    order.volume = "1e3".into();
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::InvalidDecimal("volume"))
    ));
    // ...and no surrounding whitespace.
    order.volume = " 1 ".into();
    assert!(matches!(
        order.validate(),
        Err(ExecutionError::InvalidDecimal("volume"))
    ));
    order.volume = "1.0".into();
    assert!(order.validate().is_ok());
}
