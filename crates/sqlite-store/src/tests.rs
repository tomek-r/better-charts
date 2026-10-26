//! Opening, migrating and writing one database file: what a new file starts with, what a
//! file of another application gets, and what a refused write leaves behind.

use super::{
    error::{Outcome, StoreError},
    schema::Migration,
    SqliteDatabase,
};
use rusqlite::{Connection, Transaction};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// The identity of the databases these tests create; a store picks its own.
const APPLICATION_ID: i32 = 0x5445_5354;
const OTHER_APPLICATION_ID: i32 = 0x4f54_4845;
const DATABASE_NAME: &str = "store.sqlite3";

macro_rules! table_migration {
    ($apply:ident, $sql:literal) => {
        fn $apply(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
            transaction.execute_batch($sql)
        }
    };
}

table_migration!(
    create_first_table,
    "CREATE TABLE first (id TEXT PRIMARY KEY)"
);
table_migration!(
    create_second_table,
    "CREATE TABLE second (id TEXT PRIMARY KEY)"
);
table_migration!(
    create_third_table,
    "CREATE TABLE third (id TEXT PRIMARY KEY)"
);
table_migration!(
    create_fourth_table,
    "CREATE TABLE fourth (id TEXT PRIMARY KEY)"
);

const STEP_ONE: Migration = Migration {
    target_version: 1,
    apply: create_first_table,
};
const STEP_TWO: Migration = Migration {
    target_version: 2,
    apply: create_second_table,
};
const STEP_THREE: Migration = Migration {
    target_version: 3,
    apply: create_third_table,
};
const STEP_FOUR: Migration = Migration {
    target_version: 4,
    apply: create_fourth_table,
};

/// Every migration up to `version`, applied in order.
fn migrations(version: u32) -> Vec<Migration> {
    [STEP_ONE, STEP_TWO, STEP_THREE, STEP_FOUR]
        .into_iter()
        .filter(|migration| migration.target_version <= version)
        .collect()
}

fn database_path(directory: &tempfile::TempDir) -> PathBuf {
    directory.path().join(DATABASE_NAME)
}

fn open(path: &Path, application_id: i32, version: u32) -> Result<SqliteDatabase, StoreError> {
    SqliteDatabase::open(path, application_id, &migrations(version))
}

#[test]
fn a_new_file_carries_the_application_id_and_the_last_version() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let database = open(&database_path(&directory), APPLICATION_ID, 2).expect("the file opens");

    let (application_id, version) = database
        .read(|connection| {
            let application_id: i64 =
                connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
            let version: i64 =
                connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
            Ok((application_id, version))
        })
        .expect("the header is readable");

    assert_eq!(application_id, i64::from(APPLICATION_ID));
    assert_eq!(version, 2);
}

#[test]
fn reopening_an_up_to_date_file_runs_no_migration() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let path = database_path(&directory);
    drop(open(&path, APPLICATION_ID, 1).expect("the file opens"));

    // The migration creates its table without `IF NOT EXISTS`, so a second run would fail.
    assert!(open(&path, APPLICATION_ID, 1).is_ok());
}

#[test]
fn a_migration_on_an_existing_file_keeps_the_two_newest_copies() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let path = database_path(&directory);
    drop(open(&path, APPLICATION_ID, 1).expect("the file opens"));
    assert!(copy_versions(&path).is_empty(), "a new file needs no copy");

    drop(open(&path, APPLICATION_ID, 2).expect("the file migrates"));
    assert_eq!(
        copy_versions(&path),
        [1],
        "exactly one copy before the step"
    );

    drop(open(&path, APPLICATION_ID, 3).expect("the file migrates"));
    drop(open(&path, APPLICATION_ID, 4).expect("the file migrates"));
    assert_eq!(copy_versions(&path), [3, 2], "the oldest copies are pruned");
}

/// The versions of the pre-migration copies next to `database_path`, newest first.
fn copy_versions(database_path: &Path) -> Vec<u32> {
    let prefix = format!("{DATABASE_NAME}.pre-v");
    let directory = database_path.parent().expect("the file has a folder");
    let mut versions: Vec<u32> = fs::read_dir(directory)
        .expect("the folder lists")
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.strip_prefix(&prefix)?
                .strip_suffix(".bak")?
                .parse()
                .ok()
        })
        .collect();
    versions.sort_unstable_by(|left, right| right.cmp(left));
    versions
}

#[test]
fn a_file_of_another_application_is_refused_and_left_untouched() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let path = database_path(&directory);
    drop(open(&path, APPLICATION_ID, 1).expect("the file opens"));
    let before = fs::read(&path).expect("the file reads");

    let refused = open(&path, OTHER_APPLICATION_ID, 1);

    assert_eq!(refused.err(), Some(StoreError::ForeignFile));
    assert_eq!(fs::read(&path).expect("the file reads"), before);
}

#[test]
fn a_newer_schema_version_is_refused() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let path = database_path(&directory);
    drop(open(&path, APPLICATION_ID, 2).expect("the file opens"));

    let refused = open(&path, APPLICATION_ID, 1);

    assert_eq!(
        refused.err(),
        Some(StoreError::UnsupportedSchema { found: 2 })
    );
}

#[test]
fn garbage_bytes_are_refused_and_left_untouched() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let path = database_path(&directory);
    let garbage = b"this is not a database".to_vec();
    fs::write(&path, &garbage).expect("the garbage is written");

    let refused = open(&path, APPLICATION_ID, 1);

    let error = refused.err().expect("the file is refused");
    assert!(
        matches!(error, StoreError::ForeignFile | StoreError::Corrupt),
        "{error}"
    );
    assert_eq!(fs::read(&path).expect("the file reads"), garbage);
}

#[test]
fn a_second_open_of_the_same_file_is_refused() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let path = database_path(&directory);
    let first = open(&path, APPLICATION_ID, 1).expect("the file opens");

    assert_eq!(
        open(&path, APPLICATION_ID, 1).err(),
        Some(StoreError::Locked)
    );
    drop(first);
    assert!(
        open(&path, APPLICATION_ID, 1).is_ok(),
        "the lock is released"
    );
}

#[test]
fn a_failing_write_leaves_the_data_unchanged() {
    let directory = tempfile::tempdir().expect("the test folder is created");
    let database = open(&database_path(&directory), APPLICATION_ID, 1).expect("the file opens");
    database
        .write(|connection| {
            connection.execute("INSERT INTO first (id) VALUES ('kept')", [])?;
            Ok(())
        })
        .expect("the row is stored");

    let refused = database.write(insert_and_fail);

    assert_eq!(refused.err(), Some(StoreError::WriteFailed));
    assert_eq!(
        count_first_rows(&database),
        1,
        "the failed write rolled back"
    );
}

/// Inserts a row and then refuses the write, so the transaction has work to undo.
fn insert_and_fail(connection: &Connection) -> Outcome<()> {
    connection.execute("INSERT INTO first (id) VALUES ('rolled back')", [])?;
    Err(StoreError::WriteFailed.into())
}

fn count_first_rows(database: &SqliteDatabase) -> i64 {
    database
        .read(|connection| {
            let count: i64 =
                connection.query_row("SELECT count(*) FROM first", [], |row| row.get(0))?;
            Ok(count)
        })
        .expect("the rows are countable")
}
