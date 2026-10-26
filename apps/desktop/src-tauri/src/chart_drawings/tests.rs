//! The SQLite store behind the two commands: what it keeps per account and symbol, what it
//! refuses, and what a row this build cannot trust reports.

use super::{
    record::{ChartDrawingPoint, ChartDrawingRecord, MAX_POINTS_PER_DRAWING},
    sqlite_drawing_store::SqliteChartDrawingStore,
    store::{ChartDrawingStore, DrawingScope, MAX_DRAWINGS_PER_SCOPE},
    ChartDrawingsState,
};
use serde_json::json;
use sqlite_store::rusqlite::params;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

/// The account the stub's bridge reports, spelled the way the frontend scopes it.
const ACCOUNT_KEY: &str = "50123456@Broker-Demo";
const OTHER_ACCOUNT_KEY: &str = "70001234@Broker-Live";
const DATABASE_FILE_NAME: &str = "better-charts.sqlite3";
/// Milliseconds of one five-minute bar, the slot width the test bar series uses.
const BAR_MS: i64 = 300_000;

/// A store of its own in memory: the tests never touch the user's drawings database.
fn store() -> SqliteChartDrawingStore {
    SqliteChartDrawingStore::in_memory().expect("the in-memory database opens")
}

fn scope(account_key: &str, symbol: &str) -> DrawingScope {
    DrawingScope::new(account_key.to_owned(), symbol.to_owned()).expect("the scope is valid")
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
        inputs: BTreeMap::from([("rows".to_owned(), json!(128))]),
        points: vec![time_point(1_700_000_000_000), time_point(1_700_000_900_000)],
    }
}

/// Saves one scope's drawings, failing the test when the store refuses them.
fn save(
    store: &SqliteChartDrawingStore,
    account_key: &str,
    symbol: &str,
    records: &[ChartDrawingRecord],
) {
    store
        .save(&scope(account_key, symbol), records)
        .expect("the drawings save");
}

/// Everything one scope holds, as the store loads it.
fn loaded(
    store: &SqliteChartDrawingStore,
    account_key: &str,
    symbol: &str,
) -> Vec<ChartDrawingRecord> {
    store
        .load(&scope(account_key, symbol))
        .expect("the drawings load")
}

/// The ids one scope holds, in paint order.
fn ids(store: &SqliteChartDrawingStore, account_key: &str, symbol: &str) -> Vec<String> {
    loaded(store, account_key, symbol)
        .into_iter()
        .map(|record| record.id)
        .collect()
}

