//! The drawings of every chart in the app's one SQLite file: a row per drawing and a row per
//! anchor point, so every tool stores the same shape. Each row names the chart, account and
//! symbol it belongs to, so two charts showing the same symbol keep their own drawings.

use super::{
    error::ChartDrawingError,
    record::{ChartDrawingPoint, ChartDrawingRecord},
    store::{ChartDrawingStore, MAX_DRAWINGS_PER_SCOPE},
    timeframe_visibility::TimeframeVisibility,
};
use crate::chart_database::ChartScope;
use serde_json::Value;
use sqlite_store::{
    rusqlite::{params, Connection, Statement},
    Outcome, SqliteDatabase, StoreError,
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

const SELECT_SCOPE_DRAWINGS: &str = "\
SELECT drawing_id, tool_id, is_locked, is_visible, is_below_bars, settings, timeframe_visibility
FROM chart_drawings
WHERE chart_id = ?1 AND account_key = ?2 AND symbol = ?3
ORDER BY position";

const SELECT_SCOPE_POINTS: &str = "\
SELECT points.drawing_id, points.time_ms, points.price
FROM chart_drawing_points AS points
JOIN chart_drawings AS drawings ON drawings.drawing_id = points.drawing_id
WHERE drawings.chart_id = ?1 AND drawings.account_key = ?2 AND drawings.symbol = ?3
ORDER BY points.drawing_id, points.point_index";

const DELETE_SCOPE_DRAWINGS: &str = "\
DELETE FROM chart_drawings WHERE chart_id = ?1 AND account_key = ?2 AND symbol = ?3";

const INSERT_DRAWING: &str = "\
INSERT INTO chart_drawings
  (drawing_id, chart_id, account_key, symbol, position, tool_id, is_locked, is_visible,
   is_below_bars, settings, timeframe_visibility)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)";

const INSERT_POINT: &str = "\
INSERT INTO chart_drawing_points (drawing_id, point_index, time_ms, price)
VALUES (?1, ?2, ?3, ?4)";

/// The drawings of this installation, kept in the chart database the app opened once.
pub(super) struct SqliteChartDrawingStore {
    database: Arc<SqliteDatabase>,
}

impl SqliteChartDrawingStore {
    /// The drawings of `database`, the one chart database the app opens at startup.
    pub(super) fn from_database(database: Arc<SqliteDatabase>) -> Self {
        Self { database }
    }
}

impl ChartDrawingStore for SqliteChartDrawingStore {
    fn load(&self, scope: &ChartScope) -> Result<Vec<ChartDrawingRecord>, ChartDrawingError> {
        let records = self
            .database
            .read(|connection| read_scope(connection, scope))
            .map_err(ChartDrawingError::while_reading)?;
        // Fail closed: one row this build cannot trust rejects the whole list, so the frontend
        // never paints a partial set over the stored one.
        for record in &records {
            record
                .validate()
                .map_err(|_| ChartDrawingError::Unreadable)?;
        }
        Ok(records)
    }

    fn save(
        &self,
        scope: &ChartScope,
        records: &[ChartDrawingRecord],
    ) -> Result<(), ChartDrawingError> {
        if records.len() > MAX_DRAWINGS_PER_SCOPE {
            return Err(ChartDrawingError::Invalid(format!(
                "A symbol keeps at most {MAX_DRAWINGS_PER_SCOPE} drawings"
            )));
        }
        // Every record is checked before the transaction opens: a refused list writes nothing.
        for record in records {
            record.validate()?;
        }
        self.database
            .write(|connection| replace_scope(connection, scope, records))
            .map_err(ChartDrawingError::while_writing)
    }
}

