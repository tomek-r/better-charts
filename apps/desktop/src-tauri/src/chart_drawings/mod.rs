//! The drawings the user saved on a chart, kept by the Rust side instead of the webview: the app
//! database under the app data folder, behind a [`ChartDrawingStore`]. Every drawing names the
//! chart it was drawn on together with the account and symbol that chart shows, so the same
//! symbol opened on two charts keeps two lists. The frontend talks to one pair of commands.
//!
//! A premium build plugs its own store into the same trait; the commands, the state and the
//! frontend contract stay as they are.

mod error;
mod record;
mod sqlite_drawing_store;
mod store;
#[cfg(test)]
mod tests;
mod timeframe_visibility;

use crate::chart_database::{run_blocking, ChartScope};
use error::ChartDrawingError;
use record::ChartDrawingRecord;
use sqlite_drawing_store::SqliteChartDrawingStore;
use sqlite_store::{SqliteDatabase, StoreError};
use std::sync::Arc;
use store::{ChartDrawingStore, UnavailableChartDrawingStore};

/// The sentence the frontend shows when a store call never finished.
const UNAVAILABLE_MESSAGE: &str = "Saved drawings are unavailable";

/// The store the commands work through.
pub(crate) struct ChartDrawingsState(Arc<dyn ChartDrawingStore>);

impl ChartDrawingsState {
    /// The store over the chart database `opened`, or — when that database could not be opened —
    /// a store whose every call fails with the reason, because there is nowhere trustworthy to
    /// keep the drawings; nothing panics.
    pub(crate) fn from_database(opened: Result<Arc<SqliteDatabase>, StoreError>) -> Self {
        match opened {
            Ok(database) => Self(Arc::new(SqliteChartDrawingStore::from_database(database))),
            Err(error) => Self(Arc::new(UnavailableChartDrawingStore::for_failure(error))),
        }
    }

    /// A handle the blocking thread can own, so the command borrows nothing across it.
    fn store(&self) -> Arc<dyn ChartDrawingStore> {
        Arc::clone(&self.0)
    }
}

/// Every drawing saved on one chart for one account and symbol. Rows the store cannot read are
/// an error, so the frontend never loads them as an empty chart.
#[tauri::command]
pub(crate) async fn load_chart_drawings(
    state: tauri::State<'_, ChartDrawingsState>,
    chart_id: String,
    account_key: String,
    symbol: String,
) -> Result<Vec<ChartDrawingRecord>, String> {
    let store = state.store();
    let scope = chart_scope(chart_id, account_key, symbol)?;
    run_blocking(UNAVAILABLE_MESSAGE, move || store.load(&scope)).await
}

/// Replaces the drawings of one chart for one account and symbol; an empty list removes them.
#[tauri::command]
pub(crate) async fn save_chart_drawings(
    state: tauri::State<'_, ChartDrawingsState>,
    chart_id: String,
    account_key: String,
    symbol: String,
    records: Vec<ChartDrawingRecord>,
) -> Result<(), String> {
    let store = state.store();
    let scope = chart_scope(chart_id, account_key, symbol)?;
    run_blocking(UNAVAILABLE_MESSAGE, move || store.save(&scope, &records)).await
}

/// The scope of one saved chart, or the sentence the frontend shows when it names no chart.
fn chart_scope(
    chart_id: String,
    account_key: String,
    symbol: String,
) -> Result<ChartScope, String> {
    ChartScope::new(chart_id, account_key, symbol)
        .map_err(|message| ChartDrawingError::Invalid(message).to_string())
}
