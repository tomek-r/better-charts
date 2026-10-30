//! The drawings of every account and symbol in one SQLite file: a row per drawing and a row
//! per anchor point, so every tool stores the same shape, plus the time zone each chart was
//! last shown in.

use super::{
    chart_time_zone::ChartTimeZone,
    error::ChartDrawingError,
    record::{ChartDrawingPoint, ChartDrawingRecord},
    store::{ChartDrawingStore, DrawingScope, MAX_DRAWINGS_PER_SCOPE},
    timeframe_visibility::TimeframeVisibility,
};
use serde_json::Value;
use sqlite_store::rusqlite;
use sqlite_store::{
    rusqlite::{params, Connection, OptionalExtension, Statement, Transaction},
    Migration, Outcome, SqliteDatabase, StoreError,
};
use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
};

/// "BCA1" in ASCII: the Better Charts app database, so a file of another application is refused.
const APPLICATION_ID: i32 = 0x4243_4131;

/// The version of the drawings schema, applied once to a new file.
const SCHEMA_VERSION: u32 = 1;
/// The version that records whether a drawing is stacked below the price bars.
const BELOW_BARS_VERSION: u32 = 2;
/// The version that records on which timeframes a drawing paints.
const TIMEFRAME_VISIBILITY_VERSION: u32 = 3;
/// The version that records the time zone each chart was last shown in.
const CHART_TIME_ZONE_VERSION: u32 = 4;

/// The schema of the drawings database: one drawing, then its ordered points.
const CREATE_SCHEMA: &str = "\
CREATE TABLE chart_drawings (
  drawing_id  TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  position    INTEGER NOT NULL,
  tool_id     TEXT NOT NULL,
  is_locked   INTEGER NOT NULL CHECK (is_locked IN (0,1)),
  is_visible  INTEGER NOT NULL CHECK (is_visible IN (0,1)),
  inputs      TEXT NOT NULL,
  UNIQUE (account_key, symbol, position)
) STRICT;
CREATE TABLE chart_drawing_points (
  drawing_id  TEXT NOT NULL REFERENCES chart_drawings(drawing_id) ON DELETE CASCADE,
  point_index INTEGER NOT NULL,
  time_ms     INTEGER,
  price       TEXT,
  CHECK (time_ms IS NOT NULL OR price IS NOT NULL),
  PRIMARY KEY (drawing_id, point_index)
) STRICT, WITHOUT ROWID;";

/// The stacking flag as a column of its own; a drawing stored before it stands above the bars.
const ADD_BELOW_BARS_COLUMN: &str = "\
ALTER TABLE chart_drawings
  ADD COLUMN is_below_bars INTEGER NOT NULL DEFAULT 0 CHECK (is_below_bars IN (0,1))";

/// The timeframe setting as the JSON text the frontend sends; a drawing stored before it was kept
/// shows on every timeframe, which is exactly the default below (a test pins the two together).
const ADD_TIMEFRAME_VISIBILITY_COLUMN: &str = "\
ALTER TABLE chart_drawings
  ADD COLUMN timeframe_visibility TEXT NOT NULL DEFAULT
  '{\"minutes\":{\"shown\":true,\"from\":1,\"to\":30},\"hours\":{\"shown\":true,\"from\":1,\"to\":12},\"days\":true,\"weeks\":true,\"months\":true}'";

/// The time zone of one chart: at most one row per account and symbol.
const CREATE_CHART_TIME_ZONE_TABLE: &str = "\
CREATE TABLE chart_time_zones (
  account_key TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  time_zone   TEXT NOT NULL,
  PRIMARY KEY (account_key, symbol)
) STRICT, WITHOUT ROWID;";

const SELECT_SCOPE_DRAWINGS: &str = "\
SELECT drawing_id, tool_id, is_locked, is_visible, is_below_bars, inputs, timeframe_visibility
FROM chart_drawings
WHERE account_key = ?1 AND symbol = ?2
ORDER BY position";

