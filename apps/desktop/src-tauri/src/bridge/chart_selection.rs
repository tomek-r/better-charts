//! The chart selection a reconnect reopens.
//!
//! A new session starts from the EA's chart symbol and the default timeframe
//! unless the same terminal and account were showing something else. The memory
//! lives in [`super::BridgeState`], outside every per-session reset, so a drop
//! and a reconnect never change what the user was looking at.
//!
//! A restored symbol can be unavailable. The EA answers that two ways: a
//! correlated history failure (the series never synchronizes), handled by
//! [`ChartSelectionMemory::restore_unavailable`]; or an uncorrelated protocol
//! error that ends the session, handled by [`ChartSelectionMemory::session_ended`].
//! Either way the restore is attempted once: the next request is the chart
//! symbol, so a bad symbol can never reconnect-loop.

use super::BridgeState;
use serde::Serialize;
use trading_core::protocol::default_timeframe;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartSelection {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
}

/// Who the selection belongs to: another terminal or account starts afresh.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalIdentity {
    pub(crate) terminal: String,
    pub(crate) account: String,
    pub(crate) server: String,
}

#[derive(Debug, Clone)]
struct Restore {
    requested: ChartSelection,
    fallback: ChartSelection,
}

/// Tells the user which selection could not be reopened and what is shown instead.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectionFallbackView {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
    pub(crate) shown_symbol: String,
}

impl SelectionFallbackView {
    fn new(requested: ChartSelection, fallback: &ChartSelection) -> Self {
        Self {
            symbol: requested.symbol,
            timeframe: requested.timeframe,
            shown_symbol: fallback.symbol.clone(),
        }
    }
}

/// What a new session asks for first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionStart {
    pub(crate) request: ChartSelection,
    /// Set when the previous session ended while reopening a selection the
    /// terminal rejected; `request` is then the chart symbol.
    pub(crate) rejected: Option<SelectionFallbackView>,
}

#[derive(Debug, Default)]
pub(crate) struct ChartSelectionMemory {
    owner: Option<TerminalIdentity>,
    shown: Option<ChartSelection>,
    restoring: Option<Restore>,
    rejected: Option<ChartSelection>,
}

impl ChartSelectionMemory {
    pub(crate) fn begin_session(
        &mut self,
        identity: &TerminalIdentity,
        chart_symbol: &str,
        supported_timeframes: &[String],
    ) -> SessionStart {
        let fallback = ChartSelection {
            symbol: chart_symbol.to_owned(),
            timeframe: default_timeframe().to_owned(),
        };
        self.restoring = None;
        let same_owner = self.owner.as_ref() == Some(identity);
        let rejected = self
            .rejected
            .take()
            .filter(|_| same_owner)
            .map(|requested| SelectionFallbackView::new(requested, &fallback));
        let restorable = self
            .shown
            .clone()
            .filter(|shown| same_owner && supported_timeframes.contains(&shown.timeframe));
        let request = match restorable {
            Some(requested) => {
                self.restoring = Some(Restore {
                    requested: requested.clone(),
                    fallback,
                });
                requested
            }
            None => fallback,
        };
        SessionStart { request, rejected }
    }

    /// The window the user is looking at; it is what the next session reopens.
    pub(crate) fn window_accepted(&mut self, identity: TerminalIdentity, shown: ChartSelection) {
        self.owner = Some(identity);
        self.shown = Some(shown);
        self.restoring = None;
    }

    /// The EA could not synchronize the restored series: forget it and report
    /// what to show instead. `None` for any other selection.
    pub(crate) fn restore_unavailable(
        &mut self,
        unavailable: &ChartSelection,
    ) -> Option<(SelectionFallbackView, ChartSelection)> {
        if self.restoring.as_ref()?.requested != *unavailable {
            return None;
        }
        let restore = self.restoring.take()?;
        self.shown = None;
        let view = SelectionFallbackView::new(restore.requested, &restore.fallback);
        Some((view, restore.fallback))
    }

    /// A session ended before the restored window arrived. A protocol error
    /// means the terminal rejected the request (an unknown symbol is answered
    /// that way); a plain drop says nothing about the symbol.
    pub(crate) fn session_ended(&mut self, protocol_error: bool) {
        if let Some(restore) = self.restoring.take() {
            if protocol_error {
                self.shown = None;
                self.rejected = Some(restore.requested);
            }
        }
    }
}

