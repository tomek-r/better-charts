use super::super::{
    bridge_emit, invalidate_validated_order_check, AccountSnapshot, AccountView, BarUpdate,
    BridgeEvents, BridgeState, MarketSnapshot, QuoteUpdate, QuoteView,
};
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
        }
    } else {
        market.candles.push(update.candle.clone());
    }
    if market.candles.len() > 1000 {
        market.candles.remove(0);
    }
    BarUpdateAcceptance::Applied
}

pub(crate) fn accept_quote(
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
