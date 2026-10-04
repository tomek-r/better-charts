//! Execution dispatch adapter: the bounded pending-command queue, the
//! one-command-in-flight rule toward the EA, and the owner dispatch gate.
//!
//! This module only queues, tracks, and delegates. It never opens sockets.
//! Claiming a command requires the owner [`DISPATCH_ENABLED`] gate, an
//! available durable journal, the session handshake `trading_enabled` flag,
//! and a `Complete` reconciliation status. A session close or replace drains
//! everything the previous session left behind — in-flight goes `unknown`
//! through the journaled update path, queued commands are dropped with a
//! `QueueDropped` journal event, and nothing is ever auto-dispatched later.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use thiserror::Error;
use trading_core::execution::ExecutionIntent;
use trading_core::protocol::{MessageType, OrderCommandError, OrderCommandUpdate};

use crate::execution_journal::{ExecutionSafetyState, ExecutionSafetyStatus, JournalError};

/// THE dispatch gate. Owner-approved on 2026-09-23 for DEMO verification:
/// flipped to `true`, outbound trading commands are unlocked. Claiming still
/// requires this flag, an available journal, the session handshake
/// `trading_enabled` flag and a `Complete` reconciliation status
/// (see [`ExecutionAdapterState::next_wire_message_for_session`]).
pub const DISPATCH_ENABLED: bool = true;

/// Protocol limit: at most 32 queued (not yet claimed) commands on the Rust
/// side; the EA executes them strictly sequentially, one in flight.
pub const MAX_PENDING_COMMANDS: usize = 32;

const DISPATCH_DISABLED_MESSAGE: &str = "dispatch is disabled until owner approval";

/// Checked first by every Tauri submission command. Goes through a function
/// call (not a const `if`) so the compiler keeps the gated paths reachable
/// and lint-clean regardless of the flag's value.
pub fn dispatch_gate() -> Result<(), String> {
    if DISPATCH_ENABLED {
        Ok(())
    } else {
        Err(DISPATCH_DISABLED_MESSAGE.to_string())
    }
}

/// One queued outbound `order_*_request` envelope body. The connection pump
/// wraps it in the standard envelope when it claims this command.
#[derive(Debug, Clone)]
pub struct PendingCommand {
    pub command_id: String,
    pub message_type: MessageType,
    pub payload: serde_json::Value,
}

/// CamelCase view for the `get_execution_queue_status` Tauri command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionQueueView {
    pub pending: usize,
    pub in_flight: Option<String>,
    pub dispatch_enabled: bool,
    /// Commands the most recent session close/replace dropped without ever
    /// dispatching (`QueueDropped` journal events). The count is overwritten
    /// — never accumulated — by each session transition that strands
    /// commands, so the UI can surface it per session.
    pub stranded: usize,
}

#[derive(Debug, Error)]
pub enum ExecutionAdapterError {
    #[error("trading is disabled in app settings; restart after enabling it")]
    TradingDisabled,
    #[error("execution queue is full (32 pending commands)")]
    QueueFull,
    #[error("execution journal failed: {0}")]
    Journal(#[from] JournalError),
    #[error("execution adapter lock is poisoned")]
    Poisoned,
    /// F-5: the registered intent's account binding does not match the
    /// active session account. The caller answers with an `INVALID_MESSAGE`
    /// frame; no state changes anywhere.
    #[error("command account binding does not match the active session")]
    AccountMismatch,
    #[error("command belongs to an inactive bridge session")]
    StaleSession,
}

#[derive(Debug, Default)]
struct AdapterInner {
    queue: VecDeque<PendingCommand>,
    /// The single command already handed to the connection pump for this
    /// session. Released only by a settled `order_command_update`, by an
    /// `order_command_error` for the same command, or by session end — never
    /// re-queued automatically (no command is ever retried on its own).
    in_flight: Option<String>,
    /// Last `at_update` applied for the current in-flight command; the
    /// session-end `unknown` transition journals `+1` so it always clears
    /// the registry's per-command watermark.
    in_flight_at_update: u64,
    /// Commands the most recent session transition dropped without
    /// dispatching; see [`ExecutionQueueView::stranded`].
    stranded: usize,
    /// F-2 claim gate: the handshake `trading_enabled` flag, armed by
    /// `session_started_for_session` and cleared when the session ends.
    trading_enabled: bool,
    /// F-2 claim gate: reconciliation reached `Complete`, set from lib.rs
    /// wherever a `ReconciliationStatus` is published.
    reconciliation_complete: bool,
    /// F-5 session account binding from the `hello` handshake; `None` while
    /// no session is active.
    session_account: Option<(String, String)>,
    /// Session id checked again when the connection pump claims a command.
    session_id: Option<String>,
}

/// Per-process boot nonce (F-4): sub-second clock nanos xored with the
/// process id, mixed into a `u32`. No new dependencies; two processes that
/// start within the same millisecond still mint disjoint `command_id` sets.
fn boot_nonce() -> u32 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos())
        .unwrap_or(0);
    nanos ^ std::process::id()
}

