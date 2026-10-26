//! Owner-only files and directories, atomic file creation and the exclusive
//! lock that keeps a second app instance away from the database.

use super::error::StoreError;
use fs2::FileExt;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

#[cfg(unix)]
const PRIVATE_FILE_MODE: u32 = 0o600;
#[cfg(unix)]
const PRIVATE_DIRECTORY_MODE: u32 = 0o700;

static TEMPORARY_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Holds the advisory lock for as long as it lives.
#[derive(Debug)]
pub(crate) struct ExclusiveLock {
    _file: fs::File,
}

pub(crate) fn create_private_directory(path: &Path) -> Result<(), StoreError> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(PRIVATE_DIRECTORY_MODE);
    }
    builder
        .create(path)
        .map_err(|_| StoreError::DirectoryUnavailable)
}

/// Creates the folder that will hold `file`, if it names one.
pub(crate) fn create_parent_directory(file: &Path) -> Result<(), StoreError> {
    match file
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        Some(parent) => create_private_directory(parent),
        None => Ok(()),
    }
}

fn private_file_options() -> fs::OpenOptions {
    let mut options = fs::OpenOptions::new();
    options.write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(PRIVATE_FILE_MODE);
    }
    options
}

/// Creates the file empty when it does not exist; an existing file is left
/// exactly as it is (never truncated).
pub(crate) fn create_private_file_if_missing(path: &Path) -> io::Result<()> {
    private_file_options()
        .create(true)
        .truncate(false)
        .open(path)
        .map(drop)
}

/// Creates a new private file; fails when it already exists.
pub(crate) fn create_new_private_file(path: &Path) -> io::Result<fs::File> {
    private_file_options().create_new(true).open(path)
}

/// Writes `contents` to a private temporary file next to `target`, flushes it,
/// then renames it to `target`. A crash never leaves a half-written file under
/// the real name. An existing `target` is left untouched.
pub fn write_new_file_atomically(target: &Path, contents: &[u8]) -> io::Result<()> {
    if target.exists() {
        return Ok(());
    }
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let temporary = parent.join(format!(
        ".{}-{}.tmp",
        std::process::id(),
        TEMPORARY_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = create_new_private_file(&temporary).and_then(|mut file| {
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, target)
    });
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Lock file next to the database: `store.sqlite3` -> `store.sqlite3.lock`.
pub(crate) fn lock_path(database: &Path) -> PathBuf {
    appended_suffix(database, ".lock")
}

pub(crate) fn appended_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Fails with `Locked` when another holder has the lock; never waits.
pub(crate) fn acquire_exclusive_lock(database: &Path) -> Result<ExclusiveLock, StoreError> {
    let path = lock_path(database);
    create_private_file_if_missing(&path).map_err(|_| StoreError::DirectoryUnavailable)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|_| StoreError::Unreadable)?;
    match file.try_lock_exclusive() {
        Ok(()) => Ok(ExclusiveLock { _file: file }),
        Err(error) if error.kind() == fs2::lock_contended_error().kind() => Err(StoreError::Locked),
        Err(_) => Err(StoreError::Unreadable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_lock_on_the_same_database_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("store.sqlite3");
        let first = acquire_exclusive_lock(&database).unwrap();
        assert_eq!(
            acquire_exclusive_lock(&database).unwrap_err(),
            StoreError::Locked
        );
        drop(first);
        assert!(acquire_exclusive_lock(&database).is_ok());
    }

    #[test]
    fn atomic_write_keeps_an_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("image.png");
        write_new_file_atomically(&target, b"first").unwrap();
        write_new_file_atomically(&target, b"second").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first");
        let leftovers = fs::read_dir(directory.path()).unwrap().count();
        assert_eq!(leftovers, 1, "no temporary file remains");
    }

    #[cfg(unix)]
    #[test]
    fn private_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("store.sqlite3");
        create_private_file_if_missing(&path).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, PRIVATE_FILE_MODE);
    }
}
