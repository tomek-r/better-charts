//! Copy the bundled MQL5 sources into a data folder's `MQL5` tree.
//!
//! Only the two files the app ships are written, and they go where MT5 already
//! loads them: the shallowest existing copy of the same file name, so an update
//! never leaves a second copy behind, or the folder MT5 recommends when there is
//! none. An identical destination is left untouched, so a repeated install does
//! not disturb MT5's compile state; a changed one is replaced through a temporary
//! file in the same folder and a rename, so MT5 never reads a half-written source.
//!
//! Privacy: below an MT5 folder the only file this module reads is the destination
//! copy of one of our own two `.mq5` files, which the identical-content check
//! needs. Nothing else is opened; `locate` documents the same rule for
//! `origin.txt`.
//!
//! Nothing here compiles anything or talks to MT5, and nothing locks the execution
//! adapter: the queue view arrives as plain data, so the decision stays pure and
//! unit-tested. The command that resolves the sources and passes the live queue
//! arrives in a later task.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use thiserror::Error;

use super::locate::{existing_copy, Mql5File};
use crate::download_resources::{EXPERT_ADVISOR_RESOURCE, INDICATOR_RESOURCE};
use crate::execution_adapter::ExecutionQueueView;

/// Suffix of the temporary file every write goes through, so a failed write never
/// leaves a truncated source for MT5 to compile.
const TEMPORARY_SUFFIX: &str = ".install-tmp";

/// The shipped files in install order, each with the bundled resource that
/// provides its source. The indicator comes first because the expert advisor
/// loads it through `iCustom("BetterChartsTickHistoryReader")`: MT5 has to be able
/// to compile the reader before the advisor that calls it.
const INSTALL_ORDER: [(Mql5File, &str); 2] = [
    (Mql5File::Indicator, INDICATOR_RESOURCE),
    (Mql5File::ExpertAdvisor, EXPERT_ADVISOR_RESOURCE),
];

/// The real files behind the bundled resources. The caller resolves the Tauri
/// resource paths; nothing here guesses them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundledSources {
    pub expert_advisor: PathBuf,
    pub indicator: PathBuf,
}

impl BundledSources {
    /// Bundled source of `file`, so the install order can stay a plain list.
    fn source_of(&self, file: Mql5File) -> &Path {
        match file {
            Mql5File::ExpertAdvisor => &self.expert_advisor,
            Mql5File::Indicator => &self.indicator,
        }
    }
}

/// What writing one file did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallOutcome {
    /// The destination did not exist and was written.
    Installed,
    /// An existing copy had different content and was replaced in place.
    Updated,
    /// An existing copy already held the same content and was not touched.
    Unchanged,
}

/// One file the install step placed, with its destination.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledFile {
    pub file: Mql5File,
    pub path: PathBuf,
    pub outcome: InstallOutcome,
}

#[derive(Debug, Error)]
pub enum InstallError {
    /// The order guard refused the whole install; nothing was written.
    #[error("An order is being sent to MT5; install after it settles.")]
    OrderInFlight,
    #[error("the bundled MQL5 source for {file:?} is unreadable: {reason}")]
    SourceUnreadable { file: Mql5File, reason: String },
    #[error("the MQL5 file at {} cannot be written: {reason}", path.display())]
    DestinationUnwritable { path: PathBuf, reason: String },
}

/// Path of a bundled resource inside the data folder's `MQL5` folder. The
/// resource path mirrors that tree, so dropping its first segment keeps the
/// shipped file names defined once, in `download_resources`:
/// `mql5/Experts/BetterChartsBridge.mq5` becomes `Experts/BetterChartsBridge.mq5`.
fn relative_resource_path(resource: &str) -> &str {
    let Some((_mql5_folder, relative)) = resource.split_once('/') else {
        return resource;
    };
    relative
}

/// Destination of `file`: the shallowest existing copy, so an update replaces the
/// file MT5 already loads instead of adding a second one; otherwise the folder MT5
/// recommends, which [`write_atomically`] creates when missing.
fn destination_for(mql5: &Path, file: Mql5File, resource: &str) -> PathBuf {
    match existing_copy(mql5, file) {
        Some(existing) => existing,
        None => mql5.join(relative_resource_path(resource)),
    }
}

/// Bytes of a bundled source. This reads the app's own resource file, never an MT5
/// folder.
fn read_source(file: Mql5File, source: &Path) -> Result<Vec<u8>, InstallError> {
    match fs::read(source) {
        Ok(bytes) => Ok(bytes),
        Err(error) => Err(InstallError::SourceUnreadable {
            file,
            reason: error.to_string(),
        }),
    }
}

