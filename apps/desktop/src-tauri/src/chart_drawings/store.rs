//! Where saved drawings live. The frontend only knows the [`ChartDrawingStore`] trait, so a build
//! can keep the same commands and store drawings another way.
//!
//! Every implementation validates on the way in and out: a database row this build cannot
//! read is refused rather than replaced, so the drawings the user saved are never lost.

use super::{error::ChartDrawingError, record::ChartDrawingRecord};
use crate::chart_database::ChartScope;
use sqlite_store::StoreError;

/// The most drawings one chart keeps per account and symbol.
pub(super) const MAX_DRAWINGS_PER_SCOPE: usize = 200;

/// The drawings of every chart the app has saved.
pub(crate) trait ChartDrawingStore: Send + Sync {
    /// Every drawing saved for `scope`, in paint order. A scope with nothing saved holds none;
    /// rows that cannot be read or trusted are an error, never an empty list.
    fn load(&self, scope: &ChartScope) -> Result<Vec<ChartDrawingRecord>, ChartDrawingError>;
    /// Replaces the drawings of `scope`. An empty list removes what the scope held.
    fn save(
        &self,
        scope: &ChartScope,
        records: &[ChartDrawingRecord],
    ) -> Result<(), ChartDrawingError>;
}

/// The store of a machine whose chart database could not be opened: every call fails with the
/// reason opening found, so nothing is invented and nothing is lost.
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
    fn load(&self, _scope: &ChartScope) -> Result<Vec<ChartDrawingRecord>, ChartDrawingError> {
        Err(ChartDrawingError::while_reading(self.failure.clone()))
    }

    fn save(
        &self,
        _scope: &ChartScope,
        _records: &[ChartDrawingRecord],
    ) -> Result<(), ChartDrawingError> {
        Err(ChartDrawingError::while_writing(self.failure.clone()))
    }
}
