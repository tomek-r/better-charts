//! The drawings store behind the commands: what it keeps per chart, account and symbol, what it
//! refuses, and what a row this build cannot trust reports.

use super::{
    record::{ChartDrawingPoint, ChartDrawingRecord, MAX_POINTS_PER_DRAWING},
    sqlite_drawing_store::SqliteChartDrawingStore,
    store::{ChartDrawingStore, MAX_DRAWINGS_PER_SCOPE},
    timeframe_visibility::{TimeframeCountRange, TimeframeVisibility},
    ChartDrawingsState,
};
use crate::chart_database::{self, open_chart_database, ChartScope};
use serde_json::json;
use sqlite_store::{rusqlite::params, SqliteDatabase};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

/// The account the stub's bridge reports, spelled the way the frontend scopes it.
const ACCOUNT_KEY: &str = "50123456@Broker-Demo";
const OTHER_ACCOUNT_KEY: &str = "70001234@Broker-Live";
/// The chart a test adds beside the seeded one, so one account and symbol can be drawn twice.
const SECOND_CHART_ID: &str = "second-chart";
/// Milliseconds of one five-minute bar, the slot width the test bar series uses.
const BAR_MS: i64 = 300_000;
/// Schema versions stay as they are in the migrations, so these stay valid: the one before the
/// stacking flag, the one before the timeframe setting, the last one before the charts, and the
/// one that still named a drawing's stored values its inputs.
const BEFORE_BELOW_BARS_VERSION: u32 = 1;
const BEFORE_TIMEFRAME_VISIBILITY_VERSION: u32 = 2;
const BEFORE_CHART_SETTINGS_VERSION: u32 = 4;
const BEFORE_DRAWING_SETTINGS_VERSION: u32 = 5;

/// The drawings of one chart database this test owns, with the chart the migration seeds.
struct TestChart {
    database: Arc<SqliteDatabase>,
    chart_id: String,
}

impl TestChart {
    /// A database of its own in memory: the tests never touch the user's drawings database.
    fn new() -> Self {
        let database = chart_database::in_memory().expect("the in-memory database opens");
        let chart_id = seeded_chart_id(&database);
        Self { database, chart_id }
    }

    fn store(&self) -> SqliteChartDrawingStore {
        SqliteChartDrawingStore::from_database(Arc::clone(&self.database))
    }

    fn scope(&self, account_key: &str, symbol: &str) -> ChartScope {
        scope_of(&self.chart_id, account_key, symbol)
    }

    /// Saves one scope's drawings on the seeded chart, failing the test when the store refuses
    /// them.
    fn save(&self, account_key: &str, symbol: &str, records: &[ChartDrawingRecord]) {
        self.store()
            .save(&self.scope(account_key, symbol), records)
            .expect("the drawings save");
    }

    /// Everything one scope of the seeded chart holds, as the store loads it.
    fn loaded(&self, account_key: &str, symbol: &str) -> Vec<ChartDrawingRecord> {
        self.store()
            .load(&self.scope(account_key, symbol))
            .expect("the drawings load")
    }

    /// The ids one scope of the seeded chart holds, in paint order.
    fn ids(&self, account_key: &str, symbol: &str) -> Vec<String> {
        ids_in(&self.store(), &self.scope(account_key, symbol))
    }
}

/// The scope the three values name, as the command that receives them builds it.
fn try_scope(chart_id: &str, account_key: &str, symbol: &str) -> Result<ChartScope, String> {
    ChartScope::new(
        chart_id.to_owned(),
        account_key.to_owned(),
        symbol.to_owned(),
    )
}

/// The scope of the account and symbol on the chart `chart_id` names.
fn scope_of(chart_id: &str, account_key: &str, symbol: &str) -> ChartScope {
    try_scope(chart_id, account_key, symbol).expect("the scope is valid")
}

/// The ids one scope holds, in paint order.
fn ids_in(store: &SqliteChartDrawingStore, scope: &ChartScope) -> Vec<String> {
    store
        .load(scope)
        .expect("the drawings load")
        .into_iter()
        .map(|record| record.id)
        .collect()
}

