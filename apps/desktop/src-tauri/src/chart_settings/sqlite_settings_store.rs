//! The charts, their templates and their saved settings in the app's one SQLite file. The
//! settings text is stored and handed back unchanged: which fields it holds is the frontend's
//! business, so this store only ever asks whether it is a JSON object.

use super::{
    error::ChartSettingsError,
    settings_document::SettingsDocument,
    store::{ChartLayoutEntry, ChartSettings, ChartSettingsStore},
};
use crate::chart_database::ChartScope;
use sqlite_store::{
    rusqlite::{params, Connection, OptionalExtension},
    Outcome, SqliteDatabase,
};
use std::sync::Arc;

/// The template a chart created by this store starts on. The migration that introduced the charts
/// seeds the same id, so every chart names a template the frontend can look up.
const DEFAULT_TEMPLATE_ID: &str = "default";

const SELECT_LAYOUT: &str = "\
SELECT charts.chart_id, charts.group_id, charts.template_id
FROM charts
JOIN chart_groups AS groups ON groups.group_id = charts.group_id
ORDER BY groups.position, charts.position";

const INSERT_GROUP: &str = "\
INSERT INTO chart_groups (group_id, position)
VALUES (lower(hex(randomblob(16))), (SELECT coalesce(max(position) + 1, 0) FROM chart_groups))";

const INSERT_CHART: &str = "\
INSERT INTO charts (chart_id, group_id, template_id, position)
SELECT lower(hex(randomblob(16))),
       (SELECT group_id FROM chart_groups ORDER BY position DESC LIMIT 1),
       ?1,
       0";

const SELECT_SETTINGS: &str = "\
SELECT charts.template_id, templates.settings, overrides.settings
FROM charts
JOIN chart_templates AS templates ON templates.template_id = charts.template_id
LEFT JOIN chart_setting_overrides AS overrides
  ON overrides.chart_id = charts.chart_id
 AND overrides.account_key = ?2
 AND overrides.symbol = ?3
WHERE charts.chart_id = ?1";

const SELECT_CHART: &str = "SELECT 1 FROM charts WHERE chart_id = ?1";

const DELETE_OVERRIDES: &str = "\
DELETE FROM chart_setting_overrides
WHERE chart_id = ?1 AND account_key = ?2 AND symbol = ?3";

const UPSERT_OVERRIDES: &str = "\
INSERT INTO chart_setting_overrides (chart_id, account_key, symbol, settings)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (chart_id, account_key, symbol) DO UPDATE SET settings = excluded.settings";

/// The charts of this installation, kept in the chart database the app opened once.
pub(super) struct SqliteChartSettingsStore {
    database: Arc<SqliteDatabase>,
}

impl SqliteChartSettingsStore {
    /// The charts and settings of `database`, the one chart database the app opens at startup.
    pub(super) fn from_database(database: Arc<SqliteDatabase>) -> Self {
        Self { database }
    }

    /// Refuses a scope whose chart the database no longer holds.
    fn ensure_chart_saved(&self, scope: &ChartScope) -> Result<(), ChartSettingsError> {
        let chart_exists = self
            .database
            .read(|connection| chart_exists(connection, scope))
            .map_err(ChartSettingsError::while_reading)?;
        if chart_exists {
            Ok(())
        } else {
            Err(ChartSettingsError::UnknownChart)
        }
    }
}

impl ChartSettingsStore for SqliteChartSettingsStore {
    fn load_layout(&self) -> Result<Vec<ChartLayoutEntry>, ChartSettingsError> {
        self.database
            .write(read_or_seed_layout)
            .map_err(ChartSettingsError::while_reading)
    }

