use std::path::Path;

use serde::Serialize;
use trading_core::execution::{ExecutionIntent, RecoveryEntry};
use trading_core::protocol::{OrderCommandError, OrderCommandUpdate};

use super::{ExecutionJournal, JournalError};
use crate::execution_adapter::DISPATCH_ENABLED;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSafetyStatus {
    pub journal_state: &'static str,
    pub command_count: usize,
    pub dispatch_enabled: bool,
    pub message: String,
}

/// Gate clause shared by every [`ExecutionSafetyStatus`] message, so the
/// human-readable copy can never contradict the `dispatch_enabled` field it
/// is displayed next to.
fn dispatch_message_clause() -> &'static str {
    if DISPATCH_ENABLED {
        "dispatch is enabled (owner-approved)"
    } else {
        "dispatch remains locked"
    }
}

/// Managed Tauri safety state. In an error state the app remains available for
/// read-only features while every future execution path must remain disabled.
#[derive(Clone)]
pub struct ExecutionSafetyState {
    pub(super) journal: Option<ExecutionJournal>,
}

impl ExecutionSafetyState {
    pub fn open(path: impl AsRef<Path>) -> Self {
        match ExecutionJournal::open(path) {
            Ok(journal) => Self {
                journal: Some(journal),
            },
            Err(_) => Self::unavailable(),
        }
    }

    pub fn unavailable() -> Self {
        Self { journal: None }
    }

    /// Whether durable execution state is currently available. Queue claims
    /// consult this immediately before removing a pending command.
    pub fn is_available(&self) -> bool {
        self.journal
            .as_ref()
            .is_some_and(|journal| journal.command_count().is_ok())
    }

    #[cfg(test)]
    pub(crate) fn mark_unavailable_for_test(&self) {
        if let Some(journal) = &self.journal {
            if let Ok(mut inner) = journal.inner.lock() {
                inner.failed = true;
            }
        }
    }

    pub fn status(&self) -> ExecutionSafetyStatus {
        match &self.journal {
            Some(journal) => match journal.command_count() {
                Ok(command_count) => ExecutionSafetyStatus {
                    journal_state: "ready",
                    command_count,
                    dispatch_enabled: DISPATCH_ENABLED,
                    message: format!("Durable journal ready; {}.", dispatch_message_clause()),
                },
                Err(_) => ExecutionSafetyStatus {
                    journal_state: "error",
                    command_count: 0,
                    dispatch_enabled: DISPATCH_ENABLED,
                    message: format!(
                        "Execution journal unavailable; {}.",
                        dispatch_message_clause()
                    ),
                },
            },
            None => ExecutionSafetyStatus {
                journal_state: "error",
                command_count: 0,
                dispatch_enabled: DISPATCH_ENABLED,
                message: format!(
                    "Execution journal unavailable; {}.",
                    dispatch_message_clause()
                ),
            },
        }
    }

    // Test seam: no production caller yet; exercised by unit tests only.
    #[allow(dead_code)]
    pub fn register_validated(
        &self,
        intent: ExecutionIntent,
        at_ms: u64,
    ) -> Result<ExecutionSafetyStatus, JournalError> {
        let journal = self.journal.as_ref().ok_or(JournalError::Unavailable)?;
        journal.register_validated(intent, at_ms)?;
        Ok(self.status())
    }

    /// Durably records intent at `Prepared` without promoting it; the
    /// lifecycle advances only through EA command updates (the wire `accepted`
    /// status models local `Validated` in trading-core's `apply_update`).
    pub fn register(&self, intent: ExecutionIntent, at_ms: u64) -> Result<(), JournalError> {
        self.journal
            .as_ref()
            .ok_or(JournalError::Unavailable)?
            .register(intent, at_ms)
    }

    /// Durable delegate for one EA command update; see
    /// [`ExecutionJournal::apply_command_update`].
    pub fn apply_command_update(&self, update: OrderCommandUpdate) -> Result<bool, JournalError> {
        self.journal
            .as_ref()
            .ok_or(JournalError::Unavailable)?
            .apply_command_update(update)
    }

    /// Durable delegate for one EA command error; see
    /// [`ExecutionJournal::apply_command_error`].
    pub fn apply_command_error(&self, error: OrderCommandError) -> Result<(), JournalError> {
        self.journal
            .as_ref()
            .ok_or(JournalError::Unavailable)?
            .apply_command_error(error)
    }

    /// Durable delegate for one `QueueDropped` audit event; see
    /// [`ExecutionJournal::record_queue_dropped`].
    pub fn record_queue_dropped(
        &self,
        command_ids: Vec<String>,
        reason: String,
    ) -> Result<(), JournalError> {
        self.journal
            .as_ref()
            .ok_or(JournalError::Unavailable)?
            .record_queue_dropped(command_ids, reason)
    }

    /// Account binding of the registered intent behind `command_id`; see
    /// [`ExecutionJournal::command_account`].
    pub fn command_account(&self, command_id: &str) -> Option<(String, String)> {
        self.journal.as_ref()?.command_account(command_id)
    }

    pub fn recovery_snapshot(
        &self,
    ) -> Result<(ExecutionSafetyStatus, Vec<RecoveryEntry>), JournalError> {
        let journal = self.journal.as_ref().ok_or(JournalError::Unavailable)?;
        let (command_count, entries) = journal.recovery_snapshot()?;
        Ok((
            ExecutionSafetyStatus {
                journal_state: "ready",
                command_count,
                dispatch_enabled: DISPATCH_ENABLED,
                message: format!("Durable journal ready; {}.", dispatch_message_clause()),
            },
            entries,
        ))
    }
}