/// The id of the chart the migration seeds, the one nearly every test draws on.
fn seeded_chart_id(database: &SqliteDatabase) -> String {
    database
        .read(|connection| {
            let chart_id: String = connection.query_row(
                "SELECT chart_id FROM charts ORDER BY position LIMIT 1",
                params![],
                |row| row.get(0),
            )?;
            Ok(chart_id)
        })
        .expect("the seeded chart is stored")
}

/// Whether the database still holds the per-symbol time zone table that the charts replaced.
fn chart_time_zone_table_exists(database: &SqliteDatabase) -> bool {
    database
        .read(|connection| {
            let tables: i64 = connection.query_row(
                "SELECT count(*) FROM sqlite_master \
                 WHERE type = 'table' AND name = 'chart_time_zones'",
                params![],
                |row| row.get(0),
            )?;
            Ok(tables > 0)
        })
        .expect("the schema is readable")
}

fn time_point(time_ms: i64) -> ChartDrawingPoint {
    ChartDrawingPoint {
        time_ms: Some(time_ms),
        price: None,
    }
}

fn priced_point(price: &str) -> ChartDrawingPoint {
    ChartDrawingPoint {
        time_ms: None,
        price: Some(price.to_owned()),
    }
}

fn record(id: &str) -> ChartDrawingRecord {
    ChartDrawingRecord {
        id: id.to_owned(),
        tool_id: "fixedRangeProfile".to_owned(),
        locked: false,
        visible: true,
        below_bars: false,
        timeframe_visibility: TimeframeVisibility::default(),
        settings: BTreeMap::from([("rows".to_owned(), json!(128))]),
        points: vec![time_point(1_700_000_000_000), time_point(1_700_000_900_000)],
    }
}

/// The default timeframe setting as the JSON text the column keeps.
fn default_visibility_text() -> String {
    serde_json::to_string(&TimeframeVisibility::default()).expect("the default setting serializes")
}

/// Writes one drawing row of this build by hand, so the store reads a row it never wrote.
fn insert_drawing(database: &SqliteDatabase, chart_id: &str, id: &str, settings: &str) {
    database
        .write(|connection| {
            connection.execute(
                "INSERT INTO chart_drawings \
                 (drawing_id, chart_id, account_key, symbol, position, tool_id, is_locked, \
                  is_visible, settings, is_below_bars, timeframe_visibility) \
                 VALUES (?1, ?2, ?3, 'EURUSD', 0, 'fixedRangeProfile', 0, 1, ?4, 0, ?5)",
                params![
                    id,
                    chart_id,
                    ACCOUNT_KEY,
                    settings,
                    default_visibility_text()
                ],
            )?;
            Ok(())
        })
        .expect("the hand-written drawing is stored");
}

/// Writes one drawing row in the shape version 5 wrote, where the column of a drawing's stored
/// values still carried the name of its inputs, so only the migration renames it.
fn insert_drawing_before_settings_column(
    database: &SqliteDatabase,
    chart_id: &str,
    id: &str,
    inputs: &str,
) {
    database
        .write(|connection| {
            connection.execute(
                "INSERT INTO chart_drawings \
                 (drawing_id, chart_id, account_key, symbol, position, tool_id, is_locked, \
                  is_visible, inputs, is_below_bars, timeframe_visibility) \
                 VALUES (?1, ?2, ?3, 'EURUSD', 0, 'fixedRangeProfile', 0, 1, ?4, 0, ?5)",
                params![id, chart_id, ACCOUNT_KEY, inputs, default_visibility_text()],
            )?;
            Ok(())
        })
        .expect("the hand-written drawing is stored");
}

/// Writes one drawing row in the shape the versions before the charts had, so a migration test
/// leaves the columns those versions added to their defaults.
fn insert_legacy_drawing(database: &SqliteDatabase, id: &str, inputs: &str) {
    database
        .write(|connection| {
            connection.execute(
                "INSERT INTO chart_drawings \
                 (drawing_id, account_key, symbol, position, tool_id, is_locked, is_visible, \
                  inputs) \
                 VALUES (?1, ?2, 'EURUSD', 0, 'fixedRangeProfile', 0, 1, ?3)",
                params![id, ACCOUNT_KEY, inputs],
            )?;
            Ok(())
        })
        .expect("the hand-written legacy drawing is stored");
}

