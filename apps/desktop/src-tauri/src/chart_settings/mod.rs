//! The charts the user saved and the settings each one is drawn with, kept by the Rust side in
//! the app database behind a [`ChartSettingsStore`]. A chart is drawn with the settings of its
//! template and the overrides of the account and symbol it shows; the frontend owns which fields
//! those documents hold, so this side only keeps them as one JSON object each.
//!
//! A premium build plugs its own store into the same trait; the commands, the state and the
//! frontend contract stay as they are.

mod error;
mod settings_document;
mod sqlite_settings_store;
mod store;
#[cfg(test)]
mod tests;

use crate::chart_database::{run_blocking, ChartScope};
use error::ChartSettingsError;
use serde_json::{Map, Value};
use settings_document::SettingsDocument;
use sqlite_settings_store::SqliteChartSettingsStore;
use sqlite_store::{SqliteDatabase, StoreError};
use std::sync::Arc;
use store::{ChartLayoutEntry, ChartSettings, ChartSettingsStore, UnavailableChartSettingsStore};

/// The sentence the frontend shows when a store call never finished.
const UNAVAILABLE_MESSAGE: &str = "Saved chart settings are unavailable";

/// The store the settings commands work through.
pub(crate) struct ChartSettingsState(Arc<dyn ChartSettingsStore>);

impl ChartSettingsState {
    /// The store over the chart database `opened`, or — when that database could not be opened —
    /// a store whose every call fails with the reason, because inventing a chart would hide that
    /// the settings the user made cannot be read.
    pub(crate) fn from_database(opened: Result<Arc<SqliteDatabase>, StoreError>) -> Self {
        match opened {
            Ok(database) => Self(Arc::new(SqliteChartSettingsStore::from_database(database))),
            Err(error) => Self(Arc::new(UnavailableChartSettingsStore::for_failure(error))),
        }
    }

    /// A handle the blocking thread can own, so the command borrows nothing across it.
    fn store(&self) -> Arc<dyn ChartSettingsStore> {
        Arc::clone(&self.0)
    }
}

/// Every saved chart in layout order. A database without a chart answers with one chart, created
/// by the store, so the frontend always has a chart to draw.
#[tauri::command]
pub(crate) async fn load_chart_layout(
    state: tauri::State<'_, ChartSettingsState>,
) -> Result<Vec<ChartLayoutEntry>, String> {
    let store = state.store();
    run_blocking(UNAVAILABLE_MESSAGE, move || store.load_layout()).await
}

/// The template and overrides of one chart for one account and symbol.
#[tauri::command]
pub(crate) async fn load_chart_settings(
    state: tauri::State<'_, ChartSettingsState>,
    chart_id: String,
    account_key: String,
    symbol: String,
) -> Result<ChartSettings, String> {
    let store = state.store();
    let scope = chart_scope(chart_id, account_key, symbol)?;
    run_blocking(UNAVAILABLE_MESSAGE, move || store.load_settings(&scope)).await
}

/// Replaces the overrides of one chart for one account and symbol; an empty document removes
/// them, so the chart falls back to its template.
#[tauri::command]
pub(crate) async fn save_chart_setting_overrides(
    state: tauri::State<'_, ChartSettingsState>,
    chart_id: String,
    account_key: String,
    symbol: String,
    overrides: Map<String, Value>,
) -> Result<(), String> {
    let store = state.store();
    let scope = chart_scope(chart_id, account_key, symbol)?;
    let overrides = SettingsDocument::new(overrides).map_err(|error| error.to_string())?;
    run_blocking(UNAVAILABLE_MESSAGE, move || {
        store.save_overrides(&scope, &overrides)
    })
    .await
}

/// The scope of one saved chart, or the sentence the frontend shows when it names no chart.
fn chart_scope(
    chart_id: String,
    account_key: String,
    symbol: String,
) -> Result<ChartScope, String> {
    ChartScope::new(chart_id, account_key, symbol)
        .map_err(|message| ChartSettingsError::Invalid(message).to_string())
}
