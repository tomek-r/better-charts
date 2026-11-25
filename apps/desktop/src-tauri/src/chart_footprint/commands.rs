//! The Tauri command the chart turns its footprint on and off with.

use super::{apply, ChartFootprintRequest};
use crate::bridge::state::BridgeState;
use tauri::State;

/// Turns the chart footprint on with `settings`, or off with `null`.
///
/// Turning it on starts the window's tick read too, which publishes `chart-footprint` when it
/// finishes. A request the host cannot publish is refused as its reason, so the chart never shows
/// rows the host would not compute.
///
/// Async so the session gate the read needs is never taken on the thread that draws the window.
#[tauri::command]
pub(crate) async fn set_chart_footprint(
    state: State<'_, BridgeState>,
    settings: Option<ChartFootprintRequest>,
) -> Result<(), String> {
    apply(&state, settings)
}
