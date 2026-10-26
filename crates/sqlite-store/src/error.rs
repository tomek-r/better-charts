//! Typed store errors. Messages stay generic, so they are safe to log and to show: no
//! path, account, symbol or value ever reaches them.

use rusqlite::ErrorCode;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StoreError {
    #[error("the store directory is unavailable")]
    DirectoryUnavailable,
    #[error("the database cannot be read")]
    Unreadable,
    #[error("the database is corrupt")]
    Corrupt,
    #[error("the database uses unsupported schema version {found}")]
    UnsupportedSchema { found: u32 },
    /// The header names another application, or the bytes are not a database at all.
    #[error("the file belongs to another application")]
    ForeignFile,
    #[error("the database is in use by another instance")]
    Locked,
    #[error("the database cannot be written")]
    WriteFailed,
    #[error("the pre-migration copy cannot be created")]
    BackupFailed,
}

/// Internal error that may still carry a SQLite error. It is converted to [`StoreError`]
/// at the public boundary, so a store implementation returns [`Outcome`] from its closures
/// without naming a `rusqlite` type in its own API.
#[derive(Debug)]
pub enum Fault {
    Store(StoreError),
    Sqlite(rusqlite::Error),
}

pub type Outcome<T> = Result<T, Fault>;

impl From<StoreError> for Fault {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<rusqlite::Error> for Fault {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl Fault {
    /// `fallback` names what failed when SQLite gives no more specific cause.
    pub fn into_error(self, fallback: StoreError) -> StoreError {
        match self {
            Self::Store(error) => error,
            Self::Sqlite(error) => classify_sqlite_error(&error).unwrap_or(fallback),
        }
    }
}

fn classify_sqlite_error(error: &rusqlite::Error) -> Option<StoreError> {
    match error.sqlite_error_code()? {
        ErrorCode::NotADatabase => Some(StoreError::ForeignFile),
        ErrorCode::DatabaseCorrupt => Some(StoreError::Corrupt),
        ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => Some(StoreError::Locked),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_carry_no_input_data() {
        let all = [
            StoreError::DirectoryUnavailable,
            StoreError::Unreadable,
            StoreError::Corrupt,
            StoreError::ForeignFile,
            StoreError::Locked,
            StoreError::WriteFailed,
            StoreError::BackupFailed,
        ];
        for error in all {
            assert!(!error.to_string().chars().any(|c| c.is_ascii_digit()));
        }
    }
}
