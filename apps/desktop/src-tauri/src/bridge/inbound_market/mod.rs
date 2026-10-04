//! Handlers for market-domain frames of the post-handshake connection loop:
//! history, bar updates, quotes, account/portfolio snapshots, symbol
//! lookups and the tick-profile page stream. Each handler owns exactly one
//! `message_type` arm of the dispatch in [`connection::handle_connection`]:
//! it validates the payload, applies the state transition and reports how
//! the loop must continue via [`InboundOutcome`]. Teardown frames are never
//! sent here — the loop answers an [`InboundOutcome::ErrorFrame`] with the
//! error frame itself, keeping the send ordering identical to the original
//! if-chain.

mod tick_profile;

pub(crate) use tick_profile::{tick_history, tick_history_error, tick_price_history};

use super::{
    accept_account, accept_bar_update, accept_quote, accept_symbol_info,
    accept_symbol_search_result, bridge_emit, claim_for_session, publish_market_inner,
    BarUpdateAcceptance, HistoryPageView, Inbound, InboundOutcome, MarketSnapshot, PortfolioView,
    SymbolSearchOutcome,
};
use trading_core::protocol::{
    AccountSnapshot, BarUpdate, Envelope, ErrorCode, HistorySnapshot, PortfolioSnapshot,
    QuoteUpdate, SymbolInfoResult, SymbolSearchResult,
};

/// `history_snapshot`: publish the market snapshot for the chart the terminal
/// answered.
pub(crate) async fn history_snapshot(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let snapshot: HistorySnapshot = match serde_json::from_value(message.payload) {
        Ok(v) => v,
        Err(_) => {
            return InboundOutcome::ErrorFrame(
                ErrorCode::InvalidMessage,
                "invalid history snapshot",
            );
        }
    };
    match claim_for_session(inbound.state, inbound.session_id, || {
        // A page is claimed before the window and never replaces the market
        // snapshot, so lazy loading cannot re-point the order ticket's last
        // price or the `bar_update` staleness bound at an old bar.
        let page = inbound
            .state
            .expected_history_page
            .lock()
            .expect("history page mutex poisoned")
            .clone();
        if let Some((expected_id, expected_request)) = page {
            if snapshot.request_id == expected_id {
                if snapshot.validate(&expected_request).is_err() {
                    return InboundOutcome::ErrorFrame(
                        ErrorCode::InvalidMessage,
                        "invalid history snapshot",
                    );
                }
                // The page slot is written only by `request_history_page`, which
                // always carries an anchor, and an older peer omits the echo, so
                // the request is the authority here. A request without one cannot
                // be answered as a page: drop it rather than invent an anchor.
                let Some(before_ms) = expected_request.before_ms else {
                    *inbound
                        .state
                        .expected_history_page
                        .lock()
                        .expect("history page mutex poisoned") = None;
                    return InboundOutcome::Continue;
                };
                *inbound
                    .state
                    .expected_history_page
                    .lock()
                    .expect("history page mutex poisoned") = None;
                bridge_emit(
                    inbound.events,
                    "history-page",
                    HistoryPageView {
                        symbol: snapshot.symbol,
                        timeframe: snapshot.timeframe,
                        complete: snapshot.complete,
                        before_ms,
                        candles: snapshot.candles,
                    },
                );
                return InboundOutcome::Continue;
            }
        }
        let expected = inbound
            .state
            .expected_history
            .lock()
            .expect("history mutex poisoned")
            .clone();
        let Some((expected_id, expected_request)) = expected else {
            return InboundOutcome::Continue;
        };
        if snapshot.request_id != expected_id {
            return InboundOutcome::Continue;
        }
        if snapshot.validate(&expected_request).is_err() {
            return InboundOutcome::ErrorFrame(
                ErrorCode::InvalidMessage,
                "invalid history snapshot",
            );
        }
        let market = MarketSnapshot {
            symbol: Some(snapshot.symbol),
            timeframe: Some(snapshot.timeframe),
            complete: snapshot.complete,
            candles: snapshot.candles,
        };
        publish_market_inner(inbound.events, inbound.state, inbound.session_id, market);
        *inbound
            .state
            .expected_history
            .lock()
            .expect("history mutex poisoned") = None;
        InboundOutcome::Continue
    }) {
        Ok(outcome) => outcome,
        Err(()) => InboundOutcome::Continue,
    }
}

