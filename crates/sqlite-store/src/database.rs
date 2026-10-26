//! The open database behind one mutex and the lock of this app instance.

use super::{
    connection::{open_database, open_in_memory},
    error::{Fault, Outcome, StoreError},
    file::{acquire_exclusive_lock, create_parent_directory, ExclusiveLock},
    schema::Migration,
};
use rusqlite::{Connection, TransactionBehavior};
use std::{path::Path, sync::Mutex};

/// One database file, opened and migrated, with one writer at a time.
pub struct SqliteDatabase {
    connection: Mutex<Connection>,
    /// Held for as long as the database is open, so a second app instance fails with `Locked`.
    _lock: Option<ExclusiveLock>,
}

impl SqliteDatabase {
    /// Opens, checks and migrates the file at `path`. A refused file is never written to.
    pub fn open(
        path: &Path,
        application_id: i32,
        migrations: &[Migration],
    ) -> Result<Self, StoreError> {
        create_parent_directory(path)?;
        let lock = acquire_exclusive_lock(path)?;
        let connection = open_database(path, application_id, migrations)?;
        Ok(Self::holding(connection, Some(lock)))
    }

    /// A database that lives and dies with this value; the tests of a store use it.
    pub fn in_memory(application_id: i32, migrations: &[Migration]) -> Result<Self, StoreError> {
        let connection = open_in_memory(application_id, migrations)?;
        Ok(Self::holding(connection, None))
    }

    /// Runs one read; nothing is written, so an unreadable file is never modified.
    pub fn read<T>(&self, work: impl FnOnce(&Connection) -> Outcome<T>) -> Result<T, StoreError> {
        let connection = self.connection.lock().map_err(|_| StoreError::Unreadable)?;
        work(&connection).map_err(|fault| fault.into_error(StoreError::Unreadable))
    }

    /// Runs one write in a single `IMMEDIATE` transaction, which commits only when the
    /// closure succeeds: a refused write leaves every row as it was.
    pub fn write<T>(&self, work: impl FnOnce(&Connection) -> Outcome<T>) -> Result<T, StoreError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::WriteFailed)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| Fault::from(error).into_error(StoreError::WriteFailed))?;
        let value =
            work(&transaction).map_err(|fault| fault.into_error(StoreError::WriteFailed))?;
        transaction
            .commit()
            .map_err(|error| Fault::from(error).into_error(StoreError::WriteFailed))?;
        Ok(value)
    }

    fn holding(connection: Connection, lock: Option<ExclusiveLock>) -> Self {
        Self {
            connection: Mutex::new(connection),
            _lock: lock,
        }
    }
}