/// Every drawing of one scope, in paint order, each with its points in order.
fn read_scope(connection: &Connection, scope: &ChartScope) -> Outcome<Vec<ChartDrawingRecord>> {
    let mut stored_points = read_points(connection, scope)?;
    let mut statement = connection.prepare(SELECT_SCOPE_DRAWINGS)?;
    let mut rows = statement.query(scope_params(scope))?;
    let mut records = Vec::new();
    while let Some(row) = rows.next()? {
        let settings: String = row.get(5)?;
        let timeframe_visibility: String = row.get(6)?;
        let id: String = row.get(0)?;
        let points = take_points(&mut stored_points, &id)?;
        records.push(ChartDrawingRecord {
            id,
            tool_id: row.get(1)?,
            locked: row.get(2)?,
            visible: row.get(3)?,
            below_bars: row.get(4)?,
            timeframe_visibility: serde_json::from_str(&timeframe_visibility)
                .map_err(|_| StoreError::Corrupt)?,
            settings: serde_json::from_str(&settings).map_err(|_| StoreError::Corrupt)?,
            points,
        });
    }
    Ok(records)
}

/// Every point of the scope, grouped by drawing, in point order.
fn read_points(
    connection: &Connection,
    scope: &ChartScope,
) -> Outcome<HashMap<String, Vec<ChartDrawingPoint>>> {
    let mut statement = connection.prepare(SELECT_SCOPE_POINTS)?;
    let mut rows = statement.query(scope_params(scope))?;
    let mut grouped: HashMap<String, Vec<ChartDrawingPoint>> = HashMap::new();
    while let Some(row) = rows.next()? {
        let drawing_id: String = row.get(0)?;
        let point = ChartDrawingPoint {
            time_ms: row.get(1)?,
            price: row.get(2)?,
        };
        grouped.entry(drawing_id).or_default().push(point);
    }
    Ok(grouped)
}

/// The three values every scope query filters by, in the order the SQL names them.
fn scope_params(scope: &ChartScope) -> (&str, &str, &str) {
    (scope.chart_id(), scope.account_key(), scope.symbol())
}

/// The points of one drawing. A drawing with none was not written by this build: it is corrupt.
fn take_points(
    stored_points: &mut HashMap<String, Vec<ChartDrawingPoint>>,
    drawing_id: &str,
) -> Outcome<Vec<ChartDrawingPoint>> {
    match stored_points.remove(drawing_id) {
        Some(points) => Ok(points),
        None => Err(StoreError::Corrupt.into()),
    }
}

/// Replaces the drawings of one scope: the old ones (their points cascade), then the new ones in
/// list order.
fn replace_scope(
    connection: &Connection,
    scope: &ChartScope,
    records: &[ChartDrawingRecord],
) -> Outcome<()> {
    connection.execute(DELETE_SCOPE_DRAWINGS, scope_params(scope))?;
    let mut insert_drawing = connection.prepare(INSERT_DRAWING)?;
    let mut insert_point = connection.prepare(INSERT_POINT)?;
    for (position, record) in records.iter().enumerate() {
        insert_drawing.execute(params![
            record.id,
            scope.chart_id(),
            scope.account_key(),
            scope.symbol(),
            to_row_number(position)?,
            record.tool_id,
            record.locked,
            record.visible,
            record.below_bars,
            settings_text(&record.settings)?,
            timeframe_visibility_text(&record.timeframe_visibility)?,
        ])?;
        insert_points(&mut insert_point, record)?;
    }
    Ok(())
}

fn insert_points(insert_point: &mut Statement<'_>, record: &ChartDrawingRecord) -> Outcome<()> {
    for (index, point) in record.points.iter().enumerate() {
        insert_point.execute(params![
            record.id,
            to_row_number(index)?,
            point.time_ms,
            point.price
        ])?;
    }
    Ok(())
}

/// The settings of one drawing as the JSON text the frontend sent.
fn settings_text(settings: &BTreeMap<String, Value>) -> Outcome<String> {
    serde_json::to_string(settings).map_err(|_| StoreError::WriteFailed.into())
}

/// The timeframe setting of one drawing as the JSON text the column keeps.
fn timeframe_visibility_text(visibility: &TimeframeVisibility) -> Outcome<String> {
    serde_json::to_string(visibility).map_err(|_| StoreError::WriteFailed.into())
}

/// A list index as the integer column that keeps the order.
fn to_row_number(index: usize) -> Outcome<i64> {
    i64::try_from(index).map_err(|_| StoreError::WriteFailed.into())
}
