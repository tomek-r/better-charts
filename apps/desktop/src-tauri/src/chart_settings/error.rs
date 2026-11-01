//! Why saved chart settings could not be read or stored.
//!
//! Every variant carries the sentence the user reads: the frontend shows the message of a
//! refused command as it is, so paths, operating-system text and SQLite details stay behind
//! in the store.

use sqlite_store::StoreError;
use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub(crate) enum ChartSettingsError {
    /// The database could not be read or held settings this build cannot trust, so it must not
    /// be overwritten: the settings the user made stay where they are.
    #[error("Saved chart settings could not be read")]
    Unreadable,
    /// The settings could not be written; the database keeps its previous rows.
    #[error("Chart settings could not be saved")]
    Unwritable,
    /// Another Better Charts window has the chart database open.
    #[error("Another Better Charts window holds the chart database")]
    DatabaseHeldByAnotherWindow,
    /// The chart a setting belongs to is no longer in the database, so nothing could be read or
    /// written for it; the frontend has to lay its charts out again.
    #[error("This chart is no longer saved")]
    UnknownChart,
    /// A scope or a settings document breached one of the limits the store enforces.
    #[error("{0}")]
    Invalid(String),
}

impl ChartSettingsError {
    /// Why a load failed, in the words the user reads.
    pub(super) fn while_reading(error: StoreError) -> Self {
        if matches!(error, StoreError::Locked) {
            Self::DatabaseHeldByAnotherWindow
        } else {
            Self::Unreadable
        }
    }

    /// Why a save failed, in the words the user reads.
    pub(super) fn while_writing(error: StoreError) -> Self {
        if matches!(error, StoreError::Locked) {
            Self::DatabaseHeldByAnotherWindow
        } else {
            Self::Unwritable
        }
    }
}