const SELECT_SCOPE_POINTS: &str = "\
SELECT points.drawing_id, points.time_ms, points.price
FROM chart_drawing_points AS points
JOIN chart_drawings AS drawings ON drawings.drawing_id = points.drawing_id
WHERE drawings.account_key = ?1 AND drawings.symbol = ?2
ORDER BY points.drawing_id, points.point_index";

const DELETE_SCOPE_DRAWINGS: &str =
    "DELETE FROM chart_drawings WHERE account_key = ?1 AND symbol = ?2";

const INSERT_DRAWING: &str = "\
INSERT INTO chart_drawings
  (drawing_id, account_key, symbol, position, tool_id, is_locked, is_visible, is_below_bars, inputs,
   timeframe_visibility)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)";

const INSERT_POINT: &str = "\
INSERT INTO chart_drawing_points (drawing_id, point_index, time_ms, price)
VALUES (?1, ?2, ?3, ?4)";

const SELECT_SCOPE_TIME_ZONE: &str =
    "SELECT time_zone FROM chart_time_zones WHERE account_key = ?1 AND symbol = ?2";

const UPSERT_SCOPE_TIME_ZONE: &str = "\
INSERT INTO chart_time_zones (account_key, symbol, time_zone)
VALUES (?1, ?2, ?3)
ON CONFLICT (account_key, symbol) DO UPDATE SET time_zone = excluded.time_zone";

/// The migrations of the drawings database, applied in order and never undone.
const MIGRATIONS: &[Migration] = &[
    Migration {
        target_version: SCHEMA_VERSION,
        apply: create_schema,
    },
    Migration {
        target_version: BELOW_BARS_VERSION,
        apply: add_below_bars_column,
    },
    Migration {
        target_version: TIMEFRAME_VISIBILITY_VERSION,
        apply: add_timeframe_visibility_column,
    },
    Migration {
        target_version: CHART_TIME_ZONE_VERSION,
        apply: create_chart_time_zone_table,
    },
];

fn create_schema(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(CREATE_SCHEMA)
}

fn add_below_bars_column(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(ADD_BELOW_BARS_COLUMN)
}

fn add_timeframe_visibility_column(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(ADD_TIMEFRAME_VISIBILITY_COLUMN)
}

fn create_chart_time_zone_table(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(CREATE_CHART_TIME_ZONE_TABLE)
}

/// The drawings of this installation, kept in one SQLite file.
pub(super) struct SqliteChartDrawingStore {
    database: SqliteDatabase,
}

impl SqliteChartDrawingStore {
    /// Opens (and, on a new file, migrates) the drawings database at `path`.
    pub(super) fn open(path: &Path) -> Result<Self, StoreError> {
        SqliteDatabase::open(path, APPLICATION_ID, MIGRATIONS).map(Self::from_database)
    }

    /// A database that lives and dies with the test.
    #[cfg(test)]
    pub(super) fn in_memory() -> Result<Self, StoreError> {
        SqliteDatabase::in_memory(APPLICATION_ID, MIGRATIONS).map(Self::from_database)
    }

    /// A database opened with every migration but the last, so a test can write the rows the
    /// build before it wrote and then open the file with this build.
    #[cfg(test)]
    pub(super) fn open_before_last_migration(path: &Path) -> Result<Self, StoreError> {
        let earlier = &MIGRATIONS[..MIGRATIONS.len() - 1];
        SqliteDatabase::open(path, APPLICATION_ID, earlier).map(Self::from_database)
    }

    /// The database behind the store, for a test that writes a row this build never wrote.
    #[cfg(test)]
    pub(super) fn database(&self) -> &SqliteDatabase {
        &self.database
    }

    fn from_database(database: SqliteDatabase) -> Self {
        Self { database }
    }
}