/// `bar_update`: fold accepted live bars into the market snapshot.
pub(crate) async fn bar_update(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let update: BarUpdate = match serde_json::from_value(message.payload) {
        Ok(v) => v,
        Err(_) => {
            return InboundOutcome::ErrorFrame(ErrorCode::InvalidMessage, "invalid bar update");
        }
    };
    match accept_bar_update(inbound.state, inbound.session_id, &update) {
        BarUpdateAcceptance::Applied => {
            let _ = claim_for_session(inbound.state, inbound.session_id, || {
                bridge_emit(inbound.events, "bar-update", &update);
            });
        }
        BarUpdateAcceptance::Stale => {}
        BarUpdateAcceptance::Invalid => {
            return InboundOutcome::ErrorFrame(ErrorCode::InvalidMessage, "invalid bar update");
        }
    }
    InboundOutcome::Continue
}

/// `portfolio_snapshot`: accept only snapshots bound to the current account.
pub(crate) async fn portfolio_snapshot(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let snapshot: PortfolioSnapshot = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid portfolio snapshot"),
    };
    match claim_for_session(inbound.state, inbound.session_id, || {
        let account_login = inbound
            .state
            .account
            .lock()
            .expect("account mutex poisoned")
            .as_ref()
            .map(|value| value.account_login.clone());
        let Some(account_login) = account_login else {
            return InboundOutcome::Continue;
        };
        if snapshot.account_login != account_login {
            return InboundOutcome::Teardown("portfolio account mismatch");
        }
        if snapshot.validate().is_err() {
            return InboundOutcome::Teardown("invalid portfolio snapshot");
        }
        let view = PortfolioView::from(snapshot);
        *inbound
            .state
            .portfolio
            .lock()
            .expect("portfolio mutex poisoned") = Some(view.clone());
        bridge_emit(inbound.events, "portfolio-snapshot", view);
        InboundOutcome::Continue
    }) {
        Ok(outcome) => outcome,
        Err(()) => InboundOutcome::Continue,
    }
}

/// `account_snapshot`: store the account the bridge is currently bound to.
pub(crate) async fn account_snapshot(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let account: AccountSnapshot = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid account snapshot"),
    };
    match accept_account(inbound.state, inbound.session_id, account) {
        Ok(Some(view)) => {
            let _ = claim_for_session(inbound.state, inbound.session_id, || {
                bridge_emit(inbound.events, "account-snapshot", view);
            });
        }
        Ok(None) => {}
        Err(error) => return InboundOutcome::Teardown(error),
    }
    InboundOutcome::Continue
}

/// `quote_update`: accept a fresh quote for the active chart; malformed
/// quotes are dropped silently, exactly as before.
pub(crate) async fn quote_update(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let quote: QuoteUpdate = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Continue,
    };
    if let Some(view) = accept_quote(inbound.state, inbound.session_id, quote) {
        let _ = claim_for_session(inbound.state, inbound.session_id, || {
            bridge_emit(inbound.events, "quote-update", view);
        });
    }
    InboundOutcome::Continue
}

/// `symbol_info_result`: accept the symbol metadata for the chart symbol.
pub(crate) async fn symbol_info(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let result: SymbolInfoResult = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid symbol info result"),
    };
    match claim_for_session(inbound.state, inbound.session_id, || {
        match accept_symbol_info(inbound.state, result) {
            Ok(Some(view)) => bridge_emit(inbound.events, "symbol-info", view),
            Ok(None) => {}
            Err(error) => return InboundOutcome::Teardown(error),
        }
        InboundOutcome::Continue
    }) {
        Ok(outcome) => outcome,
        Err(()) => InboundOutcome::Continue,
    }
}

/// `symbol_search_result`: last-wins handling of a live search response.
pub(crate) async fn symbol_search(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let result: SymbolSearchResult = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => {
            return InboundOutcome::ErrorFrame(
                ErrorCode::InvalidMessage,
                "invalid symbol search result",
            );
        }
    };
    match claim_for_session(inbound.state, inbound.session_id, || {
        match accept_symbol_search_result(inbound.state, result) {
            SymbolSearchOutcome::Stale => {}
            SymbolSearchOutcome::Invalid => {
                return InboundOutcome::ErrorFrame(
                    ErrorCode::InvalidMessage,
                    "invalid symbol search result",
                );
            }
            SymbolSearchOutcome::Accepted(view) => {
                bridge_emit(inbound.events, "symbol-search-result", view);
            }
        }
        InboundOutcome::Continue
    }) {
        Ok(outcome) => outcome,
        Err(()) => InboundOutcome::Continue,
    }
}