/// Wall-clock milliseconds for the session-end `unknown` transition: at or
/// after any EA-supplied `updated_at_ms` taken from the same host clock.
fn wall_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Synchronized queue + in-flight view. Clone shares the same state, matching
/// the `ExecutionSafetyState` pattern.
#[derive(Clone)]
pub struct ExecutionAdapterState {
    inner: Arc<Mutex<AdapterInner>>,
    safety: ExecutionSafetyState,
    next_sequence: Arc<std::sync::atomic::AtomicU64>,
    /// This instance's dispatch-gate flag. Production instances are built
    /// from [`DISPATCH_ENABLED`] via [`Self::new_with_trading_permission`]; tests use
    /// `new_with_gate` to exercise the claim mechanics behind it.
    gate: bool,
    /// Startup permission; settings saves cannot change a running queue.
    local_trading_enabled: bool,
    /// Per-process boot nonce embedded in every `command_id` (F-4).
    boot_nonce: u32,
}

impl ExecutionAdapterState {
    #[cfg(test)]
    pub fn new(safety: ExecutionSafetyState) -> Self {
        Self::new_with_trading_permission(safety, true)
    }

    pub fn new_with_trading_permission(safety: ExecutionSafetyState, enabled: bool) -> Self {
        Self::create(safety, DISPATCH_ENABLED, enabled, boot_nonce())
    }

    /// Reject submissions before validation or durable intent registration.
    pub fn submission_gate(&self) -> Result<(), String> {
        dispatch_gate()?;
        if self.local_trading_enabled {
            Ok(())
        } else {
            Err(ExecutionAdapterError::TradingDisabled.to_string())
        }
    }

    pub fn with_trading_permission(
        &self,
        mut status: ExecutionSafetyStatus,
    ) -> ExecutionSafetyStatus {
        status.dispatch_enabled &= self.gate && self.local_trading_enabled;
        if !self.local_trading_enabled {
            status.message = format!(
                "Execution journal {}; trading is disabled in app settings.",
                status.journal_state
            );
        }
        status
    }

    /// Test-only constructor with an explicit dispatch-gate flag; production
    /// code (`run()`'s setup) always passes the [`DISPATCH_ENABLED`] const
    /// through [`Self::new_with_trading_permission`].
    #[cfg(test)]
    pub fn new_with_gate(safety: ExecutionSafetyState, gate: bool) -> Self {
        Self::create(safety, gate, true, boot_nonce())
    }

    /// Test-only constructor pinning the boot nonce so `command_id`
    /// disjointness can be proven with identical clocks and sequences.
    #[cfg(test)]
    pub fn new_with_nonce(safety: ExecutionSafetyState, gate: bool, nonce: u32) -> Self {
        Self::create(safety, gate, true, nonce)
    }

