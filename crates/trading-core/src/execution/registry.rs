use std::collections::{btree_map::Entry, BTreeMap};

use serde::Serialize;

use super::error::*;
use super::recovery::RecoveryEntry;
use super::types::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecutionRecord {
    pub(super) intent: ExecutionIntent,
    pub(super) events: Vec<ExecutionEvent>,
    /// Highest `at_update` applied so far; `None` until the first update.
    pub(super) last_at_update: Option<u64>,
    /// `updated_at_ms` of the last applied update; `None` until the first
    /// update. Fresh updates regress only against this watermark — never
    /// against the local-clock `at_ms` of earlier events — so a consistently
    /// skewed EA clock cannot stick the record in a `TimestampRegression`
    /// (see [`ExecutionRegistry::apply_update`]).
    pub(super) last_updated_at_ms: Option<i64>,
}

impl ExecutionRecord {
    pub fn intent(&self) -> &ExecutionIntent {
        &self.intent
    }
    pub fn events(&self) -> &[ExecutionEvent] {
        &self.events
    }
    pub fn state(&self) -> ExecutionState {
        self.events
            .last()
            .expect("registered records have an initial event")
            .state
    }
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(transparent)]
pub struct ExecutionRegistry {
    records: BTreeMap<String, ExecutionRecord>,
}