/// Records the window the session just accepted as the one to reopen. The
/// caller holds the session gate, so the status still describes this session.
pub(crate) fn remember_shown_window(state: &BridgeState, symbol: &str, timeframe: &str) {
    let identity = {
        let status = state.status.lock().expect("bridge status mutex poisoned");
        match (&status.terminal, &status.account, &status.server) {
            (Some(terminal), Some(account), Some(server)) => TerminalIdentity {
                terminal: terminal.clone(),
                account: account.clone(),
                server: server.clone(),
            },
            _ => return,
        }
    };
    state
        .chart_selection
        .lock()
        .expect("chart selection mutex poisoned")
        .window_accepted(
            identity,
            ChartSelection {
                symbol: symbol.to_owned(),
                timeframe: timeframe.to_owned(),
            },
        );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(account: &str) -> TerminalIdentity {
        TerminalIdentity {
            terminal: "terminal-1".into(),
            account: account.into(),
            server: "Broker-Demo".into(),
        }
    }

    fn selection(symbol: &str, timeframe: &str) -> ChartSelection {
        ChartSelection {
            symbol: symbol.into(),
            timeframe: timeframe.into(),
        }
    }

    fn all_timeframes() -> Vec<String> {
        ["M1", "M5", "H1", "D1"].map(String::from).to_vec()
    }

    fn chart_default() -> ChartSelection {
        selection("EURUSD", default_timeframe())
    }

    fn memory_showing(symbol: &str, timeframe: &str) -> ChartSelectionMemory {
        let mut memory = ChartSelectionMemory::default();
        memory.window_accepted(identity("1"), selection(symbol, timeframe));
        memory
    }

    #[test]
    fn first_session_starts_from_the_chart_symbol() {
        let mut memory = ChartSelectionMemory::default();
        let start = memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(start.request, chart_default());
        assert_eq!(start.rejected, None);
    }

    #[test]
    fn same_identity_reopens_the_shown_selection() {
        let mut memory = memory_showing("GBPUSD", "H1");
        let start = memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(start.request, selection("GBPUSD", "H1"));
    }

    #[test]
    fn another_account_starts_from_the_chart_symbol() {
        let mut memory = memory_showing("GBPUSD", "H1");
        let start = memory.begin_session(&identity("2"), "EURUSD", &all_timeframes());
        assert_eq!(start.request, chart_default());
    }

    #[test]
    fn unsupported_timeframe_starts_from_the_chart_symbol() {
        let mut memory = memory_showing("GBPUSD", "H1");
        let start = memory.begin_session(&identity("1"), "EURUSD", &["M1".to_owned()]);
        assert_eq!(start.request, chart_default());
    }

    #[test]
    fn unavailable_restore_falls_back_once_and_forgets_the_selection() {
        let mut memory = memory_showing("GBPUSD", "H1");
        memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        let (view, fallback) = memory
            .restore_unavailable(&selection("GBPUSD", "H1"))
            .expect("the restore was awaited");
        assert_eq!(fallback, chart_default());
        assert_eq!(view.symbol, "GBPUSD");
        assert_eq!(view.timeframe, "H1");
        assert_eq!(view.shown_symbol, "EURUSD");
        assert_eq!(memory.restore_unavailable(&selection("GBPUSD", "H1")), None);
        let next = memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(next.request, chart_default());
    }

    #[test]
    fn another_selection_is_not_a_failed_restore() {
        let mut memory = memory_showing("GBPUSD", "H1");
        memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(memory.restore_unavailable(&selection("USDJPY", "H1")), None);
    }

    #[test]
    fn restored_window_ends_the_restore() {
        let mut memory = memory_showing("GBPUSD", "H1");
        memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        memory.window_accepted(identity("1"), selection("GBPUSD", "H1"));
        assert_eq!(memory.restore_unavailable(&selection("GBPUSD", "H1")), None);
    }

    #[test]
    fn protocol_error_before_the_restored_window_is_reported_next_session() {
        let mut memory = memory_showing("GBPUSD", "H1");
        memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        memory.session_ended(true);
        let next = memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(next.request, chart_default());
        let notice = next.rejected.expect("the rejection is reported");
        assert_eq!(notice.symbol, "GBPUSD");
        assert_eq!(notice.shown_symbol, "EURUSD");
        let after = memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(after.rejected, None);
    }

    #[test]
    fn plain_drop_before_the_restored_window_keeps_the_selection() {
        let mut memory = memory_showing("GBPUSD", "H1");
        memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        memory.session_ended(false);
        let next = memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        assert_eq!(next.request, selection("GBPUSD", "H1"));
        assert_eq!(next.rejected, None);
    }

    #[test]
    fn rejection_is_not_reported_to_another_account() {
        let mut memory = memory_showing("GBPUSD", "H1");
        memory.begin_session(&identity("1"), "EURUSD", &all_timeframes());
        memory.session_ended(true);
        let next = memory.begin_session(&identity("2"), "EURUSD", &all_timeframes());
        assert_eq!(next.rejected, None);
    }
}
