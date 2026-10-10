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
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// Label of the window declared in `tauri.conf.json`; the config creates it hidden.
const MAIN_WINDOW_LABEL: &str = "main";
/// Upper bound on how long the window stays hidden if no page-load event arrives.
const WINDOW_REVEAL_FALLBACK: Duration = Duration::from_secs(3);

/// Native window title. Cross-language pair: `appTitle` in `vite.config.ts`
/// produces the same `Better Charts v<version>` for the HTML document title.
fn window_title(version: impl std::fmt::Display) -> String {
    format!("Better Charts v{version}")
}

/// Physical-pixel bounds `(position, inner size)` that make a hidden window's
/// client area equal what maximizing it later produces.
///
/// A maximized Windows window has its frame (`border` per side, invisible) hanging
/// outside the work area, so the outer rect is the work area grown by `border` on
/// every side, and the client area is that minus the decoration (frame + caption).
/// `decoration` is `outer - inner` of the current window.
fn maximized_bounds(
    work_position: (i32, i32),
    work_size: (u32, u32),
    decoration: (u32, u32),
) -> ((i32, i32), (u32, u32)) {
    let border = i64::from(decoration.0 / 2);
    let fit = |work: u32, decoration: u32| {
        u32::try_from((i64::from(work) + 2 * border - i64::from(decoration)).max(1)).unwrap_or(1)
    };
    let origin = |work: i32| i32::try_from(i64::from(work) - border).unwrap_or(work);
    (
        (origin(work_position.0), origin(work_position.1)),
        (
            fit(work_size.0, decoration.0),
            fit(work_size.1, decoration.1),
        ),
    )
}

/// Gives the still-hidden window the geometry it will have once maximized.
///
/// tao stores the `maximized` flag but does not call `ShowWindow(SW_MAXIMIZE)`
/// while the window is hidden (`window_state.rs`, "avoid the window from
/// flashing"), so until `show()` the client area keeps the default 800x600 and
/// the page lays out at that size, then visibly reflows on reveal. Pre-sizing to
/// the monitor work area (taskbar excluded) lets the page lay out at its final
/// size; `show()` then maximizes to the same bounds. Physical pixels throughout,
/// so DPI scaling needs no conversion. Any missing information leaves the window
/// as configured.
fn size_hidden_window_to_work_area<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) else {
        return;
    };
    let work = monitor.work_area();
    let (position, size) = maximized_bounds(
        (work.position.x, work.position.y),
        (work.size.width, work.size.height),
        (
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        ),
    );
    let _ = window.set_position(PhysicalPosition::new(position.0, position.1));
    let _ = window.set_size(PhysicalSize::new(size.0, size.1));
    // tao clears the maximized flag on any position or size change; restore it so
    // `show()` still maximizes (to these same bounds) instead of showing a normal
    // window placed partly off-screen.
    let _ = window.maximize();
}

/// Shows the config-created (hidden, maximized) window. Idempotent: the page-load
/// hook, its reloads, and the fallback timer may all call it. Failures are
/// ignored because a window that cannot be shown has no better recovery here.
fn reveal_window<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_visible().unwrap_or(false) {
        return;
    }
    // Title comes from the package version (single source: package.json), so
    // the first visible frame already carries it.
    let _ = window.set_title(&window_title(&window.package_info().version));
    let _ = window.show();
    let _ = window.set_focus();
}

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
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished && webview.label() == MAIN_WINDOW_LABEL {
                if let Some(window) = webview.app_handle().get_webview_window(MAIN_WINDOW_LABEL) {
                    reveal_window(&window);
                }
            }
        })
        .setup(move |app| {
            // The window starts hidden so it is never shown at the default
            // size or before content; this timer keeps a lost page-load event
            // from leaving it hidden forever.
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                size_hidden_window_to_work_area(&window);
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(WINDOW_REVEAL_FALLBACK).await;
                    reveal_window(&window);
                });
            }
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
mod window_tests {
    #[test]
    fn maximized_bounds_extend_the_work_area_by_the_invisible_frame() {
        // 1920x1040 work area at (0, 0); frame 7 px per side, caption 31 px:
        // decoration = (14, 14 + 31). Client must be work width x (work - caption).
        let (position, size) = super::maximized_bounds((0, 0), (1920, 1040), (14, 45));
        assert_eq!(position, (-7, -7));
        assert_eq!(size, (1920, 1009));
    }

    #[test]
    fn maximized_bounds_follow_a_secondary_monitor_offset() {
        let (position, _) = super::maximized_bounds((-2560, 0), (2560, 1400), (14, 45));
        assert_eq!(position, (-2567, -7));
    }

    #[test]
    fn title_is_brand_followed_by_the_package_version() {
        assert_eq!(super::window_title("1.2.3"), "Better Charts v1.2.3");
    }
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
