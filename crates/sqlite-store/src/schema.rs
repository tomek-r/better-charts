//! Forward-only migrations and the copy taken before the first pending one runs.

use super::{
    error::{Outcome, StoreError},
    file::appended_suffix,
    snapshot::copy_database_to_new_file,
};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::{fs, path::Path};

/// How many pre-migration copies stay next to the database.
const PRE_MIGRATION_COPIES_KEPT: usize = 2;
const PRE_MIGRATION_COPY_INFIX: &str = ".pre-v";
const PRE_MIGRATION_COPY_SUFFIX: &str = ".bak";

/// One step of the schema: what version it produces and how to produce it.
pub struct Migration {
    pub target_version: u32,
    pub apply: fn(&Transaction<'_>) -> rusqlite::Result<()>,
}

pub fn latest_version(migrations: &[Migration]) -> u32 {
    migrations.last().map_or(0, |last| last.target_version)
}

/// Brings the database to the latest version. `current_version` is `0` for a
/// new file. Before the first step on an existing database, a consistent copy
/// is written next to it, so a bad migration is recoverable.
pub(crate) fn migrate(
    connection: &mut Connection,
    database_path: Option<&Path>,
    current_version: u32,
    migrations: &[Migration],
    application_id: i32,
) -> Outcome<()> {
    let pending: Vec<&Migration> = migrations
        .iter()
        .filter(|migration| migration.target_version > current_version)
        .collect();
    if pending.is_empty() {
        return Ok(());
    }
    if let (true, Some(path)) = (current_version > 0, database_path) {
        write_pre_migration_copy(connection, path, current_version)?;
    }
    for migration in pending {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        (migration.apply)(&transaction)?;
        transaction.pragma_update(None, "user_version", migration.target_version)?;
        // The identity is written by the framework, not by each store's first migration.
        transaction.pragma_update(None, "application_id", application_id)?;
        transaction.commit()?;
    }
    Ok(())
}

fn write_pre_migration_copy(
    connection: &Connection,
    database_path: &Path,
    version: u32,
) -> Outcome<()> {
    let destination = appended_suffix(
        database_path,
        &format!("{PRE_MIGRATION_COPY_INFIX}{version}{PRE_MIGRATION_COPY_SUFFIX}"),
    );
    if destination.exists() {
        fs::remove_file(&destination).map_err(|_| StoreError::BackupFailed)?;
    }
    copy_database_to_new_file(connection, &destination)?;
    prune_pre_migration_copies(database_path);
    Ok(())
}

/// Keeps the newest copies by the version they were taken at. Failing to
/// delete an old copy is harmless and must not block opening the database.
fn prune_pre_migration_copies(database_path: &Path) {
    let Some(directory) = database_path.parent() else {
        return;
    };
    let Some(file_name) = database_path.file_name() else {
        return;
    };
    let prefix = format!("{}{PRE_MIGRATION_COPY_INFIX}", file_name.to_string_lossy());
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut copies: Vec<(u32, std::path::PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let version = name
                .strip_prefix(&prefix)?
                .strip_suffix(PRE_MIGRATION_COPY_SUFFIX)?
                .parse()
                .ok()?;
            Some((version, entry.path()))
        })
        .collect();
    copies.sort_by_key(|(version, _)| std::cmp::Reverse(*version));
    for (_, path) in copies.into_iter().skip(PRE_MIGRATION_COPIES_KEPT) {
        let _ = fs::remove_file(path);
    }
}
