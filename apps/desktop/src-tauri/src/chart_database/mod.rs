//! The one SQLite file this app keeps: the charts, the drawings on them and the settings each
//! chart is drawn with. The drawing store and the settings store open it once at startup, so one
//! exclusive lock and one set of migrations covers everything the user saved.
//!
//! A premium build plugs its own stores into the same traits; the commands, the states and the
//! frontend contract stay as they are.

mod chart_scope;
pub(crate) mod limits;
mod migrations;

pub(crate) use chart_scope::ChartScope;

use migrations::{APPLICATION_ID, MIGRATIONS};
use sqlite_store::{SqliteDatabase, StoreError};
use std::{
    fmt::Display,
    path::{Path, PathBuf},
    sync::Arc,
};

/// Name of the app database below the app data folder. It holds both the drawings and the
/// settings, so it is named for the app rather than for either of them.
pub(crate) const DATABASE_FILE_NAME: &str = "better-charts.sqlite3";

/// Opens the app database below the app data folder, migrating it to the latest schema. Without
/// an app data folder there is nowhere trustworthy to keep the charts, so the caller gets
/// [`StoreError::DirectoryUnavailable`] and every store fails instead of losing what was saved.
pub(crate) fn open_chart_database(
    app_data: Option<PathBuf>,
) -> Result<Arc<SqliteDatabase>, StoreError> {
    let directory = app_data.ok_or(StoreError::DirectoryUnavailable)?;
    open(&directory.join(DATABASE_FILE_NAME))
}

/// A chart database that lives and dies with the test, migrated to the latest schema.
#[cfg(test)]
pub(crate) fn in_memory() -> Result<Arc<SqliteDatabase>, StoreError> {
    SqliteDatabase::in_memory(APPLICATION_ID, MIGRATIONS).map(Arc::new)
}

/// The chart database at `path` opened with only the migrations up to `version`, so a test can
/// write what the build before that version wrote and then open the file with this build.
#[cfg(test)]
pub(crate) fn open_at_version(
    path: &Path,
    version: u32,
) -> Result<Arc<SqliteDatabase>, StoreError> {
    let applied = MIGRATIONS
        .iter()
        .take_while(|migration| migration.target_version <= version)
        .count();
    SqliteDatabase::open(path, APPLICATION_ID, &MIGRATIONS[..applied]).map(Arc::new)
}

/// Runs one store call on a blocking thread, so the UI thread never waits on disk. A call whose
/// thread never finishes reports `unavailable_message`, the sentence the frontend shows, together
/// with why the thread failed; a call that finishes answers with the store's own sentence.
pub(crate) async fn run_blocking<T, E>(
    unavailable_message: &str,
    operation: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
    E: Display + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("{unavailable_message}: {error}"))?
        .map_err(|error| error.to_string())
}

/// The database at `path`, migrated to the latest schema.
fn open(path: &Path) -> Result<Arc<SqliteDatabase>, StoreError> {
    SqliteDatabase::open(path, APPLICATION_ID, MIGRATIONS).map(Arc::new)
}