/// Writes one drawing row by hand, so the store reads a row this build never wrote.
fn insert_drawing(store: &SqliteChartDrawingStore, id: &str, inputs: &str) {
    store
        .database()
        .write(|connection| {
            connection.execute(
                "INSERT INTO chart_drawings \
                 (drawing_id, account_key, symbol, position, tool_id, is_locked, is_visible, inputs) \
                 VALUES (?1, ?2, 'EURUSD', 0, 'fixedRangeProfile', 0, 1, ?3)",
                params![id, ACCOUNT_KEY, inputs],
            )?;
            Ok(())
        })
        .expect("the hand-written row is stored");
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
    let store = store();
    let saved = ChartDrawingRecord {
        locked: true,
        visible: false,
        inputs: BTreeMap::from([
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

    save(&store, ACCOUNT_KEY, "EURUSD", std::slice::from_ref(&saved));

    assert_eq!(loaded(&store, ACCOUNT_KEY, "EURUSD"), [saved]);
}

#[test]
fn two_scopes_never_see_each_other() {
    let store = store();
    save(&store, ACCOUNT_KEY, "EURUSD", &[record("eurusd-1")]);
    save(&store, ACCOUNT_KEY, "NAS100", &[record("nas100-1")]);
    save(&store, OTHER_ACCOUNT_KEY, "EURUSD", &[record("other-1")]);

    assert_eq!(ids(&store, ACCOUNT_KEY, "EURUSD"), ["eurusd-1"]);
    assert_eq!(ids(&store, ACCOUNT_KEY, "NAS100"), ["nas100-1"]);
    assert_eq!(ids(&store, OTHER_ACCOUNT_KEY, "EURUSD"), ["other-1"]);
    assert!(loaded(&store, OTHER_ACCOUNT_KEY, "NAS100").is_empty());
}

#[test]
fn an_empty_list_removes_the_drawings_of_the_scope() {
    let store = store();
    save(&store, ACCOUNT_KEY, "EURUSD", &[record("profile-1")]);

    save(&store, ACCOUNT_KEY, "EURUSD", &[]);
    // A scope that already holds nothing is the state the caller asked for.
    save(&store, ACCOUNT_KEY, "EURUSD", &[]);

    assert!(loaded(&store, ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn the_drawings_keep_their_position_and_their_points_keep_their_order() {
    let store = store();
    let first = record("profile-1");
    let mut second = record("profile-2");
    second.points = (0..5)
        .map(|index| time_point(1_700_000_000_000 + index * BAR_MS))
        .collect();

    save(&store, ACCOUNT_KEY, "EURUSD", &[first, second.clone()]);

    assert_eq!(
        ids(&store, ACCOUNT_KEY, "EURUSD"),
        ["profile-1", "profile-2"]
    );
    assert_eq!(
        loaded(&store, ACCOUNT_KEY, "EURUSD")[1].points,
        second.points
    );
}

#[test]
fn a_scope_needs_a_present_and_bounded_account_and_symbol() {
    assert!(DrawingScope::new(String::new(), "EURUSD".to_owned()).is_err());
    assert!(DrawingScope::new("a".repeat(257), "EURUSD".to_owned()).is_err());
    assert!(DrawingScope::new(ACCOUNT_KEY.to_owned(), String::new()).is_err());
    assert!(DrawingScope::new(ACCOUNT_KEY.to_owned(), "S".repeat(65)).is_err());
    assert!(DrawingScope::new(ACCOUNT_KEY.to_owned(), "EURUSD".to_owned()).is_ok());
}

#[test]
fn a_list_above_the_limit_is_refused_and_writes_nothing() {
    let store = store();
    let records: Vec<ChartDrawingRecord> = (0..=MAX_DRAWINGS_PER_SCOPE)
        .map(|index| record(&format!("profile-{index}")))
        .collect();

    let refused = store.save(&scope(ACCOUNT_KEY, "EURUSD"), &records);

    let message = refused.expect_err("the list is refused").to_string();
    assert!(message.contains("at most"), "{message}");
    assert!(loaded(&store, ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_point_without_a_time_or_a_price_is_refused_and_writes_nothing() {
    let store = store();
    let mut anchored = record("profile-1");
    anchored.points = vec![ChartDrawingPoint {
        time_ms: None,
        price: None,
    }];

    assert!(store
        .save(&scope(ACCOUNT_KEY, "EURUSD"), &[anchored])
        .is_err());
    assert!(loaded(&store, ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_price_in_exponent_form_is_refused_and_writes_nothing() {
    let store = store();
    let mut exponent = record("profile-1");
    exponent.points = vec![priced_point("1e5")];

    let refused = store.save(&scope(ACCOUNT_KEY, "EURUSD"), &[exponent]);

    let message = refused.expect_err("the price is refused").to_string();
    assert!(message.contains("decimal"), "{message}");
    assert!(loaded(&store, ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn a_list_with_too_many_points_is_refused_and_writes_nothing() {
    let store = store();
    let mut crowded = record("profile-1");
    crowded.points = (0..=MAX_POINTS_PER_DRAWING)
        .map(|_| time_point(1_700_000_000_000))
        .collect();

    assert!(store
        .save(&scope(ACCOUNT_KEY, "EURUSD"), &[crowded])
        .is_err());
    assert!(loaded(&store, ACCOUNT_KEY, "EURUSD").is_empty());
}

#[test]
fn an_inputs_column_that_is_not_json_fails_the_load() {
    let store = store();
    insert_drawing(&store, "corrupt", "not json");

    assert!(store.load(&scope(ACCOUNT_KEY, "EURUSD")).is_err());
}

#[test]
fn a_drawing_without_points_fails_the_load() {
    let store = store();
    insert_drawing(&store, "pointless", "{}");

    assert!(store.load(&scope(ACCOUNT_KEY, "EURUSD")).is_err());
}

#[test]
fn the_drawings_of_a_database_file_survive_a_reopen() {
    let directory = TestDirectory::new();
    let path = directory.path().join(DATABASE_FILE_NAME);
    {
        let store = SqliteChartDrawingStore::open(&path).expect("the database opens");
        save(&store, ACCOUNT_KEY, "EURUSD", &[record("profile-1")]);
    }

    let reopened = SqliteChartDrawingStore::open(&path).expect("the database opens again");

    assert_eq!(ids(&reopened, ACCOUNT_KEY, "EURUSD"), ["profile-1"]);
}

#[test]
fn a_machine_without_an_app_data_folder_fails_every_call() {
    let store = ChartDrawingsState::open(None).store();
    let eurusd = scope(ACCOUNT_KEY, "EURUSD");

    assert!(store.load(&eurusd).is_err());
    assert!(store.save(&eurusd, &[record("profile-1")]).is_err());
}
