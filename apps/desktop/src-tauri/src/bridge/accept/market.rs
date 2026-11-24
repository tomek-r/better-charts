use super::super::{
    bridge_emit, clear_indicator_series, clear_indicator_ticks, clear_profile_bar_slots,
    follow_footprint_quote, footprint_needed, invalidate_validated_order_check,
    start_footprint_read, AccountSnapshot, AccountView, BarUpdate, BridgeEvents, BridgeState,
    MarketSnapshot, QuoteUpdate, QuoteView,
};
use crate::chart_footprint;
use std::sync::Arc;

pub(crate) fn publish_market(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    session_id: &str,
    snapshot: MarketSnapshot,
) {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    publish_market_inner(events, state, session_id, snapshot);
}

/// Applies and publishes a market snapshot while the caller owns
/// `state.session_work`; use this only inside a session-scoped critical section.
pub(crate) fn publish_market_inner(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    session_id: &str,
    snapshot: MarketSnapshot,
) {
    let current = state
        .current_session
        .lock()
        .expect("session mutex poisoned");
    if current.as_deref() != Some(session_id) {
        return;
    }
    let symbol_changed = {
        let mut market = state.market.lock().expect("market mutex poisoned");
        let changed = market.symbol != snapshot.symbol;
        *market = snapshot.clone();
        changed
    };
    if symbol_changed {
        invalidate_validated_order_check(state);
        // A page still in flight belongs to the symbol being replaced; dropping
        // the expectation makes the bridge ignore its response instead of
        // emitting a `history-page` for a series the chart no longer shows.
        *state
            .pending_history_page
            .lock()
            .expect("history page mutex poisoned") = None;
        *state
            .expected_history_page
            .lock()
            .expect("history page mutex poisoned") = None;
        // A series read and an indicator ticks read belong to the symbol being
        // replaced; their data must not reach the new one under a key that is
        // still in use.
        clear_indicator_series(state);
        clear_indicator_ticks(state);
        // A profile bar request for the old symbol must not paint the new one.
        let dropped = state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned")
            .drop_bar_job_for_other_symbol(snapshot.symbol.as_deref());
        if dropped {
            clear_profile_bar_slots(state);
        }
        *state.quote.lock().expect("quote mutex poisoned") = None;
        *state
            .pending_order_check
            .lock()
            .expect("order check mutex poisoned") = None;
        *state
            .expected_order_check
            .lock()
            .expect("order check mutex poisoned") = None;
    }
    drop(current);
    // The chart footprint computes over the window the bridge just accepted for this session. A
    // snapshot without a symbol or timeframe (the handshake's empty reset) has no chart to compute
    // over, so it reads nothing.
    read_footprint(state, &snapshot);
    bridge_emit(events, "market-snapshot", snapshot);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BarUpdateAcceptance {
    Applied,
    Stale,
    Invalid,
}

/// Validates and applies one live candle directly to the stored market.
/// The common path replaces the last candle in place and never clones the
/// full (up to 1000 element) history vector.
pub(crate) fn accept_bar_update(
    state: &BridgeState,
    session_id: &str,
    update: &BarUpdate,
) -> BarUpdateAcceptance {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    let current = state
        .current_session
        .lock()
        .expect("session mutex poisoned");
    if current.as_deref() != Some(session_id) {
        return BarUpdateAcceptance::Stale;
    }
    let mut market = state.market.lock().expect("market mutex poisoned");
    let (Some(symbol), Some(timeframe)) = (market.symbol.as_deref(), market.timeframe.as_deref())
    else {
        return BarUpdateAcceptance::Stale;
    };
    if update.validate(symbol, timeframe).is_err() {
        return BarUpdateAcceptance::Invalid;
    }

    // Set when the accepted bar lands before the newest one: it changed the
    // history the reads already hold, so the window's ticks are read again
    // instead of keeping the spans of the old window.
    let mut rewrote_history = false;
    if let Some(last) = market.candles.last_mut() {
        if last.time_ms == update.candle.time_ms {
            *last = update.candle.clone();
            return BarUpdateAcceptance::Applied;
        }
        if last.time_ms < update.candle.time_ms {
            market.candles.push(update.candle.clone());
        } else if let Some(existing) = market
            .candles
            .iter_mut()
            .rev()
            .find(|candle| candle.time_ms == update.candle.time_ms)
        {
            *existing = update.candle.clone();
            return BarUpdateAcceptance::Applied;
        } else {
            market.candles.push(update.candle.clone());
            market.candles.sort_by_key(|candle| candle.time_ms);
            rewrote_history = true;
        }
    } else {
        market.candles.push(update.candle.clone());
    }
    if market.candles.len() > 1000 {
        market.candles.remove(0);
    }
    drop(market);
    if rewrote_history {
        // After the trim, so the read covers the window the chart keeps.
        read_stored_window(state);
    }
    BarUpdateAcceptance::Applied
}

/// Reads the stored window's ticks for the chart footprint and any observer of them: a chart that
/// turned its footprint on after the window loaded asks for them the moment it does.
pub(crate) fn read_footprint_ticks(state: &BridgeState) {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    read_stored_window(state);
}

/// Reads the stored window's ticks; the caller already holds `session_work`.
fn read_stored_window(state: &BridgeState) {
    let market = state.market.lock().expect("market mutex poisoned").clone();
    read_footprint(state, &market);
}

/// Resolves the chart footprint's row width from `market`'s window and starts the read of that
/// window's ticks when the chart asked for a footprint or an observer needs them. A chart that needs
/// neither costs no tick, and the row width comes from the window just accepted, never from a live
/// tick, so the rows do not move while the chart reads them. The caller holds `session_work`.
fn read_footprint(state: &BridgeState, market: &MarketSnapshot) {
    let Some(symbol) = market.symbol.as_deref() else {
        return;
    };
    // A snapshot without a timeframe is the handshake's empty reset: no chart to publish rows for.
    if market.timeframe.is_none() {
        return;
    }
    let mintick = chart_footprint::mintick_of(state, symbol);
    chart_footprint::resolve_row_size(state, &market.candles, mintick);
    if footprint_needed(state) {
        start_footprint_read(state, symbol, &market.candles);
    }
}

pub(crate) fn accept_quote(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    session_id: &str,
    quote: QuoteUpdate,
) -> Option<QuoteView> {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    let current = state
        .current_session
        .lock()
        .expect("session mutex poisoned");
    if current.as_deref() != Some(session_id) {
        return None;
    }
    let market = state.market.lock().expect("market mutex poisoned");
    let symbol = market.symbol.as_deref()?;
    if quote.validate(symbol).is_err() {
        return None;
    }
    drop(market);
    // The quote only says the chart symbol traded: the forming bar's footprint comes from MT5's tick
    // history, which the quote makes the host read again.
    follow_footprint_quote(state, events);
    let view = QuoteView::from(quote);
    *state.quote.lock().expect("quote mutex poisoned") = Some(view.clone());
    Some(view)
}

pub(crate) fn accept_account(
    state: &BridgeState,
    session_id: &str,
    account: AccountSnapshot,
) -> Result<Option<AccountView>, &'static str> {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    if account.validate().is_err() {
        return Err("invalid account snapshot");
    }
    let current = state
        .current_session
        .lock()
        .expect("session mutex poisoned");
    if current.as_deref() != Some(session_id) {
        return Ok(None);
    }
    let status = state.status.lock().expect("bridge status mutex poisoned");
    if status.account.as_deref() != Some(account.account_login.as_str())
        || status.server.as_deref() != Some(account.broker_server.as_str())
    {
        return Err("account identity changed");
    }
    let view = AccountView::from(account);
    let mut account = state.account.lock().expect("account mutex poisoned");
    let contract_changed = account.as_ref().map_or(true, |previous| {
        previous.currency != view.currency
            || previous.currency_digits != view.currency_digits
            || previous.leverage != view.leverage
            || previous.margin_mode != view.margin_mode
            || previous.trade_allowed != view.trade_allowed
            || previous.expert_allowed != view.expert_allowed
            || previous.account_trade_mode != view.account_trade_mode
    });
    *account = Some(view.clone());
    drop(account);
    // Equity/free-margin ticks do not change the checked request. The EA runs
    // a new OrderCheck over the exact request immediately before OrderSend.
    if contract_changed {
        invalidate_validated_order_check(state);
    }
    Ok(Some(view))
}