    fn load_settings(&self, scope: &ChartScope) -> Result<ChartSettings, ChartSettingsError> {
        let stored = self
            .database
            .read(|connection| read_settings(connection, scope))
            .map_err(ChartSettingsError::while_reading)?
            .ok_or(ChartSettingsError::UnknownChart)?;
        Ok(ChartSettings {
            template_id: stored.template_id,
            template_settings: SettingsDocument::parse(&stored.template_settings)?,
            overrides: match stored.overrides {
                Some(text) => SettingsDocument::parse(&text)?,
                None => SettingsDocument::default(),
            },
        })
    }

    fn save_overrides(
        &self,
        scope: &ChartScope,
        overrides: &SettingsDocument,
    ) -> Result<(), ChartSettingsError> {
        // A chart removed while the window was open is refused, so no override is written under
        // an id nothing points at.
        self.ensure_chart_saved(scope)?;
        self.database
            .write(|connection| write_overrides(connection, scope, overrides))
            .map_err(ChartSettingsError::while_writing)
    }
}

/// The saved layout; a database that holds no chart at all gets one group and one chart on the
/// default template inside the same write, so two windows never seed two charts and the app
/// always has a chart to draw.
fn read_or_seed_layout(connection: &Connection) -> Outcome<Vec<ChartLayoutEntry>> {
    let saved = read_layout(connection)?;
    if !saved.is_empty() {
        return Ok(saved);
    }
    seed_first_chart(connection)?;
    read_layout(connection)
}

fn read_layout(connection: &Connection) -> Outcome<Vec<ChartLayoutEntry>> {
    let mut statement = connection.prepare(SELECT_LAYOUT)?;
    let mut rows = statement.query(params![])?;
    let mut layout = Vec::new();
    while let Some(row) = rows.next()? {
        layout.push(ChartLayoutEntry {
            chart_id: row.get(0)?,
            group_id: row.get(1)?,
            template_id: row.get(2)?,
        });
    }
    Ok(layout)
}

/// One group and one chart, the chart at the first position of the group that was just created.
fn seed_first_chart(connection: &Connection) -> Outcome<()> {
    connection.execute(INSERT_GROUP, params![])?;
    connection.execute(INSERT_CHART, params![DEFAULT_TEMPLATE_ID])?;
    Ok(())
}

/// The settings of one chart exactly as stored, or none when the database holds no such chart.
fn read_settings(
    connection: &Connection,
    scope: &ChartScope,
) -> Outcome<Option<StoredChartSettings>> {
    let mut statement = connection.prepare(SELECT_SETTINGS)?;
    let mut rows = statement.query(params![
        scope.chart_id(),
        scope.account_key(),
        scope.symbol()
    ])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    Ok(Some(StoredChartSettings {
        template_id: row.get(0)?,
        template_settings: row.get(1)?,
        overrides: row.get(2)?,
    }))
}

/// One chart's settings as the database keeps them: the template it is drawn on and the overrides
/// of one account and symbol, if that scope has any.
struct StoredChartSettings {
    template_id: String,
    template_settings: String,
    overrides: Option<String>,
}

/// Whether the database still holds the chart `scope` names.
fn chart_exists(connection: &Connection, scope: &ChartScope) -> Outcome<bool> {
    let stored: Option<i64> = connection
        .query_row(SELECT_CHART, params![scope.chart_id()], |row| row.get(0))
        .optional()?;
    Ok(stored.is_some())
}

/// Replaces the overrides of one scope. An empty document removes the row, so a chart that
/// matches its template keeps none.
fn write_overrides(
    connection: &Connection,
    scope: &ChartScope,
    overrides: &SettingsDocument,
) -> Outcome<()> {
    if overrides.is_empty() {
        connection.execute(
            DELETE_OVERRIDES,
            params![scope.chart_id(), scope.account_key(), scope.symbol()],
        )?;
        return Ok(());
    }
    connection.execute(
        UPSERT_OVERRIDES,
        params![
            scope.chart_id(),
            scope.account_key(),
            scope.symbol(),
            overrides.to_text()
        ],
    )?;
    Ok(())
}
