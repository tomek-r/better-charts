//! Tauri application entry point: bridge wiring and command registration.

mod app_settings;
mod bridge;
mod download_resources;
mod execution_adapter;
mod execution_journal;
mod mt5_backend;
mod runtime_config;

use app_settings::{get_app_settings, save_app_settings, AppSettingsState};
use bridge::commands::{
    cancel_order, cancel_tick_profile, close_position, get_account_snapshot, get_bridge_status,
    get_execution_queue_status, get_execution_recovery_snapshot, get_execution_safety_status,
    get_market_snapshot, get_mt5_backend_status, get_portfolio_snapshot, get_quote_snapshot,
    get_reconciliation_status, modify_order, project_risk_preview, request_history,
    request_history_page, request_order_check, request_risk_preview, request_tick_profile,
    search_symbols, start_mt5_backend, stop_mt5_backend, submit_order,
};
use bridge::connection::run_server;
use bridge::state::BridgeState;
use download_resources::save_bundled_resource;
use execution_adapter::ExecutionAdapterState;
use execution_journal::{app_data_dir, ExecutionSafetyState};
use mt5_backend::Mt5BackendState;
use tauri::Manager;

pub fn run() {
    let runtime_error = runtime_config::load()
        .err()
        .map(|error| format!("{error}; fix or remove the runtime .env file and restart"));
    let app_settings = AppSettingsState::load(runtime_error);
    let trading_enabled = app_settings.startup_trading_enabled();
    let bridge_state = BridgeState::default();
    let mt5_backend = Mt5BackendState::from_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_settings)
        .manage(bridge_state.clone())
        .manage(mt5_backend.clone())
        .invoke_handler(tauri::generate_handler![
            get_app_settings,
            save_app_settings,
            get_execution_safety_status,
            get_execution_recovery_snapshot,
            get_execution_queue_status,
            get_reconciliation_status,
            submit_order,
            modify_order,
            close_position,
            cancel_order,
            get_bridge_status,
            get_market_snapshot,
            get_quote_snapshot,
            get_account_snapshot,
            get_portfolio_snapshot,
            project_risk_preview,
            request_risk_preview,
            request_order_check,
            request_history,
            request_history_page,
            request_tick_profile,
            cancel_tick_profile,
            search_symbols,
            get_mt5_backend_status,
            start_mt5_backend,
            stop_mt5_backend,
            save_bundled_resource
        ])
        .setup(move |app| {
            let safety = match app_data_dir() {
                Some(directory) => {
                    ExecutionSafetyState::open(directory.join("execution-journal-v1.bin"))
                }
                None => ExecutionSafetyState::unavailable(),
            };
            app.manage(safety.clone());
            let adapter =
                ExecutionAdapterState::new_with_trading_permission(safety, trading_enabled);
            app.manage(adapter.clone());
            tauri::async_runtime::spawn(run_server(
                app.handle().clone(),
                bridge_state.clone(),
                adapter,
            ));
            // Saved settings or explicit runtime overrides opt into auto-start.
            // Existing sessions, unknown process state, and missing installation
            // paths suppress startup; failures do not prevent opening settings.
            let bridge_session_active = bridge_state
                .current_session
                .lock()
                .map(|session| session.is_some())
                .unwrap_or(false);
            mt5_backend.auto_start_best_effort(bridge_session_active);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}

#[cfg(test)]
mod version_tests {
    //! The app version has one definition: `package.json`. The frontend reads it
    //! at build time (vite.config.ts) and Tauri reads the same file for the
    //! bundle, because `tauri.conf.json`'s `version` points at it. These guards
    //! keep the remaining copies from drifting silently: a release bump touches
    //! `package.json` and the crate version, and the second test fails until the
    //! crate version follows.

    #[test]
    fn tauri_bundle_version_is_read_from_package_json() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json parses");
        assert_eq!(config["version"], "../package.json");
    }

    #[test]
    fn cargo_manifest_version_matches_package_json() {
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("package.json parses");
        assert_eq!(package["version"], env!("CARGO_PKG_VERSION"));
    }
}