/// Writes one point of the drawing under `id`, so a drawing the test wrote itself loads.
fn insert_point(database: &SqliteDatabase, id: &str, point_index: i64, time_ms: i64) {
    database
        .write(|connection| {
            connection.execute(
                "INSERT INTO chart_drawing_points (drawing_id, point_index, time_ms, price) \
                 VALUES (?1, ?2, ?3, NULL)",
                params![id, point_index, time_ms],
            )?;
            Ok(())
        })
        .expect("the hand-written point is stored");
}

/// Writes one time zone row of the version before the charts, the row the upgrade drops.
fn insert_time_zone(database: &SqliteDatabase, time_zone: &str) {
    database
        .write(|connection| {
            connection.execute(
                "INSERT INTO chart_time_zones (account_key, symbol, time_zone) VALUES (?1, ?2, ?3)",
                params![ACCOUNT_KEY, "EURUSD", time_zone],
            )?;
            Ok(())
        })
        .expect("the hand-written time zone is stored");
}

/// Writes a second chart row by hand, so the tests can draw one account and symbol twice.
fn insert_chart(database: &SqliteDatabase, chart_id: &str, position: i64) {
    database
        .write(|connection| {
            connection.execute(
                "INSERT INTO charts (chart_id, group_id, template_id, position) \
                 SELECT ?1, group_id, 'default', ?2 FROM chart_groups ORDER BY position LIMIT 1",
                params![chart_id, position],
            )?;
            Ok(())
        })
        .expect("the second chart is stored");
}

/// A folder of this test's own, removed with it; the database and its lock file live in it.
struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "better-charts-drawings-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("the test folder is created");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn the_drawings_of_one_scope_round_trip() {
    let chart = TestChart::new();
    let saved = ChartDrawingRecord {
        locked: true,
        visible: false,
        settings: BTreeMap::from([
            ("rows".to_owned(), json!(128)),
            ("label".to_owned(), json!("trend")),
        ]),
        points: vec![
            time_point(1_700_000_000_000),
            ChartDrawingPoint {
                time_ms: Some(1_700_000_900_000),
                price: Some("-2.5".to_owned()),
            },
            priced_point("1.08505"),
        ],
        ..record("profile-1")
    };

    chart.save(ACCOUNT_KEY, "EURUSD", std::slice::from_ref(&saved));

    assert_eq!(chart.loaded(ACCOUNT_KEY, "EURUSD"), [saved]);
}

#[test]
fn the_below_bars_flag_round_trips_both_values() {
    let chart = TestChart::new();
    let mut below = record("below-bars");
    below.below_bars = true;
    let above = record("above-bars");

    chart.save(ACCOUNT_KEY, "EURUSD", &[below, above]);

    let restored = chart.loaded(ACCOUNT_KEY, "EURUSD");
    assert!(restored[0].below_bars);
    assert!(!restored[1].below_bars);
}

#[test]
fn a_stored_payload_without_the_below_bars_flag_stands_above_the_bars() {
    let stored: ChartDrawingRecord = serde_json::from_str(
        r#"{"id":"profile-1","toolId":"fixedRangeProfile","locked":false,"visible":true,
            "settings":{},"points":[{"timeMs":1700000000000,"price":null}]}"#,
    )
    .expect("the record parses without the flag");

    assert!(!stored.below_bars);
}

/// Minutes 1 to 15 only, no hours and no weeks: a setting that differs from the default everywhere.
fn restricted_visibility() -> TimeframeVisibility {
    TimeframeVisibility {
        minutes: TimeframeCountRange {
            shown: true,
            from: 1,
            to: 15,
        },
        hours: TimeframeCountRange {
            shown: false,
            from: 2,
            to: 8,
        },
        days: true,
        weeks: false,
        months: true,
    }
}

#[test]
fn the_timeframe_visibility_round_trips() {
    let chart = TestChart::new();
    let restricted = ChartDrawingRecord {
        timeframe_visibility: restricted_visibility(),
        ..record("restricted")
    };

    chart.save(
        ACCOUNT_KEY,
        "EURUSD",
        &[restricted.clone(), record("everywhere")],
    );

    let restored = chart.loaded(ACCOUNT_KEY, "EURUSD");
    assert_eq!(restored[0], restricted);
    assert_eq!(
        restored[1].timeframe_visibility,
        TimeframeVisibility::default()
    );
}

