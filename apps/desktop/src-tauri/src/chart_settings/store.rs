//! Where the charts and their settings live. The frontend only knows the [`ChartSettingsStore`]
//! trait, so a build can keep the same commands and store settings another way.
//!
//! Every implementation validates on the way in and out: a document this build cannot read is
//! an error rather than an empty chart, so the settings the user made are never replaced by
//! defaults.

use super::{error::ChartSettingsError, settings_document::SettingsDocument};
use crate::chart_database::ChartScope;
use serde::Serialize;
use sqlite_store::StoreError;

/// One chart of the layout the frontend draws: which group it sits in, on which template.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartLayoutEntry {
    /// The chart's own identity, the same id its drawings and settings are saved under.
    pub(crate) chart_id: String,
    /// The group the chart is laid out in; group positions order the groups themselves.
    pub(crate) group_id: String,
    /// The settings template the chart starts from.
    pub(crate) template_id: String,
}

/// What one chart is drawn with: the settings of its template and the overrides of one account
/// and symbol, both as the frontend left them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartSettings {
    /// The template the chart starts from, so the frontend can name the settings it shows.
    pub(crate) template_id: String,
    /// The settings of that template, the base every chart of it shares.
    pub(crate) template_settings: SettingsDocument,
    /// The settings this chart overrides for one account and symbol; empty when it overrides
    /// none.
    pub(crate) overrides: SettingsDocument,
}

/// The charts the app has saved and the settings each one keeps.
pub(crate) trait ChartSettingsStore: Send + Sync {
    /// Every saved chart in layout order. A database that holds no chart at all answers with one
    /// chart on the default template, created for it, because the app always draws a chart.
    fn load_layout(&self) -> Result<Vec<ChartLayoutEntry>, ChartSettingsError>;
    /// The template and overrides of the chart `scope` names; a chart the database no longer
    /// holds is an error, never a chart of defaults.
    fn load_settings(&self, scope: &ChartScope) -> Result<ChartSettings, ChartSettingsError>;
    /// Replaces the overrides of `scope`; an empty document removes them, so the chart falls back
    /// to its template.
    fn save_overrides(
        &self,
        scope: &ChartScope,
        overrides: &SettingsDocument,
    ) -> Result<(), ChartSettingsError>;
}

/// The store of a machine whose chart database could not be opened: every call fails with the
/// reason opening found, so no chart is invented and nothing is lost.
pub(super) struct UnavailableChartSettingsStore {
    failure: StoreError,
}

impl UnavailableChartSettingsStore {
    /// The store of a database that could not be opened, for the reason `failure` names.
    pub(super) fn for_failure(failure: StoreError) -> Self {
        Self { failure }
    }
}

impl ChartSettingsStore for UnavailableChartSettingsStore {
    fn load_layout(&self) -> Result<Vec<ChartLayoutEntry>, ChartSettingsError> {
        Err(ChartSettingsError::while_reading(self.failure.clone()))
    }

    fn load_settings(&self, _scope: &ChartScope) -> Result<ChartSettings, ChartSettingsError> {
        Err(ChartSettingsError::while_reading(self.failure.clone()))
    }

    fn save_overrides(
        &self,
        _scope: &ChartScope,
        _overrides: &SettingsDocument,
    ) -> Result<(), ChartSettingsError> {
        Err(ChartSettingsError::while_writing(self.failure.clone()))
    }
}
