//! Consistent single-file copy of a live database.

use super::{
    error::{Outcome, StoreError},
    file::create_new_private_file,
};
use rusqlite::Connection;
use std::{fs, path::Path};

/// Writes a consistent, compacted copy of the open database to `destination`
/// with `VACUUM INTO`, which works while the app keeps using the connection.
/// The destination must not exist; on failure nothing is left behind.
pub(crate) fn copy_database_to_new_file(
    connection: &Connection,
    destination: &Path,
) -> Outcome<()> {
    let destination_text = destination.to_str().ok_or(StoreError::BackupFailed)?;
    // SQLite accepts an empty file here, so the copy is private from the
    // moment it exists.
    create_new_private_file(destination).map_err(|_| StoreError::BackupFailed)?;
    if let Err(error) = connection.execute("VACUUM INTO ?1", [destination_text]) {
        let _ = fs::remove_file(destination);
        return Err(error.into());
    }
    Ok(())
}
