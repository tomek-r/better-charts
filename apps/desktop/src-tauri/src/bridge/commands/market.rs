//! Market and control surface: terminal lifecycle, bridge/chart readers,
//! history and tick-profile requests, symbol search and the reconciliation
//! status reader.

use super::super::{
    build_streamed_tick_profile, build_tick_profile, invalidate_validated_order_check, AccountView,
    BridgeState, BridgeStatus, HistoryRequest, MarketSnapshot, Mt5BackendState, Mt5BackendStatus,
    PortfolioView, QuoteView, ReconciliationStatus, State, SymbolInfoRequest, SymbolSearchRequest,
    SymbolSearchResultView, TickHistoryRequest, TickPageResult, TickProfileCancelledView,
    TickProfileRequest,
};
use tauri::Emitter;

#[tauri::command]
pub(crate) fn get_mt5_backend_status(state: State<'_, Mt5BackendState>) -> Mt5BackendStatus {
    state.status()
}

/// Manual control op — allowed regardless of the auto-start flag; refuses to
/// double-start an already-running terminal.
#[tauri::command]
pub(crate) fn start_mt5_backend(
    state: State<'_, Mt5BackendState>,
) -> Result<Mt5BackendStatus, String> {
    state.start()
}

#[tauri::command]
pub(crate) fn stop_mt5_backend(
    state: State<'_, Mt5BackendState>,
) -> Result<Mt5BackendStatus, String> {
    state.stop()
}

#[tauri::command]
pub(crate) fn get_bridge_status(state: State<'_, BridgeState>) -> BridgeStatus {
    state
        .status
        .lock()
        .expect("bridge status mutex poisoned")
        .clone()
}

#[tauri::command]
pub(crate) fn get_market_snapshot(state: State<'_, BridgeState>) -> MarketSnapshot {
    state.market.lock().expect("market mutex poisoned").clone()
}

#[tauri::command]
pub(crate) fn get_quote_snapshot(state: State<'_, BridgeState>) -> Option<QuoteView> {
    state.quote.lock().expect("quote mutex poisoned").clone()
}

#[tauri::command]
pub(crate) fn get_account_snapshot(state: State<'_, BridgeState>) -> Option<AccountView> {
    state
        .account
        .lock()
        .expect("account mutex poisoned")
        .clone()
}

#[tauri::command]
pub(crate) fn get_portfolio_snapshot(state: State<'_, BridgeState>) -> Option<PortfolioView> {
    state
        .portfolio
        .lock()
        .expect("portfolio mutex poisoned")
        .clone()
}

#[tauri::command]
pub(crate) fn request_history(
    state: State<'_, BridgeState>,
    symbol: String,
    timeframe: String,
    bars: u16,
) -> Result<(), String> {
    let request = HistoryRequest {
        symbol,
        timeframe,
        bars,
        before_ms: None,
    };
    request.validate().map_err(str::to_owned)?;
    let _session_work = state
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none()
    {
        return Err("bridge is not connected".into());
    }
    if !state
        .status
        .lock()
        .expect("bridge status mutex poisoned")
        .supported_timeframes
        .contains(&request.timeframe)
    {
        return Err("timeframe is not supported by the connected EA".into());
    }
    invalidate_validated_order_check(&state);
    *state
        .pending_history
        .lock()
        .expect("history mutex poisoned") = Some(request.clone());
    // A new window is a new selection: any lazy-loading page in flight or queued
    // belongs to the symbol/timeframe being replaced, so it is dropped here.
    *state
        .pending_history_page
        .lock()
        .expect("history page mutex poisoned") = None;
    *state
        .expected_history_page
        .lock()
        .expect("history page mutex poisoned") = None;
    *state
        .pending_symbol_info
        .lock()
        .expect("symbol info mutex poisoned") = Some(SymbolInfoRequest {
        symbol: request.symbol,
    });
    *state
        .expected_symbol_info
        .lock()
        .expect("symbol info mutex poisoned") = None;
    *state
        .pending_tick_profile
        .lock()
        .expect("tick profile mutex poisoned") = None;
    *state
        .expected_tick_profile
        .lock()
        .expect("tick profile mutex poisoned") = None;
    state
        .tick_controller
        .lock()
        .expect("tick controller mutex poisoned")
        .cancel();
    state.wake_outbound();
    Ok(())
}

/// One older-history page, anchored strictly before `before_ms`. Kept separate
/// from [`request_history`] because a page must not disturb the live bar feed
/// (the EA's active-symbol/`last_bar` anchors), the symbol metadata, or the
/// tick-profile download the window request resets.
#[tauri::command]
pub(crate) fn request_history_page(
    state: State<'_, BridgeState>,
    symbol: String,
    timeframe: String,
    bars: u16,
    before_ms: i64,
) -> Result<(), String> {
    let request = HistoryRequest {
        symbol,
        timeframe,
        bars,
        before_ms: Some(before_ms),
    };
    request.validate().map_err(str::to_owned)?;
    let _session_work = state
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none()
    {
        return Err("bridge is not connected".into());
    }
    if !state
        .status
        .lock()
        .expect("bridge status mutex poisoned")
        .supported_timeframes
        .contains(&request.timeframe)
    {
        return Err("timeframe is not supported by the connected EA".into());
    }
    // Latest page wins: replacing the expected slot also drops a page whose
    // response is still on the wire, so nothing stale can be prepended.
    *state
        .pending_history_page
        .lock()
        .expect("history page mutex poisoned") = Some(request);
    *state
        .expected_history_page
        .lock()
        .expect("history page mutex poisoned") = None;
    state.wake_outbound();
    Ok(())
}