    fn create(
        safety: ExecutionSafetyState,
        gate: bool,
        local_trading_enabled: bool,
        boot_nonce: u32,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(AdapterInner::default())),
            safety,
            next_sequence: Arc::new(std::sync::atomic::AtomicU64::new(1)),
            gate,
            local_trading_enabled,
            boot_nonce,
        }
    }

    /// Durable, unique command id: `cmd-<nonce8-hex>-<unix-ms>-<seq>`. The
    /// per-process boot nonce keeps ids from two same-millisecond process
    /// starts disjoint even when clock and sequence collide, and the format
    /// stays far below the protocol's 128-byte id limit. Derived once per
    /// submission; `register` then makes an identical retry with the same id
    /// and payload idempotent and any payload change a conflict.
    pub fn next_command_id(&self, now_ms: i64) -> String {
        let sequence = self
            .next_sequence
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("cmd-{:08x}-{now_ms}-{sequence}", self.boot_nonce)
    }

    pub fn queue_status(&self) -> ExecutionQueueView {
        let inner = self.inner.lock().expect("execution adapter mutex poisoned");
        ExecutionQueueView {
            pending: inner.queue.len(),
            in_flight: inner.in_flight.clone(),
            dispatch_enabled: self.gate && self.local_trading_enabled,
            stranded: inner.stranded,
        }
    }

    /// Durably registers the intent at `Prepared` first, then enqueues. The
    /// queue cap is checked before any durable write so an overflow never
    /// leaves a registered-but-unqueued command behind. The lifecycle only
    /// advances when the EA confirms `accepted` (modeled as `Validated` by
    /// trading-core's `apply_update`).
    ///
    /// `intent` is `None` only while a command has no registry record to
    /// build (none in this crate's flows today; all four wire commands have a
    /// matching `ExecutionOperation` variant in trading-core).
    #[cfg(test)]
    pub fn enqueue(
        &self,
        command_id: String,
        message_type: MessageType,
        payload: serde_json::Value,
        intent: Option<ExecutionIntent>,
        at_ms: u64,
    ) -> Result<(), ExecutionAdapterError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| ExecutionAdapterError::Poisoned)?;
        self.enqueue_locked(&mut inner, command_id, message_type, payload, intent, at_ms)
    }

    /// Enqueues only while `session_id` is the active adapter session.
    /// The check, durable registration, and queue insertion share one lock
    /// with session replacement.
    pub fn enqueue_for_session(
        &self,
        session_id: &str,
        command: PendingCommand,
        intent: Option<ExecutionIntent>,
        at_ms: u64,
    ) -> Result<(), ExecutionAdapterError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| ExecutionAdapterError::Poisoned)?;
        if inner.session_id.as_deref() != Some(session_id) {
            return Err(ExecutionAdapterError::StaleSession);
        }
        self.enqueue_locked(
            &mut inner,
            command.command_id,
            command.message_type,
            command.payload,
            intent,
            at_ms,
        )
    }

    fn enqueue_locked(
        &self,
        inner: &mut AdapterInner,
        command_id: String,
        message_type: MessageType,
        payload: serde_json::Value,
        intent: Option<ExecutionIntent>,
        at_ms: u64,
    ) -> Result<(), ExecutionAdapterError> {
        if !self.local_trading_enabled {
            return Err(ExecutionAdapterError::TradingDisabled);
        }
        if inner.queue.len() >= MAX_PENDING_COMMANDS {
            return Err(ExecutionAdapterError::QueueFull);
        }
        if let Some(intent) = intent {
            self.safety.register(intent, at_ms)?;
        }
        inner.queue.push_back(PendingCommand {
            command_id,
            message_type,
            payload,
        });
        Ok(())
    }

    /// Test-only unscoped claim helper. Production pumps use the
    /// session-scoped API below.
    #[cfg(test)]
    pub fn next_wire_message(&self) -> Option<PendingCommand> {
        self.claim_wire_message(None)
    }

    /// Claims only for the session requesting a message. Session identity
    /// and queue removal are checked under the same adapter lock.
    pub fn next_wire_message_for_session(&self, session_id: &str) -> Option<PendingCommand> {
        self.claim_wire_message(Some(session_id))
    }

    fn claim_wire_message(&self, requested_session: Option<&str>) -> Option<PendingCommand> {
        if !self.gate || !self.local_trading_enabled {
            return None;
        }
        let mut inner = self.inner.lock().expect("execution adapter mutex poisoned");
        if requested_session
            .is_some_and(|session_id| inner.session_id.as_deref() != Some(session_id))
        {
            return None;
        }
        if !inner.trading_enabled || !inner.reconciliation_complete {
            return None;
        }
        // Keep the read-only bridge session alive, but do not dispatch after
        // a journal failure or when durable execution state is unavailable.
        if !self.safety.is_available() {
            return None;
        }
        if inner.in_flight.is_some() {
            return None;
        }
        let command = inner.queue.pop_front()?;
        inner.in_flight = Some(command.command_id.clone());
        inner.in_flight_at_update = 0;
        Some(command)
    }

    /// Applies one EA `order_command_update`. Account binding (F-5) is
    /// verified first: a mismatch rejects with
    /// [`ExecutionAdapterError::AccountMismatch`] and changes nothing. The
    /// journal append runs next. A settled slot is released only when the
    /// registry accepted the update or durable storage failed. Invalid and
    /// stale updates preserve the slot; storage failure also blocks later
    /// claims while leaving read-only bridge operation available.
    #[cfg(test)]
    pub fn apply_command_update(
        &self,
        update: OrderCommandUpdate,
    ) -> Result<Option<()>, ExecutionAdapterError> {
        self.apply_command_update_inner(None, update)
    }

    /// Applies an inbound update only while it belongs to the active bridge
    /// session. Session validation, account binding, journal application,
    /// and slot settlement are serialized with session replacement.
    pub fn apply_command_update_for_session(
        &self,
        session_id: &str,
        update: OrderCommandUpdate,
    ) -> Result<Option<()>, ExecutionAdapterError> {
        self.apply_command_update_inner(Some(session_id), update)
    }

    fn apply_command_update_inner(
        &self,
        requested_session: Option<&str>,
        update: OrderCommandUpdate,
    ) -> Result<Option<()>, ExecutionAdapterError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| ExecutionAdapterError::Poisoned)?;
        if requested_session
            .is_some_and(|session_id| inner.session_id.as_deref() != Some(session_id))
        {
            return Err(ExecutionAdapterError::StaleSession);
        }
        self.verify_account_binding(&inner, &update.command_id)?;
        let settled = is_settled_status(&update.status);
        let journaled = self.safety.apply_command_update(update.clone());
        let storage_failed = matches!(
            &journaled,
            Err(JournalError::Unavailable
                | JournalError::Poisoned
                | JournalError::Io(_)
                | JournalError::TooManyEntries
                | JournalError::FileTooLarge(_)
                | JournalError::InvalidRecordLength(_))
        );
        let is_in_flight = inner.in_flight.as_deref() == Some(update.command_id.as_str());
        if settled && (matches!(journaled, Ok(true)) || storage_failed) {
            if is_in_flight {
                inner.in_flight = None;
            }
        } else if is_in_flight && matches!(journaled, Ok(true)) {
            inner.in_flight_at_update = update.at_update;
        }
        drop(inner);
        let applied = journaled.map_err(ExecutionAdapterError::Journal)?;
        if !applied {
            return Ok(None);
        }
        Ok(Some(()))
    }

    /// Applies one EA `order_command_error`: the error is journaled as an
    /// audit fact and never changes command state. Account binding (F-5) is
    /// verified first — a mismatch rejects with no state change. The journal
    /// append runs next, and the in-flight slot / still-queued command are
    /// released by `command_id` REGARDLESS of the journal outcome (F-3);
    /// the journal failure then surfaces without ever wedging the queue. The
    /// session is never torn by an error.
    #[cfg(test)]
    pub fn apply_command_error(
        &self,
        error: OrderCommandError,
    ) -> Result<(), ExecutionAdapterError> {
        self.apply_command_error_inner(None, error)
    }

    /// Applies an inbound command error only if its originating session is
    /// still active; old-session errors cannot release a replacement slot.
    pub fn apply_command_error_for_session(
        &self,
        session_id: &str,
        error: OrderCommandError,
    ) -> Result<(), ExecutionAdapterError> {
        self.apply_command_error_inner(Some(session_id), error)
    }

    fn apply_command_error_inner(
        &self,
        requested_session: Option<&str>,
        error: OrderCommandError,
    ) -> Result<(), ExecutionAdapterError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| ExecutionAdapterError::Poisoned)?;
        if requested_session
            .is_some_and(|session_id| inner.session_id.as_deref() != Some(session_id))
        {
            return Err(ExecutionAdapterError::StaleSession);
        }
        self.verify_account_binding(&inner, &error.command_id)?;
        let journaled = self.safety.apply_command_error(error.clone());
        if inner.in_flight.as_deref() == Some(error.command_id.as_str()) {
            inner.in_flight = None;
        }
        inner
            .queue
            .retain(|command| command.command_id != error.command_id);
        drop(inner);
        journaled.map_err(ExecutionAdapterError::Journal)
    }

    /// A new bridge session must not inherit anything from the previous one
    /// (F-1): the previous in-flight command is journaled as `unknown` (it
    /// may have reached the broker and is never retried) and every queued
    /// command is dropped with a `QueueDropped` journal event — nothing is
    /// ever auto-dispatched into the new session ("restart or reconnect must
    /// not replay commands as new orders"). Then arms the F-2 claim
    /// gates from the handshake and installs the F-5 session account binding;
    /// reconciliation restarts as not-complete for the new session.
    #[cfg(test)]
    pub fn session_started(&self, trading_enabled: bool, account_login: &str, broker_server: &str) {
        self.start_session(None, trading_enabled, account_login, broker_server);
    }

    /// Starts a bridge session with an id used by session-scoped enqueue and
    /// claim APIs. Queue drain and claim-gate setup match `session_started`.
    pub fn session_started_for_session(
        &self,
        session_id: &str,
        trading_enabled: bool,
        account_login: &str,
        broker_server: &str,
    ) {
        self.start_session(
            Some(session_id.to_owned()),
            trading_enabled,
            account_login,
            broker_server,
        );
    }

    fn start_session(
        &self,
        session_id: Option<String>,
        trading_enabled: bool,
        account_login: &str,
        broker_server: &str,
    ) {
        self.transition_session(
            "session replaced",
            session_id,
            trading_enabled,
            Some((account_login.to_owned(), broker_server.to_owned())),
        );
    }

    /// Session teardown (F-1) drains the queue with a "session closed" reason
    /// and clears the session context so
    /// the UI never keeps a stale in-flight id and no claim gate stays armed.
    pub fn session_closed(&self) {
        self.transition_session("session closed", None, false, None);
    }

    /// F-2 claim-gate part: called from lib.rs wherever a
    /// `ReconciliationStatus` is published; only `Complete` lets the pump
    /// claim commands.
    pub fn set_reconciliation_complete(&self, complete: bool) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.reconciliation_complete = complete;
        }
    }

    /// Shared session close/replace drain (F-1). In-memory state resets
    /// FIRST so the queue can never wedge, then the journal append happens
    /// best-effort: at teardown there is no live session left to answer with
    /// a frame. The in-flight command transitions to `unknown` through the
    /// normal journaled update path; the queued commands become one
    /// `QueueDropped` event, which also refreshes the `stranded` view count
    /// (overwritten per transition, never accumulated).
    fn transition_session(
        &self,
        reason: &str,
        session_id: Option<String>,
        trading_enabled: bool,
        session_account: Option<(String, String)>,
    ) {
        let (in_flight, watermark, queued) = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let in_flight = inner.in_flight.take();
            let watermark = inner.in_flight_at_update;
            inner.in_flight_at_update = 0;
            let queued: Vec<String> = inner
                .queue
                .drain(..)
                .map(|command| command.command_id)
                .collect();
            if !queued.is_empty() {
                inner.stranded = queued.len();
            }
            // Replace the account and session token in the same critical
            // section as draining the prior queue, so no old operation can
            // slip between teardown and the next session's installation.
            inner.session_id = session_id;
            inner.trading_enabled = trading_enabled;
            inner.reconciliation_complete = false;
            inner.session_account = session_account;
            (in_flight, watermark, queued)
        };
        if let Some(command_id) = in_flight {
            // The claim handed this command to the wire, so its outcome is
            // unknown: journal `unknown` at a fresh `at_update`, never retry.
            let _ = self.safety.apply_command_update(OrderCommandUpdate {
                command_id,
                status: "unknown".into(),
                retcode: None,
                last_error: None,
                broker_order_id: None,
                deal_id: None,
                position_id: None,
                filled_volume: None,
                message: None,
                updated_at_ms: wall_now_ms(),
                at_update: watermark + 1,
            });
        }
        if !queued.is_empty() {
            let _ = self.safety.record_queue_dropped(queued, reason.to_owned());
        }
    }

    /// F-5: an inbound update/error must belong to the registered intent's
    /// account binding, and that binding must equal the active session
    /// account. A mismatch is rejected with no state change; with no session
    /// context or no readable binding there is nothing to compare, and the
    /// journal path keeps rejecting whatever it must.
    fn verify_account_binding(
        &self,
        inner: &AdapterInner,
        command_id: &str,
    ) -> Result<(), ExecutionAdapterError> {
        let Some((session_login, session_server)) = &inner.session_account else {
            return Ok(());
        };
        let Some((intent_login, intent_server)) = self.safety.command_account(command_id) else {
            return Ok(());
        };
        if intent_login == *session_login && intent_server == *session_server {
            Ok(())
        } else {
            Err(ExecutionAdapterError::AccountMismatch)
        }
    }
}

/// The command lifecycle is settled once the EA reports the server's final
/// decision for it; later updates for that command may still arrive (e.g.
/// fills after `server_accepted`) and are applied without touching the
/// already-released slot of the next command.
fn is_settled_status(status: &str) -> bool {
    matches!(
        status,
        "server_accepted" | "filled" | "rejected" | "unknown"
    )
}

#[cfg(test)]
mod tests;
