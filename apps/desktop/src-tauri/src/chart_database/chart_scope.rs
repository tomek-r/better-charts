//! Which chart a drawing or a setting belongs to: the chart's own id together with the account
//! and symbol that chart shows. Both stores scope every row by all three, so one account and
//! symbol opened on two charts keeps two independent sets of drawings and settings.

use super::limits::is_present_within;

/// Longest accepted chart id.
const MAX_CHART_ID_BYTES: usize = 64;
/// Longest accepted account identity that scopes one chart.
const MAX_ACCOUNT_KEY_BYTES: usize = 256;
/// Longest accepted symbol that scopes one chart.
const MAX_SYMBOL_BYTES: usize = 64;

/// The chart one list of drawings or one set of settings belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartScope {
    chart_id: String,
    account_key: String,
    symbol: String,
}

impl ChartScope {
    /// The scope `chart_id`, `account_key` and `symbol` name. A refused scope answers with the
    /// sentence the frontend shows, and each store wraps it in the invalid error of its own.
    pub(crate) fn new(
        chart_id: String,
        account_key: String,
        symbol: String,
    ) -> Result<Self, String> {
        if !is_present_within(&chart_id, MAX_CHART_ID_BYTES) {
            return Err(format!(
                "A chart needs an id of 1 to {MAX_CHART_ID_BYTES} bytes"
            ));
        }
        if !is_present_within(&account_key, MAX_ACCOUNT_KEY_BYTES) {
            return Err(format!(
                "A chart needs an account of 1 to {MAX_ACCOUNT_KEY_BYTES} bytes"
            ));
        }
        if !is_present_within(&symbol, MAX_SYMBOL_BYTES) {
            return Err(format!(
                "A chart needs a symbol of 1 to {MAX_SYMBOL_BYTES} bytes"
            ));
        }
        Ok(Self {
            chart_id,
            account_key,
            symbol,
        })
    }

    /// The chart row every drawing and setting of this scope names.
    pub(crate) fn chart_id(&self) -> &str {
        &self.chart_id
    }

    /// The account whose data the chart shows.
    pub(crate) fn account_key(&self) -> &str {
        &self.account_key
    }

    /// The symbol the chart shows.
    pub(crate) fn symbol(&self) -> &str {
        &self.symbol
    }
}
