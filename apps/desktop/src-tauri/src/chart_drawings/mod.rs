//! The drawings the user saved on the chart, kept by the Rust side instead of the webview: one
//! SQLite file under the app data folder, behind a [`ChartDrawingStore`]. The frontend talks to
//! two commands.
//!
//! A premium build plugs its own store into the same trait; the commands, the state and the
//! frontend contract stay as they are.

mod error;
mod limits;
mod record;
mod sqlite_drawing_store;
mod store;
#[cfg(test)]
mod tests;

use error::ChartDrawingError;
use record::ChartDrawingRecord;
use sqlite_drawing_store::SqliteChartDrawingStore;
use sqlite_store::StoreError;
use std::{path::PathBuf, sync::Arc};
use store::{ChartDrawingStore, DrawingScope, UnavailableChartDrawingStore};

/// Name of the drawings database below the app data folder.
const DATABASE_FILE_NAME: &str = "better-charts.sqlite3";

/// The store the two commands work through.
pub(crate) struct ChartDrawingsState(Arc<dyn ChartDrawingStore>);

impl ChartDrawingsState {
    /// The store of this machine: the drawings database below `app_data`. A missing app data
    /// folder, or a database that cannot be opened, yields a store whose every call fails with
    /// that reason, because there is nowhere trustworthy to keep the drawings; nothing panics.
    pub(crate) fn open(app_data: Option<PathBuf>) -> Self {
        let opened = app_data.map_or(Err(StoreError::DirectoryUnavailable), |directory| {
            SqliteChartDrawingStore::open(&directory.join(DATABASE_FILE_NAME))
        });
        match opened {
            Ok(store) => Self(Arc::new(store)),
            Err(error) => Self(Arc::new(UnavailableChartDrawingStore::for_failure(error))),
        }
    }

    /// A handle the blocking thread can own, so the command borrows nothing across it.
    fn store(&self) -> Arc<dyn ChartDrawingStore> {
        Arc::clone(&self.0)
    }
}

/// Every drawing saved for one account and symbol. Rows the store cannot read are an error, so
/// the frontend never loads them as an empty chart.
#[tauri::command]
pub(crate) async fn load_chart_drawings(
    state: tauri::State<'_, ChartDrawingsState>,
    account_key: String,
    symbol: String,
) -> Result<Vec<ChartDrawingRecord>, String> {
    let store = state.store();
    let scope = DrawingScope::new(account_key, symbol).map_err(|error| error.to_string())?;
    run_blocking(move || store.load(&scope)).await
}

/// Replaces the drawings of one account and symbol; an empty list removes them.
#[tauri::command]
pub(crate) async fn save_chart_drawings(
    state: tauri::State<'_, ChartDrawingsState>,
    account_key: String,
    symbol: String,
    records: Vec<ChartDrawingRecord>,
) -> Result<(), String> {
    let store = state.store();
    let scope = DrawingScope::new(account_key, symbol).map_err(|error| error.to_string())?;
    run_blocking(move || store.save(&scope, &records)).await
}

/// Runs one store call on a blocking thread, so the UI thread never waits on disk.
async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, ChartDrawingError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Saved drawings are unavailable: {error}"))?
        .map_err(|error| error.to_string())
}
