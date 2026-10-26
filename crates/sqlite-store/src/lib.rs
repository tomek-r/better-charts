//! One local SQLite file per store: header and integrity checks before any write, WAL,
//! forward-only migrations with a pre-migration copy, owner-only files and an exclusive
//! lock against a second app instance.

mod connection;
mod database;
mod error;
mod file;
mod schema;
mod snapshot;
#[cfg(test)]
mod tests;

pub use database::SqliteDatabase;
pub use error::{Fault, Outcome, StoreError};
pub use file::write_new_file_atomically;
pub use rusqlite;
pub use schema::{latest_version, Migration};