fn destination_error(path: &Path, error: io::Error) -> InstallError {
    InstallError::DestinationUnwritable {
        path: path.to_path_buf(),
        reason: error.to_string(),
    }
}

/// Content of the current destination copy, or `None` while it does not exist.
/// Reading it is allowed because it is our own `.mq5` file (see the module privacy
/// rule); a destination that cannot be read is reported instead of guessed at.
fn read_destination(destination: &Path) -> Result<Option<Vec<u8>>, InstallError> {
    match fs::read(destination) {
        Ok(existing) => Ok(Some(existing)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(destination_error(destination, error)),
    }
}

/// Temporary file beside the destination: the rename then stays inside one folder
/// and is therefore atomic.
fn temporary_path(destination: &Path) -> PathBuf {
    let mut name = destination.as_os_str().to_os_string();
    name.push(TEMPORARY_SUFFIX);
    PathBuf::from(name)
}

fn missing_folder_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "the destination has no folder")
}

fn write_new_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Writes the temporary file first and only then renames it over the destination.
fn write_then_replace(temporary: &Path, destination: &Path, bytes: &[u8]) -> io::Result<()> {
    write_new_file(temporary, bytes)?;
    fs::rename(temporary, destination)
}

/// Writes `bytes` through a temporary file and renames it over the destination, so
/// a failure leaves either the previous copy or nothing behind, never a truncated
/// file. A folder that does not exist yet is created.
///
/// Shared with `restart`, whose startup ini and preset must never be read
/// half-written by a terminal that is about to start.
pub(super) fn write_atomically(destination: &Path, bytes: &[u8]) -> io::Result<()> {
    let folder = destination.parent().ok_or_else(missing_folder_error)?;
    fs::create_dir_all(folder)?;
    let temporary = temporary_path(destination);
    let written = write_then_replace(&temporary, destination, bytes);
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

/// Writes one copy, reporting the destination instead of the bare I/O error.
fn write_destination(destination: &Path, bytes: &[u8]) -> Result<(), InstallError> {
    match write_atomically(destination, bytes) {
        Ok(()) => Ok(()),
        Err(error) => Err(destination_error(destination, error)),
    }
}

/// Writes `bytes` to `destination` unless it already holds exactly them, and
/// reports which of the three outcomes applies.
fn write_copy(destination: &Path, bytes: &[u8]) -> Result<InstallOutcome, InstallError> {
    let existing = read_destination(destination)?;
    if existing.as_deref() == Some(bytes) {
        return Ok(InstallOutcome::Unchanged);
    }
    write_destination(destination, bytes)?;
    Ok(if existing.is_some() {
        InstallOutcome::Updated
    } else {
        InstallOutcome::Installed
    })
}

/// Installs one file: read its bundled source first, so an unreadable source stops
/// the install before anything on disk changes.
fn install_one(
    file: Mql5File,
    source: &Path,
    destination: &Path,
) -> Result<InstalledFile, InstallError> {
    let bytes = read_source(file, source)?;
    let outcome = write_copy(destination, &bytes)?;
    Ok(InstalledFile {
        file,
        path: destination.to_path_buf(),
        outcome,
    })
}

/// The order guard. Recompiling an attached expert advisor makes MT5 reload it,
/// which drops the bridge session; an order in flight at that moment would have an
/// uncertain outcome, and a queued one would be handed to a session that is about
/// to disappear. So nothing is written while either exists. `restart` reuses the
/// same guard, because closing the terminal loses an order just as surely.
pub(super) fn ensure_no_order_pending(queue: &ExecutionQueueView) -> Result<(), InstallError> {
    if queue.pending > 0 || queue.in_flight.is_some() {
        return Err(InstallError::OrderInFlight);
    }
    Ok(())
}

/// Copies the bundled sources into the data folder behind `mql5` and reports where
/// each file went, indicator first.
///
/// Refuses with [`InstallError::OrderInFlight`] before the first write while an
/// order is queued or in flight. Stops at the first error; the files written
/// before it are complete, because every write is a rename into place.
pub fn install_bundled_sources(
    sources: &BundledSources,
    mql5: &Path,
    queue: &ExecutionQueueView,
) -> Result<Vec<InstalledFile>, InstallError> {
    ensure_no_order_pending(queue)?;
    let mut installed = Vec::with_capacity(INSTALL_ORDER.len());
    for &(file, resource) in &INSTALL_ORDER {
        let destination = destination_for(mql5, file, resource);
        installed.push(install_one(file, sources.source_of(file), &destination)?);
    }
    Ok(installed)
}