#[test]
fn a_stored_payload_without_the_timeframe_visibility_shows_everywhere() {
    let stored: ChartDrawingRecord = serde_json::from_str(
        r#"{"id":"profile-1","toolId":"fixedRangeProfile","locked":false,"visible":true,
            "settings":{},"points":[{"timeMs":1700000000000,"price":null}]}"#,
    )
    .expect("the record parses without the setting");

    assert_eq!(stored.timeframe_visibility, TimeframeVisibility::default());
}

#[test]
fn a_reversed_timeframe_range_is_refused_and_writes_nothing() {
    let chart = TestChart::new();
    let mut reversed = restricted_visibility();
    reversed.minutes.from = 20;
    reversed.minutes.to = 5;
    let refused = ChartDrawingRecord {
        timeframe_visibility: reversed,
        ..record("reversed")
    };

    let error = chart
        .store()
        .save(&chart.scope(ACCOUNT_KEY, "EURUSD"), &[refused])
        .expect_err("the range is refused");

    assert!(error.to_string().contains("minutes"), "{error}");
    assert!(chart.loaded(ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn two_scopes_never_see_each_other() {
    let chart = TestChart::new();
    chart.save(ACCOUNT_KEY, "EURUSD", &[record("eurusd-1")]);
    chart.save(ACCOUNT_KEY, "NAS100", &[record("nas100-1")]);
    chart.save(OTHER_ACCOUNT_KEY, "EURUSD", &[record("other-1")]);

    assert_eq!(chart.ids(ACCOUNT_KEY, "EURUSD"), ["eurusd-1"]);
    assert_eq!(chart.ids(ACCOUNT_KEY, "NAS100"), ["nas100-1"]);
    assert_eq!(chart.ids(OTHER_ACCOUNT_KEY, "EURUSD"), ["other-1"]);
    assert!(chart.loaded(OTHER_ACCOUNT_KEY, "NAS100").is_empty());
}

#[test]
fn the_same_account_and_symbol_on_two_charts_keep_separate_drawings() {
    let chart = TestChart::new();
    let second = scope_of(SECOND_CHART_ID, ACCOUNT_KEY, "EURUSD");
    insert_chart(&chart.database, SECOND_CHART_ID, 1);

    chart.save(ACCOUNT_KEY, "EURUSD", &[record("seeded-chart-1")]);
    chart
        .store()
        .save(&second, &[record("second-chart-1")])
        .expect("the drawings save");

    assert_eq!(chart.ids(ACCOUNT_KEY, "EURUSD"), ["seeded-chart-1"]);
    assert_eq!(ids_in(&chart.store(), &second), ["second-chart-1"]);
}

#[test]
fn an_empty_list_removes_the_drawings_of_the_scope() {
    let chart = TestChart::new();
    chart.save(ACCOUNT_KEY, "EURUSD", &[record("profile-1")]);

    chart.save(ACCOUNT_KEY, "EURUSD", &[]);
    // A scope that already holds nothing is the state the caller asked for.
    chart.save(ACCOUNT_KEY, "EURUSD", &[]);

    assert!(chart.loaded(ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn the_drawings_keep_their_position_and_their_points_keep_their_order() {
    let chart = TestChart::new();
    let first = record("profile-1");
    let mut second = record("profile-2");
    second.points = (0..5)
        .map(|index| time_point(1_700_000_000_000 + index * BAR_MS))
        .collect();

    chart.save(ACCOUNT_KEY, "EURUSD", &[first, second.clone()]);

    assert_eq!(chart.ids(ACCOUNT_KEY, "EURUSD"), ["profile-1", "profile-2"]);
    assert_eq!(chart.loaded(ACCOUNT_KEY, "EURUSD")[1].points, second.points);
}

#[test]
fn a_scope_needs_a_present_and_bounded_chart_account_and_symbol() {
    assert!(try_scope("", ACCOUNT_KEY, "EURUSD").is_err());
    assert!(try_scope(&"c".repeat(65), ACCOUNT_KEY, "EURUSD").is_err());
    assert!(try_scope("chart-1", "", "EURUSD").is_err());
    assert!(try_scope("chart-1", &"a".repeat(257), "EURUSD").is_err());
    assert!(try_scope("chart-1", ACCOUNT_KEY, "").is_err());
    assert!(try_scope("chart-1", ACCOUNT_KEY, &"S".repeat(65)).is_err());
    assert!(try_scope("chart-1", ACCOUNT_KEY, "EURUSD").is_ok());
}

#[test]
fn a_list_above_the_limit_is_refused_and_writes_nothing() {
    let chart = TestChart::new();
    let records: Vec<ChartDrawingRecord> = (0..=MAX_DRAWINGS_PER_SCOPE)
        .map(|index| record(&format!("profile-{index}")))
        .collect();

    let refused = chart
        .store()
        .save(&chart.scope(ACCOUNT_KEY, "EURUSD"), &records);

    let message = refused.expect_err("the list is refused").to_string();
    assert!(message.contains("at most"), "{message}");
    assert!(chart.loaded(ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_point_without_a_time_or_a_price_is_refused_and_writes_nothing() {
    let chart = TestChart::new();
    let mut anchored = record("profile-1");
    anchored.points = vec![ChartDrawingPoint {
        time_ms: None,
        price: None,
    }];

    assert!(chart
        .store()
        .save(&chart.scope(ACCOUNT_KEY, "EURUSD"), &[anchored])
        .is_err());
    assert!(chart.loaded(ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_price_in_exponent_form_is_refused_and_writes_nothing() {
    let chart = TestChart::new();
    let mut exponent = record("profile-1");
    exponent.points = vec![priced_point("1e5")];

    let refused = chart
        .store()
        .save(&chart.scope(ACCOUNT_KEY, "EURUSD"), &[exponent]);

    let message = refused.expect_err("the price is refused").to_string();
    assert!(message.contains("decimal"), "{message}");
    assert!(chart.loaded(ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_list_with_too_many_points_is_refused_and_writes_nothing() {
    let chart = TestChart::new();
    let mut crowded = record("profile-1");
    crowded.points = (0..=MAX_POINTS_PER_DRAWING)
        .map(|_| time_point(1_700_000_000_000))
        .collect();

    assert!(chart
        .store()
        .save(&chart.scope(ACCOUNT_KEY, "EURUSD"), &[crowded])
        .is_err());
    assert!(chart.loaded(ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_settings_column_that_is_not_json_fails_the_load() {
    let chart = TestChart::new();
    insert_drawing(&chart.database, &chart.chart_id, "corrupt", "not json");

    assert!(chart
        .store()
        .load(&chart.scope(ACCOUNT_KEY, "EURUSD"))
        .is_err());
}

#[test]
fn a_drawing_without_points_fails_the_load() {
    let chart = TestChart::new();
    insert_drawing(&chart.database, &chart.chart_id, "pointless", "{}");

    assert!(chart
        .store()
        .load(&chart.scope(ACCOUNT_KEY, "EURUSD"))
        .is_err());
}

#[test]
fn the_drawings_of_a_database_file_survive_a_reopen() {
    let directory = TestDirectory::new();
    {
        let database =
            open_chart_database(Some(directory.path().to_path_buf())).expect("the database opens");
        let chart_id = seeded_chart_id(&database);
        let store = SqliteChartDrawingStore::from_database(Arc::clone(&database));
        store
            .save(
                &scope_of(&chart_id, ACCOUNT_KEY, "EURUSD"),
                &[record("profile-1")],
            )
            .expect("the drawings save");
    }

    let reopened = open_chart_database(Some(directory.path().to_path_buf()))
        .expect("the database opens again");
    let store = SqliteChartDrawingStore::from_database(Arc::clone(&reopened));

    assert_eq!(
        ids_in(
            &store,
            &scope_of(&seeded_chart_id(&reopened), ACCOUNT_KEY, "EURUSD")
        ),
        ["profile-1"]
    );
}

#[test]
fn a_drawing_written_before_the_below_bars_migration_opens_above_the_bars() {
    let directory = TestDirectory::new();
    let path = directory.path().join(chart_database::DATABASE_FILE_NAME);
    {
        let database = chart_database::open_at_version(&path, BEFORE_BELOW_BARS_VERSION)
            .expect("the database opens with the earlier migrations");
        // The row leaves out the below-bars column that build did not have, so only the
        // migration's default can fill it.
        insert_legacy_drawing(&database, "profile-1", "{}");
        insert_point(&database, "profile-1", 0, 1_700_000_000_000);
    }

    let migrated =
        open_chart_database(Some(directory.path().to_path_buf())).expect("the database migrates");
    let store = SqliteChartDrawingStore::from_database(Arc::clone(&migrated));

    let restored = store
        .load(&scope_of(
            &seeded_chart_id(&migrated),
            ACCOUNT_KEY,
            "EURUSD",
        ))
        .expect("the drawings load");
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, "profile-1");
    assert!(!restored[0].below_bars);
}

#[test]
fn a_drawing_written_before_the_timeframe_migration_shows_on_every_timeframe() {
    let directory = TestDirectory::new();
    let path = directory.path().join(chart_database::DATABASE_FILE_NAME);
    {
        let database = chart_database::open_at_version(&path, BEFORE_TIMEFRAME_VISIBILITY_VERSION)
            .expect("the database opens with the earlier migrations");
        insert_legacy_drawing(&database, "profile-1", "{}");
        insert_point(&database, "profile-1", 0, 1_700_000_000_000);
    }

    let migrated =
        open_chart_database(Some(directory.path().to_path_buf())).expect("the database migrates");
    let store = SqliteChartDrawingStore::from_database(Arc::clone(&migrated));

    let restored = store
        .load(&scope_of(
            &seeded_chart_id(&migrated),
            ACCOUNT_KEY,
            "EURUSD",
        ))
        .expect("the drawings load");
    assert_eq!(restored.len(), 1);
    assert_eq!(
        restored[0].timeframe_visibility,
        TimeframeVisibility::default()
    );
}

#[test]
fn a_drawing_of_the_version_before_the_charts_moves_to_the_seeded_chart() {
    let directory = TestDirectory::new();
    let path = directory.path().join(chart_database::DATABASE_FILE_NAME);
    {
        let database = chart_database::open_at_version(&path, BEFORE_CHART_SETTINGS_VERSION)
            .expect("the database opens with the earlier migrations");
        insert_legacy_drawing(&database, "profile-1", "{}");
        insert_point(&database, "profile-1", 0, 1_700_000_000_000);
        insert_point(&database, "profile-1", 1, 1_700_000_900_000);
        insert_time_zone(&database, "America/New_York");
    }

    let migrated =
        open_chart_database(Some(directory.path().to_path_buf())).expect("the database migrates");
    let store = SqliteChartDrawingStore::from_database(Arc::clone(&migrated));

    let restored = store
        .load(&scope_of(
            &seeded_chart_id(&migrated),
            ACCOUNT_KEY,
            "EURUSD",
        ))
        .expect("the drawings load");

    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, "profile-1");
    assert_eq!(
        restored[0].points,
        [time_point(1_700_000_000_000), time_point(1_700_000_900_000)]
    );
    assert!(!chart_time_zone_table_exists(&migrated));
}

#[test]
fn a_drawing_saved_before_the_settings_column_keeps_its_settings() {
    let directory = TestDirectory::new();
    let path = directory.path().join(chart_database::DATABASE_FILE_NAME);
    {
        let database = chart_database::open_at_version(&path, BEFORE_DRAWING_SETTINGS_VERSION)
            .expect("the database opens with the earlier migrations");
        let chart_id = seeded_chart_id(&database);
        insert_drawing_before_settings_column(&database, &chart_id, "profile-1", r#"{"rows":128}"#);
        insert_point(&database, "profile-1", 0, 1_700_000_000_000);
        insert_point(&database, "profile-1", 1, 1_700_000_900_000);
    }

    let migrated =
        open_chart_database(Some(directory.path().to_path_buf())).expect("the database migrates");
    let store = SqliteChartDrawingStore::from_database(Arc::clone(&migrated));

    let restored = store
        .load(&scope_of(
            &seeded_chart_id(&migrated),
            ACCOUNT_KEY,
            "EURUSD",
        ))
        .expect("the drawings load");

    assert_eq!(restored.len(), 1);
    assert_eq!(
        restored[0].settings,
        BTreeMap::from([("rows".to_owned(), json!(128))])
    );
}

#[test]
fn a_machine_without_an_app_data_folder_fails_every_call() {
    let store = ChartDrawingsState::from_database(open_chart_database(None)).store();
    let eurusd = scope_of("chart-1", ACCOUNT_KEY, "EURUSD");

    assert!(store.load(&eurusd).is_err());
    assert!(store.save(&eurusd, &[record("profile-1")]).is_err());
}