#[tauri::command]
pub(crate) fn request_tick_profile(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    symbol: String,
    from_ms: i64,
    end_ms: i64,
    rows: u16,
) -> Result<(), String> {
    if !(1..=128).contains(&rows) {
        return Err("rows must be between 1 and 128".into());
    }
    let _session_work = state
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let wire = TickHistoryRequest {
        symbol: symbol.clone(),
        from_ms,
        to_ms: end_ms,
        max_ticks: state
            .transfer_limits
            .lock()
            .expect("transfer limits mutex poisoned")
            .max_ticks_per_page,
    };
    wire.validate().map_err(str::to_owned)?;
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none()
    {
        return Err("bridge is not connected".into());
    }
    if state
        .market
        .lock()
        .expect("market mutex poisoned")
        .symbol
        .as_deref()
        != Some(symbol.as_str())
    {
        return Err("profile symbol does not match the active chart".into());
    }
    let profile = TickProfileRequest {
        wire: wire.clone(),
        rows,
    };
    // Invalidate the old wire request before creating a new generation.  A
    // response already in flight retains its old generation and is ignored.
    *state
        .pending_tick_profile
        .lock()
        .expect("tick profile mutex poisoned") = None;
    *state
        .expected_tick_profile
        .lock()
        .expect("tick profile mutex poisoned") = None;
    let (cached, progress) = {
        let mut controller = state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        let gaps = controller.begin(profile.clone());
        if gaps.is_empty() {
            let final_page =
                if let Some((compact, request)) = controller.final_streamed_from_cache() {
                    Ok(TickPageResult::Streamed(compact, request))
                } else {
                    controller
                        .final_from_cache()
                        .map(|(snapshot, request)| TickPageResult::Final(snapshot, request))
                };
            controller.finish();
            (Some(final_page), None)
        } else {
            (None, controller.progress())
        }
    };
    if let Some(snapshot) = cached {
        drop(_session_work);
        let result = match snapshot.map_err(str::to_owned)? {
            TickPageResult::Final(snapshot, request) => {
                build_tick_profile(&state, snapshot, &request)
            }
            TickPageResult::Streamed(compact, request) => {
                build_streamed_tick_profile(&state, compact, &request)
            }
            _ => return Err("invalid cached profile result".into()),
        }
        .map_err(str::to_owned)?;
        let _ = app.emit("tick-profile", result);
    } else {
        *state
            .pending_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = Some(profile);
        state.wake_outbound();
        drop(_session_work);
        if let Some(progress) = progress {
            let _ = app.emit("tick-profile-progress", progress);
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_tick_profile(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<(), String> {
    if let Some(cancelled) = cancel_active_tick_profile(&state) {
        let _ = app.emit("tick-profile-cancelled", cancelled);
    }
    Ok(())
}

pub(crate) fn cancel_active_tick_profile(state: &BridgeState) -> Option<TickProfileCancelledView> {
    let _session_work = state
        .session_work
        .lock()
        .expect("bridge session mutex poisoned");
    *state
        .pending_tick_profile
        .lock()
        .expect("tick profile mutex poisoned") = None;
    *state
        .expected_tick_profile
        .lock()
        .expect("tick profile mutex poisoned") = None;
    let mut controller = state
        .tick_controller
        .lock()
        .expect("tick controller mutex poisoned");
    let cancelled = controller.cancelled_view();
    controller.cancel();
    cancelled
}

#[tauri::command]
pub(crate) fn search_symbols(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    query: String,
    limit: u8,
) -> Result<(), String> {
    if let Some(view) = search_symbols_inner(&state, query, limit)? {
        let _ = app.emit("symbol-search-result", view);
    }
    Ok(())
}

/// Returns the cached-result view to publish immediately when no bridge
/// session is active, or `None` after queueing the live request for the EA.
pub(crate) fn search_symbols_inner(
    state: &BridgeState,
    query: String,
    limit: u8,
) -> Result<Option<SymbolSearchResultView>, String> {
    let query = query.trim().to_string();
    if query
        .chars()
        .any(|character| character.is_control() || matches!(character, '"' | '\\'))
    {
        return Err("search query contains unsupported characters".into());
    }
    let request = SymbolSearchRequest {
        query: query.clone(),
        limit,
    };
    request.validate().map_err(str::to_owned)?;
    let _session_work = state
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none()
    {
        let symbols = state
            .symbol_cache
            .lock()
            .expect("symbol cache mutex poisoned")
            .cache
            .search(&query, limit)
            .into_iter()
            .map(Into::into)
            .collect();
        return Ok(Some(SymbolSearchResultView {
            source: "cached".into(),
            query,
            symbols,
        }));
    }
    *state
        .pending_symbol_search
        .lock()
        .expect("symbol search mutex poisoned") = Some(request);
    *state
        .expected_symbol_search
        .lock()
        .expect("symbol search mutex poisoned") = None;
    state.wake_outbound();
    Ok(None)
}

/// Last-wins outcome for a live `symbol_search_result` message.
pub(crate) enum SymbolSearchOutcome {
    /// A newer request replaced this one, or no request is expected.
    Stale,
    /// The payload failed protocol validation.
    Invalid,
    /// The result matched the expected request and was cached.
    Accepted(SymbolSearchResultView),
}

#[tauri::command]
pub(crate) fn get_reconciliation_status(state: State<'_, BridgeState>) -> ReconciliationStatus {
    state
        .reconciliation_status
        .lock()
        .expect("reconciliation status mutex poisoned")
        .clone()
}
