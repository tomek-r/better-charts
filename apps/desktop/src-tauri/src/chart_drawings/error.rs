//! Why saved chart drawings, or the time zone a chart keeps, could not be read or stored.
//!
//! Every variant carries the sentence the user reads: the frontend shows the message of a
//! refused command as it is, so paths, operating-system text and SQLite details stay behind
//! in the store.

use sqlite_store::StoreError;
use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub(crate) enum ChartDrawingError {
    /// The database could not be read or held rows this build cannot trust, so it must not be
    /// overwritten: the drawings the user saved stay where they are.
    #[error("Saved drawings could not be read")]
    Unreadable,
    /// The drawings could not be written; the database keeps its previous rows.
    #[error("Drawings could not be saved")]
    Unwritable,
    /// Another Better Charts window has the drawings database open.
    #[error("Another Better Charts window holds the drawings database")]
    DatabaseHeldByAnotherWindow,
    /// The time zone saved for a chart could not be read, so the chart shows its default until
    /// the row is repaired.
    #[error("The chart's saved time zone could not be read")]
    TimeZoneUnreadable,
    /// The picked time zone could not be written; the database keeps the previous one.
    #[error("The chart's time zone could not be saved")]
    TimeZoneUnwritable,
    /// A record, a scope, a list or a time zone breached one of the limits the store enforces.
    #[error("{0}")]
    Invalid(String),
}

impl ChartDrawingError {
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

    /// Why reading a chart's saved time zone failed, in the words the user reads.
    pub(super) fn time_zone_while_reading(error: StoreError) -> Self {
        if matches!(error, StoreError::Locked) {
            Self::DatabaseHeldByAnotherWindow
        } else {
            Self::TimeZoneUnreadable
        }
    }

    /// Why saving a chart's time zone failed, in the words the user reads.
    pub(super) fn time_zone_while_writing(error: StoreError) -> Self {
        if matches!(error, StoreError::Locked) {
            Self::DatabaseHeldByAnotherWindow
        } else {
            Self::TimeZoneUnwritable
        }
    }
}
