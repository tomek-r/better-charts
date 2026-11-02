//! Every version of the app database schema, applied in order and never undone. A migration keeps
//! the rows the build before it saved: it adds what the newer schema needs, copies existing rows
//! into the new shape, and drops only what nothing reads any more.
//!
//! Each constant is the schema of one version and stays frozen: a later version adds its own
//! statements instead of editing the ones below it.

use sqlite_store::{
    rusqlite::{self, Transaction},
    Migration,
};

/// "BCA1" in ASCII: the Better Charts app database, so a file of another application is refused.
pub(super) const APPLICATION_ID: i32 = 0x4243_4131;

/// The version of the first drawings schema, applied once to a new file.
const SCHEMA_VERSION: u32 = 1;
/// The version that records whether a drawing is stacked below the price bars.
const BELOW_BARS_VERSION: u32 = 2;
/// The version that records on which timeframes a drawing paints.
const TIMEFRAME_VISIBILITY_VERSION: u32 = 3;
/// The version that recorded the time zone each chart was last shown in.
const CHART_TIME_ZONE_VERSION: u32 = 4;
/// The version that gives every chart an identity, a template and settings of its own.
const CHART_SETTINGS_VERSION: u32 = 5;

/// The schema of the first version: one drawing, then its ordered points.
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

/// The time zone of one chart: at most one row per account and symbol. Dropped by the version
/// that moved the time zone into the chart settings the frontend owns.
const CREATE_CHART_TIME_ZONE_TABLE: &str = "\
CREATE TABLE chart_time_zones (
  account_key TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  time_zone   TEXT NOT NULL,
  PRIMARY KEY (account_key, symbol)
) STRICT, WITHOUT ROWID;";

/// The tables that give the database its charts: groups to lay charts out in, the templates a
/// chart starts from, the charts themselves and the settings one chart keeps per account and
/// symbol. One group and one chart are seeded so the app always has a chart to draw; the seeded
/// chart is the one the drawings of the versions before this one belong to.
const CREATE_CHART_SETTINGS_TABLES: &str = "\
CREATE TABLE chart_groups (
  group_id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE
) STRICT;
CREATE TABLE chart_templates (
  template_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  settings    TEXT NOT NULL
) STRICT;
INSERT INTO chart_templates (template_id, name, settings) VALUES ('default', 'Default', '{}');
CREATE TABLE charts (
  chart_id    TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES chart_groups(group_id),
  template_id TEXT NOT NULL REFERENCES chart_templates(template_id),
  position    INTEGER NOT NULL,
  UNIQUE (group_id, position)
) STRICT;
INSERT INTO chart_groups (group_id, position) VALUES (lower(hex(randomblob(16))), 0);
INSERT INTO charts (chart_id, group_id, template_id, position)
SELECT lower(hex(randomblob(16))), groups.group_id, 'default', 0 FROM chart_groups AS groups;
CREATE TABLE chart_setting_overrides (
  chart_id    TEXT NOT NULL REFERENCES charts(chart_id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  settings    TEXT NOT NULL,
  PRIMARY KEY (chart_id, account_key, symbol)
) STRICT, WITHOUT ROWID;";

/// The drawings with the chart they belong to. Every saved drawing moves to the seeded chart, so
/// nothing the user drew is lost. The points are dropped before their drawings, so no cascade
/// deletes a point that was already copied.
const REBUILD_DRAWINGS_WITH_CHART: &str = "\
CREATE TABLE chart_drawings_next (
  drawing_id  TEXT PRIMARY KEY,
  chart_id    TEXT NOT NULL REFERENCES charts(chart_id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  position    INTEGER NOT NULL,
  tool_id     TEXT NOT NULL,
  is_locked   INTEGER NOT NULL CHECK (is_locked IN (0,1)),
  is_visible  INTEGER NOT NULL CHECK (is_visible IN (0,1)),
  inputs      TEXT NOT NULL,
  is_below_bars        INTEGER NOT NULL CHECK (is_below_bars IN (0,1)),
  timeframe_visibility TEXT NOT NULL,
  UNIQUE (chart_id, account_key, symbol, position)
) STRICT;
CREATE TABLE chart_drawing_points_next (
  drawing_id  TEXT NOT NULL REFERENCES chart_drawings_next(drawing_id) ON DELETE CASCADE,
  point_index INTEGER NOT NULL,
  time_ms     INTEGER,
  price       TEXT,
  CHECK (time_ms IS NOT NULL OR price IS NOT NULL),
  PRIMARY KEY (drawing_id, point_index)
) STRICT, WITHOUT ROWID;
INSERT INTO chart_drawings_next
  (drawing_id, chart_id, account_key, symbol, position, tool_id, is_locked, is_visible, inputs,
   is_below_bars, timeframe_visibility)
SELECT drawings.drawing_id, (SELECT chart_id FROM charts), drawings.account_key, drawings.symbol,
       drawings.position, drawings.tool_id, drawings.is_locked, drawings.is_visible,
       drawings.inputs, drawings.is_below_bars, drawings.timeframe_visibility
FROM chart_drawings AS drawings;
INSERT INTO chart_drawing_points_next (drawing_id, point_index, time_ms, price)
SELECT drawing_id, point_index, time_ms, price FROM chart_drawing_points;
DROP TABLE chart_drawing_points;
DROP TABLE chart_drawings;
ALTER TABLE chart_drawings_next RENAME TO chart_drawings;
ALTER TABLE chart_drawing_points_next RENAME TO chart_drawing_points;";

/// The per-symbol time zone is now a chart setting the frontend keeps, so its table is dropped
/// rather than carried over.
const DROP_CHART_TIME_ZONE_TABLE: &str = "DROP TABLE chart_time_zones";

/// The migrations of the app database, applied in order and never undone.
pub(super) const MIGRATIONS: &[Migration] = &[
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
    Migration {
        target_version: CHART_SETTINGS_VERSION,
        apply: create_chart_settings_schema,
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

/// The charts, the templates and the overrides first, then the drawings that point at them: the
/// order the seeded chart must exist in before a drawing can name it.
fn create_chart_settings_schema(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(CREATE_CHART_SETTINGS_TABLES)?;
    transaction.execute_batch(REBUILD_DRAWINGS_WITH_CHART)?;
    transaction.execute_batch(DROP_CHART_TIME_ZONE_TABLE)
}
