//! Where saved drawings and chart time zones live. The frontend only knows the
//! [`ChartDrawingStore`] trait, so a build can keep the same commands and store both another way.
//!
//! Every implementation validates on the way in and out: a database row this build cannot
//! read is refused rather than replaced, so the drawings the user saved are never lost.

use super::{
    chart_time_zone::ChartTimeZone, error::ChartDrawingError, limits::is_present_within,
    record::ChartDrawingRecord,
};
use sqlite_store::StoreError;

/// The most drawings one account and symbol keeps.
pub(super) const MAX_DRAWINGS_PER_SCOPE: usize = 200;
/// Longest accepted account identity that scopes one list of drawings.
const MAX_ACCOUNT_KEY_BYTES: usize = 256;
/// Longest accepted symbol that scopes one list of drawings.
const MAX_SYMBOL_BYTES: usize = 64;

/// The account and symbol one list of drawings belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DrawingScope {
    account_key: String,
    symbol: String,
}

impl DrawingScope {
    pub(crate) fn new(account_key: String, symbol: String) -> Result<Self, ChartDrawingError> {
        if !is_present_within(&account_key, MAX_ACCOUNT_KEY_BYTES) {
            return Err(ChartDrawingError::Invalid(format!(
                "Drawings need an account of 1 to {MAX_ACCOUNT_KEY_BYTES} bytes"
            )));
        }
        if !is_present_within(&symbol, MAX_SYMBOL_BYTES) {
            return Err(ChartDrawingError::Invalid(format!(
                "Drawings need a symbol of 1 to {MAX_SYMBOL_BYTES} bytes"
            )));
        }
        Ok(Self {
            account_key,
            symbol,
        })
    }

    pub(super) fn account_key(&self) -> &str {
        &self.account_key
    }

    pub(super) fn symbol(&self) -> &str {
        &self.symbol
    }
}

/// The drawings of every account and symbol the app has saved, and the time zone each chart was
/// last shown in.
pub(crate) trait ChartDrawingStore: Send + Sync {
    /// Every drawing saved for `scope`, in paint order. A scope with nothing saved holds none;
    /// rows that cannot be read or trusted are an error, never an empty list.
    fn load(&self, scope: &DrawingScope) -> Result<Vec<ChartDrawingRecord>, ChartDrawingError>;
    /// Replaces the drawings of `scope`. An empty list removes what the scope held.
    fn save(
        &self,
        scope: &DrawingScope,
        records: &[ChartDrawingRecord],
    ) -> Result<(), ChartDrawingError>;
    /// The time zone `scope` was last shown in, or `None` when that chart has none saved yet. A
    /// stored zone this build cannot read is an error, never `None`.
    fn load_time_zone(
        &self,
        scope: &DrawingScope,
    ) -> Result<Option<ChartTimeZone>, ChartDrawingError>;
    /// Replaces the time zone of `scope`, so the chart opens in it next time.
    fn save_time_zone(
        &self,
        scope: &DrawingScope,
        time_zone: &ChartTimeZone,
    ) -> Result<(), ChartDrawingError>;
}

/// The store of a machine whose drawings database could not be opened: every call fails with
/// the reason opening found, so nothing is invented and nothing is lost.
pub(super) struct UnavailableChartDrawingStore {
    failure: StoreError,
}

impl UnavailableChartDrawingStore {
    /// The store of a database that could not be opened, for the reason `failure` names.
    pub(super) fn for_failure(failure: StoreError) -> Self {
        Self { failure }
    }
}

impl ChartDrawingStore for UnavailableChartDrawingStore {
    fn load(&self, _scope: &DrawingScope) -> Result<Vec<ChartDrawingRecord>, ChartDrawingError> {
        Err(ChartDrawingError::while_reading(self.failure.clone()))
    }

    fn save(
        &self,
        _scope: &DrawingScope,
        _records: &[ChartDrawingRecord],
    ) -> Result<(), ChartDrawingError> {
        Err(ChartDrawingError::while_writing(self.failure.clone()))
    }

    fn load_time_zone(
        &self,
        _scope: &DrawingScope,
    ) -> Result<Option<ChartTimeZone>, ChartDrawingError> {
        Err(ChartDrawingError::time_zone_while_reading(
            self.failure.clone(),
        ))
    }

    fn save_time_zone(
        &self,
        _scope: &DrawingScope,
        _time_zone: &ChartTimeZone,
    ) -> Result<(), ChartDrawingError> {
        Err(ChartDrawingError::time_zone_while_writing(
            self.failure.clone(),
        ))
    }
}