impl ExecutionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a command without dispatching it. Duplicate IDs are structural
    /// payload comparisons; no locally implemented cryptographic hash is used.
    pub fn register(
        &mut self,
        intent: ExecutionIntent,
        at_ms: u64,
    ) -> Result<&ExecutionRecord, ExecutionError> {
        let id = intent.command_id.clone();
        match self.records.entry(id) {
            Entry::Occupied(entry) if entry.get().intent == intent => Ok(entry.into_mut()),
            Entry::Occupied(entry) => {
                Err(ExecutionError::CommandIdConflict(entry.key().to_owned()))
            }
            Entry::Vacant(entry) => Ok(entry.insert(ExecutionRecord {
                intent,
                events: vec![ExecutionEvent::new(at_ms, ExecutionState::Prepared)],
                last_at_update: None,
                last_updated_at_ms: None,
            })),
        }
    }

    pub fn get(&self, command_id: &str) -> Option<&ExecutionRecord> {
        self.records.get(command_id)
    }

    pub fn transition(
        &mut self,
        command_id: &str,
        event: ExecutionEvent,
    ) -> Result<&ExecutionRecord, ExecutionError> {
        event.validate()?;
        let record = self
            .records
            .get_mut(command_id)
            .ok_or_else(|| ExecutionError::NotFound(command_id.to_owned()))?;
        let current = record.state();
        let last = record
            .events
            .last()
            .expect("registered records have an initial event");
        if event.at_ms < last.at_ms {
            return Err(ExecutionError::TimestampRegression {
                previous: last.at_ms,
                next: event.at_ms,
            });
        }
        if !current.permits(event.state) {
            return Err(ExecutionError::InvalidTransition {
                from: current,
                to: event.state,
            });
        }
        if current == ExecutionState::Unknown && !event.has_broker_evidence() {
            return Err(ExecutionError::MissingBrokerEvidence);
        }
        record.events.push(event);
        Ok(record)
    }

    /// Apply one broker command update to its record. `at_update` is the
    /// terminal's strictly increasing per-command counter: equal or lower
    /// values are stale duplicates, silently ignored as `Ok(None)` before any
    /// payload validation — only fresh updates are validated. A fresh update
    /// NEVER leaves `Unknown` — updates hit an `Unknown` record with
    /// [`ExecutionError::UnknownRequiresResolution`] and the only exit of this
    /// pipeline is [`Self::resolve_unknown`]; there is no automatic retry
    /// path anywhere. Fresh updates otherwise pass the same transition rules
    /// as [`Self::transition`] with one timestamp exception: `updated_at_ms`
    /// is compared only against the previous update's `updated_at_ms`, never
    /// against the local-clock `at_ms` of earlier events, so a skewed EA
    /// clock cannot stick a record in [`ExecutionError::TimestampRegression`]
    /// (the first update has no timestamp constraint at all). Applied
    /// updates append an event whose `at_ms` follows `updated_at_ms`.
    ///
    /// `server_accepted` is settled for the dispatch queue but is NOT
    /// terminal for the record: later fills of the resulting pending order
    /// may advance it to `partially_filled`/`filled`. Per-kind settlement (a
    /// `market` submit must continue to `filled` and never settle at
    /// `server_accepted`) is owned by the EA adapter's status mapping; this
    /// registry deliberately enforces no per-kind rule.
    pub fn apply_update(
        &mut self,
        command_id: &str,
        update: ExecutionUpdate,
        at_update: u64,
    ) -> Result<Option<&ExecutionRecord>, ExecutionError> {
        let record = self
            .records
            .get_mut(command_id)
            .ok_or_else(|| ExecutionError::NotFound(command_id.to_owned()))?;
        // Stale duplicates are ignored before anything else is inspected, so
        // only fresh updates ever reach payload validation.
        if record
            .last_at_update
            .is_some_and(|previous| at_update <= previous)
        {
            return Ok(None);
        }
        let updated_at_ms = update.updated_at_ms;
        if updated_at_ms < 0 {
            return Err(ExecutionError::InvalidField(
                "updated_at_ms must not be negative",
            ));
        }
        let mut event = ExecutionEvent::new(updated_at_ms as u64, update.status.execution_state());
        event.retcode = update.retcode;
        event.last_error = update.last_error;
        event.broker_order_id = update.broker_order_id;
        event.broker_deal_id = update.deal_id;
        event.broker_position_id = update.position_id;
        event.filled_volume = update.filled_volume;
        event.message = update.message;
        event.validate()?;
        if record.state() == ExecutionState::Unknown {
            return Err(ExecutionError::UnknownRequiresResolution(
                command_id.to_owned(),
            ));
        }
        if let Some(previous) = record.last_updated_at_ms {
            if updated_at_ms < previous {
                return Err(ExecutionError::TimestampRegression {
                    previous: previous as u64,
                    next: updated_at_ms as u64,
                });
            }
        }
        let current = record.state();
        if !current.permits(event.state) {
            return Err(ExecutionError::InvalidTransition {
                from: current,
                to: event.state,
            });
        }
        record.events.push(event);
        record.last_at_update = Some(at_update);
        record.last_updated_at_ms = Some(updated_at_ms);
        Ok(Some(record))
    }

    /// Exit a command stuck in [`ExecutionState::Unknown`] using the broker
    /// evidence reconciliation has gathered — the only exit of the
    /// [`Self::apply_update`] pipeline. EVERY exit from `Unknown`, this
    /// method or the legacy evidence-gated [`Self::transition`] path, requires
    /// explicit broker evidence (a broker ID or a retcode); without it the
    /// call fails with [`ExecutionError::MissingBrokerEvidence`]. There is no
    /// non-evidence exit and no automatic retry path anywhere.
    pub fn resolve_unknown(
        &mut self,
        command_id: &str,
        resolution: UnknownResolution,
        evidence: BrokerEvidence,
        at_ms: u64,
    ) -> Result<&ExecutionRecord, ExecutionError> {
        if let UnknownResolution::Partial { volume } = &resolution {
            positive_decimal("volume", volume)?;
        }
        let state = resolution.execution_state();
        let record = self
            .records
            .get_mut(command_id)
            .ok_or_else(|| ExecutionError::NotFound(command_id.to_owned()))?;
        if record.state() != ExecutionState::Unknown {
            return Err(ExecutionError::InvalidTransition {
                from: record.state(),
                to: state,
            });
        }
        let last = record
            .events
            .last()
            .expect("registered records have an initial event");
        if at_ms < last.at_ms {
            return Err(ExecutionError::TimestampRegression {
                previous: last.at_ms,
                next: at_ms,
            });
        }
        let mut event = ExecutionEvent::new(at_ms, state).with_broker_ids(
            evidence.broker_order_id,
            evidence.broker_deal_id,
            evidence.broker_position_id,
        )?;
        event = event.with_result(evidence.retcode, None)?;
        if !event.has_broker_evidence() {
            return Err(ExecutionError::MissingBrokerEvidence);
        }
        if let UnknownResolution::Partial { volume } = resolution {
            event.filled_volume = Some(volume);
        }
        record.events.push(event);
        Ok(record)
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Returns an immutable, deterministic view for recovery UI. Building this
    /// projection never changes any command's lifecycle state.
    pub fn recovery_snapshot(&self) -> Vec<RecoveryEntry> {
        self.records
            .values()
            .map(RecoveryEntry::from_record)
            .collect()
    }
}