impl ChartDrawingStore for SqliteChartDrawingStore {
    fn load(&self, scope: &DrawingScope) -> Result<Vec<ChartDrawingRecord>, ChartDrawingError> {
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
        scope: &DrawingScope,
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

    fn load_time_zone(
        &self,
        scope: &DrawingScope,
    ) -> Result<Option<ChartTimeZone>, ChartDrawingError> {
        let stored_time_zone = self
            .database
            .read(|connection| read_time_zone(connection, scope))
            .map_err(ChartDrawingError::time_zone_while_reading)?;
        // A row this build cannot read is an error, never a chart that silently shows its default.
        stored_time_zone
            .map(|time_zone| {
                ChartTimeZone::new(time_zone).map_err(|_| ChartDrawingError::TimeZoneUnreadable)
            })
            .transpose()
    }

    fn save_time_zone(
        &self,
        scope: &DrawingScope,
        time_zone: &ChartTimeZone,
    ) -> Result<(), ChartDrawingError> {
        self.database
            .write(|connection| write_time_zone(connection, scope, time_zone))
            .map_err(ChartDrawingError::time_zone_while_writing)
    }
}

/// Every drawing of one scope, in paint order, each with its points in order.
fn read_scope(connection: &Connection, scope: &DrawingScope) -> Outcome<Vec<ChartDrawingRecord>> {
    let mut stored_points = read_points(connection, scope)?;
    let mut statement = connection.prepare(SELECT_SCOPE_DRAWINGS)?;
    let mut rows = statement.query(params![scope.account_key(), scope.symbol()])?;
    let mut records = Vec::new();
    while let Some(row) = rows.next()? {
        let inputs: String = row.get(5)?;
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
            inputs: serde_json::from_str(&inputs).map_err(|_| StoreError::Corrupt)?,
            points,
        });
    }
    Ok(records)
}

/// Every point of the scope, grouped by drawing, in point order.
fn read_points(
    connection: &Connection,
    scope: &DrawingScope,
) -> Outcome<HashMap<String, Vec<ChartDrawingPoint>>> {
    let mut statement = connection.prepare(SELECT_SCOPE_POINTS)?;
    let mut rows = statement.query(params![scope.account_key(), scope.symbol()])?;
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
    scope: &DrawingScope,
    records: &[ChartDrawingRecord],
) -> Outcome<()> {
    connection.execute(
        DELETE_SCOPE_DRAWINGS,
        params![scope.account_key(), scope.symbol()],
    )?;
    let mut insert_drawing = connection.prepare(INSERT_DRAWING)?;
    let mut insert_point = connection.prepare(INSERT_POINT)?;
    for (position, record) in records.iter().enumerate() {
        insert_drawing.execute(params![
            record.id,
            scope.account_key(),
            scope.symbol(),
            to_row_number(position)?,
            record.tool_id,
            record.locked,
            record.visible,
            record.below_bars,
            inputs_text(&record.inputs)?,
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

/// The inputs map of one drawing as the JSON text the frontend sent.
fn inputs_text(inputs: &BTreeMap<String, Value>) -> Outcome<String> {
    serde_json::to_string(inputs).map_err(|_| StoreError::WriteFailed.into())
}

/// The timeframe setting of one drawing as JSON text, the shape the column's default also has.
fn timeframe_visibility_text(visibility: &TimeframeVisibility) -> Outcome<String> {
    serde_json::to_string(visibility).map_err(|_| StoreError::WriteFailed.into())
}

/// A list index as the integer column that keeps the order.
fn to_row_number(index: usize) -> Outcome<i64> {
    i64::try_from(index).map_err(|_| StoreError::WriteFailed.into())
}

/// The time zone saved for one scope, exactly as stored, or none when that chart has none yet.
fn read_time_zone(connection: &Connection, scope: &DrawingScope) -> Outcome<Option<String>> {
    let stored_time_zone: Option<String> = connection
        .query_row(
            SELECT_SCOPE_TIME_ZONE,
            params![scope.account_key(), scope.symbol()],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored_time_zone)
}

/// Replaces the time zone of one scope, so a chart that already has one keeps a single row.
fn write_time_zone(
    connection: &Connection,
    scope: &DrawingScope,
    time_zone: &ChartTimeZone,
) -> Outcome<()> {
    connection.execute(
        UPSERT_SCOPE_TIME_ZONE,
        params![scope.account_key(), scope.symbol(), time_zone.as_str()],
    )?;
    Ok(())
}
