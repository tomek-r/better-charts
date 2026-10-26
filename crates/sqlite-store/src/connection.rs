//! Opening the database: header checks, integrity check, connection settings
//! and migrations. A file that fails any check is never modified.

use super::{
    error::{Fault, Outcome, StoreError},
    file::create_private_file_if_missing,
    schema::{latest_version, migrate, Migration},
};
use rusqlite::{Connection, OpenFlags};
use std::{path::Path, time::Duration};

const BUSY_TIMEOUT: Duration = Duration::from_millis(5_000);
const INTEGRITY_CHECK_PASSED: &str = "ok";
const QUICK_INTEGRITY_CHECK: &str = "quick_check";
const WAL_JOURNAL_MODE: &str = "wal";

/// What the header of an existing file says about it.
struct Header {
    application_id: i32,
    user_version: u32,
    has_tables: bool,
}

impl Header {
    /// A file that was just created, or an empty one: no schema yet.
    fn is_new(&self) -> bool {
        self.application_id == 0 && self.user_version == 0 && !self.has_tables
    }
}

pub(crate) fn open_database(
    path: &Path,
    application_id: i32,
    migrations: &[Migration],
) -> Result<Connection, StoreError> {
    create_private_file_if_missing(path).map_err(|_| StoreError::DirectoryUnavailable)?;
    let header = check_file(path, application_id, latest_version(migrations))?;
    open_and_migrate(path, application_id, header.user_version, migrations)
        .map_err(|fault| fault.into_error(StoreError::WriteFailed))
}

pub(crate) fn open_in_memory(
    application_id: i32,
    migrations: &[Migration],
) -> Result<Connection, StoreError> {
    let mut connection = Connection::open_in_memory()
        .map_err(|error| Fault::from(error).into_error(StoreError::Unreadable))?;
    configure(&connection, false)
        .and_then(|()| migrate(&mut connection, None, 0, migrations, application_id))
        .map_err(|fault| fault.into_error(StoreError::WriteFailed))?;
    Ok(connection)
}

/// Reads the file through a read-only connection, so a refused file is never
/// written to, not even by a journal-mode change.
fn check_file(
    path: &Path,
    application_id: i32,
    supported_version: u32,
) -> Result<Header, StoreError> {
    let probe = |fault: Fault| fault.into_error(StoreError::Unreadable);
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| probe(error.into()))?;
    let header = read_header(&connection).map_err(probe)?;
    if !header.is_new() && header.application_id != application_id {
        return Err(StoreError::ForeignFile);
    }
    if header.user_version > supported_version {
        return Err(StoreError::UnsupportedSchema {
            found: header.user_version,
        });
    }
    if !header.is_new() {
        require_integrity(&connection, QUICK_INTEGRITY_CHECK).map_err(probe)?;
    }
    Ok(header)
}

fn read_header(connection: &Connection) -> Outcome<Header> {
    let application_id: i32 =
        connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let user_version: i64 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let table_count: i64 =
        connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))?;
    Ok(Header {
        application_id,
        user_version: u32::try_from(user_version).map_err(|_| StoreError::Corrupt)?,
        has_tables: table_count > 0,
    })
}

fn require_integrity(connection: &Connection, check: &str) -> Outcome<()> {
    let verdict: String = connection.pragma_query_value(None, check, |row| row.get(0))?;
    if verdict == INTEGRITY_CHECK_PASSED {
        Ok(())
    } else {
        Err(StoreError::Corrupt.into())
    }
}

fn open_and_migrate(
    path: &Path,
    application_id: i32,
    version: u32,
    migrations: &[Migration],
) -> Outcome<Connection> {
    let mut connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    configure(&connection, true)?;
    migrate(
        &mut connection,
        Some(path),
        version,
        migrations,
        application_id,
    )?;
    Ok(connection)
}

/// `foreign_keys` and `busy_timeout` are per connection; WAL is stored in the
/// file and does not apply to an in-memory database.
fn configure(connection: &Connection, write_ahead_log: bool) -> Outcome<()> {
    connection.busy_timeout(BUSY_TIMEOUT)?;
    if write_ahead_log {
        let mode: String =
            connection.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
        if !mode.eq_ignore_ascii_case(WAL_JOURNAL_MODE) {
            return Err(StoreError::WriteFailed.into());
        }
    }
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection.pragma_update(None, "foreign_keys", true)?;
    Ok(())
}
