//! Durable, append-only persistence for the broker-independent execution registry.
//! This module records intent and lifecycle evidence; it never dispatches orders.

use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use trading_core::execution::ExecutionState;
use trading_core::execution::{
    CommandStatus, ExecutionEvent, ExecutionIntent, ExecutionRegistry, ExecutionUpdate,
    RecoveryEntry,
};
use trading_core::protocol::{OrderCommandError, OrderCommandUpdate};

mod safety;
pub use safety::{ExecutionSafetyState, ExecutionSafetyStatus};

const MAX_RECORD_BYTES: usize = 64 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;

/// Bundle identifier from `tauri.conf.json`; the single source of truth for
/// the app data directory shared by the execution journal and the symbol
/// cache, so both files can never land in different directories.
const APP_BUNDLE_IDENTIFIER: &str = "com.bettercharts.desktop";

/// The app data directory for every durable state file in this crate
/// (execution journal and symbol cache). Mirrors Tauri's desktop
/// `app_data_dir()` (`dirs::data_dir()` joined with the bundle identifier);
/// returns `None` when the platform data directory cannot be resolved.
pub(crate) fn app_data_dir() -> Option<PathBuf> {
    let data_dir = if cfg!(target_os = "macos") {
        env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
        })
    } else if cfg!(target_os = "windows") {
        env::var_os("APPDATA").map(PathBuf::from)
    } else {
        env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| {
            env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
    }?;
    Some(data_dir.join(APP_BUNDLE_IDENTIFIER))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum JournalEntry {
    Register {
        intent: ExecutionIntent,
        at_ms: u64,
    },
    Transition {
        command_id: String,
        event: ExecutionEvent,
    },
    /// An EA `order_command_update` accepted by the local lifecycle rules.
    /// Replay re-applies the same transition logic, restoring command states
    /// and the per-command `at_update` watermark across restarts.
    UpdateApplied {
        update: OrderCommandUpdate,
    },
    /// An EA `order_command_error`. Errors are bound to a `command_id`, never
    /// change command state, and never tear the session; they are durable
    /// audit facts only.
    ErrorApplied {
        error: OrderCommandError,
    },
    /// Session close/replace dropped queued-not-yet-dispatched commands.
    /// Durable audit fact: replay applies no registry change, so journals
    /// written before this variant existed still open and replay. Contract:
    /// a restart or reconnect must never replay these commands as new
    /// orders, so they are recorded as dropped, never re-queued.
    QueueDropped {
        command_ids: Vec<String>,
        reason: String,
    },
}

#[allow(dead_code)] // Append API is intentionally not exposed to UI in this step.
struct JournalInner {
    file: File,
    registry: ExecutionRegistry,
    entries: usize,
    bytes: u64,
    failed: bool,
}

impl Drop for JournalInner {
    fn drop(&mut self) {
        // On Unix, a child spawned concurrently can retain the shared file
        // description until exec. Release ownership when the last journal
        // clone drops, rather than waiting for every inherited fd to close.
        let _ = FileExt::unlock(&self.file);
    }
}

/// Synchronized journal + validated in-memory view. A failed open or append is
/// surfaced to the caller; callers must keep execution disabled in that case.
#[derive(Clone)]
pub struct ExecutionJournal {
    inner: Arc<Mutex<JournalInner>>,
}

#[allow(dead_code)] // State persistence is ready; execution commands remain out of scope.
impl ExecutionJournal {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, JournalError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path)?;
        file.try_lock_exclusive().map_err(|error| {
            if error.kind() == io::ErrorKind::WouldBlock
                || error.raw_os_error() == fs2::lock_contended_error().raw_os_error()
            {
                JournalError::AlreadyOpen
            } else {
                JournalError::Io(error)
            }
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
        let metadata = file.metadata()?;
        let bytes = metadata.len();
        if bytes > MAX_FILE_BYTES {
            return Err(JournalError::FileTooLarge(bytes));
        }

        let mut registry = ExecutionRegistry::new();
        let mut entries = 0usize;
        // Windows byte-range locks deny reads through a second handle,
        // including a duplicate. Replay through the handle owning the lock.
        let reader = &mut file;
        reader.rewind()?;
        let mut consumed = 0u64;
        loop {
            let mut header = [0u8; 4];
            let read = read_header(reader, &mut header)?;
            if read == 0 {
                break;
            }
            if read != header.len() {
                return Err(JournalError::Truncated);
            }
            let length = u32::from_be_bytes(header) as usize;
            if length == 0 || length > MAX_RECORD_BYTES {
                return Err(JournalError::InvalidRecordLength(length));
            }
            consumed = consumed
                .checked_add(4 + length as u64)
                .ok_or(JournalError::FileTooLarge(u64::MAX))?;
            if consumed > MAX_FILE_BYTES || consumed > bytes {
                return Err(JournalError::Truncated);
            }
            let mut payload = vec![0; length];
            reader.read_exact(&mut payload).map_err(|e| {
                if e.kind() == io::ErrorKind::UnexpectedEof {
                    JournalError::Truncated
                } else {
                    JournalError::Io(e)
                }
            })?;
            entries += 1;
            if entries > MAX_ENTRIES {
                return Err(JournalError::TooManyEntries);
            }
            let entry: JournalEntry = serde_json::from_slice(&payload)?;
            apply_entry(&mut registry, entry)?;
        }
        if consumed != bytes {
            return Err(JournalError::Truncated);
        }
        file.seek(SeekFrom::End(0))?;
        Ok(Self {
            inner: Arc::new(Mutex::new(JournalInner {
                file,
                registry,
                entries,
                bytes,
                failed: false,
            })),
        })
    }

    /// Applies one EA `order_command_update` durably by delegating to
    /// trading-core's [`ExecutionRegistry::apply_update`]. Returns `Ok(false)`
    /// for a stale `at_update` (already-seen or non-increasing counter),
    /// which is ignored without writing bytes. Invalid payloads, unknown
    /// commands, and illegal lifecycle transitions return `Err` before any
    /// byte is written; the caller must keep the session alive and must not
    /// treat that as a fatal bridge error. The per-command `at_update`
    /// watermark lives inside the registry record, so replay restores it.
    pub fn apply_command_update(&self, update: OrderCommandUpdate) -> Result<bool, JournalError> {
        let mut inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        update.validate().map_err(JournalError::WireRejected)?;
        let (command_id, wire, at_update) = execution_update(&update)?;
        let mut candidate = inner.registry.clone();
        match candidate.apply_update(&command_id, wire, at_update) {
            Ok(None) => return Ok(false),
            Ok(Some(_)) => {}
            Err(error) => return Err(JournalError::Execution(error)),
        }
        self.append_applied(
            &mut inner,
            JournalEntry::UpdateApplied { update },
            candidate,
        )?;
        Ok(true)
    }

    /// Durably records one EA `order_command_error`. Errors never change the
    /// command lifecycle state and are idempotent only in the sense that each
    /// arrival is its own audit record.
    pub fn apply_command_error(&self, error: OrderCommandError) -> Result<(), JournalError> {
        let mut inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        error.validate().map_err(JournalError::WireRejected)?;
        self.append(&mut inner, JournalEntry::ErrorApplied { error })
    }

    /// Durably records one `QueueDropped` audit event: the command ids a
    /// session close/replace dropped from the pending queue and why. Replay
    /// never changes registry state — these commands are gone by design and
    /// must not be dispatched after a reconnect.
    pub fn record_queue_dropped(
        &self,
        command_ids: Vec<String>,
        reason: String,
    ) -> Result<(), JournalError> {
        let mut inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        if command_ids.is_empty() {
            return Ok(());
        }
        self.append(
            &mut inner,
            JournalEntry::QueueDropped {
                command_ids,
                reason,
            },
        )
    }

    /// Account binding of the registered intent behind one `command_id`, used
    /// to verify inbound command updates against the active session account
    /// (F-5). `None` when the journal cannot answer (unknown command or an
    /// unavailable journal — the caller then fails through the journal path).
    pub fn command_account(&self, command_id: &str) -> Option<(String, String)> {
        let inner = self.inner.lock().ok()?;
        if inner.failed {
            return None;
        }
        let intent = inner.registry.get(command_id)?.intent();
        Some((
            intent.account_login().to_owned(),
            intent.broker_server().to_owned(),
        ))
    }

    /// Idempotent identical registrations are accepted without adding bytes.
    pub fn register(&self, intent: ExecutionIntent, at_ms: u64) -> Result<(), JournalError> {
        let mut inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        if let Some(existing) = inner.registry.get(intent.command_id()) {
            if existing.intent() == &intent {
                return Ok(());
            }
        }
        let entry = JournalEntry::Register { intent, at_ms };
        self.append(&mut inner, entry)
    }

    /// Durably records preflight-validated intent. If a crash occurs after the
    /// Prepared append, an identical retry finishes the Validated transition.
    pub fn register_validated(
        &self,
        intent: ExecutionIntent,
        at_ms: u64,
    ) -> Result<(), JournalError> {
        let mut inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        if let Some(existing) = inner.registry.get(intent.command_id()) {
            if existing.intent() != &intent {
                return Err(JournalError::Execution(
                    trading_core::execution::ExecutionError::CommandIdConflict(
                        intent.command_id().to_owned(),
                    ),
                ));
            }
            match existing.state() {
                ExecutionState::Validated => return Ok(()),
                ExecutionState::Prepared => {
                    let entry = JournalEntry::Transition {
                        command_id: intent.command_id().to_owned(),
                        event: ExecutionEvent::new(at_ms, ExecutionState::Validated),
                    };
                    return self.append(&mut inner, entry);
                }
                _ => {
                    return Err(JournalError::Execution(
                        trading_core::execution::ExecutionError::InvalidTransition {
                            from: existing.state(),
                            to: ExecutionState::Validated,
                        },
                    ));
                }
            }
        }
        self.append(
            &mut inner,
            JournalEntry::Register {
                intent: intent.clone(),
                at_ms,
            },
        )?;
        self.append(
            &mut inner,
            JournalEntry::Transition {
                command_id: intent.command_id().to_owned(),
                event: ExecutionEvent::new(at_ms, ExecutionState::Validated),
            },
        )
    }

    pub fn transition(&self, command_id: &str, event: ExecutionEvent) -> Result<(), JournalError> {
        let mut inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        let entry = JournalEntry::Transition {
            command_id: command_id.to_owned(),
            event,
        };
        self.append(&mut inner, entry)
    }

    pub fn command_count(&self) -> Result<usize, JournalError> {
        let inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        Ok(inner.registry.len())
    }

    /// Returns a detached immutable projection of recovered entries. This
    /// method never applies journal entries or changes lifecycle state.
    pub fn recovery_snapshot(&self) -> Result<(usize, Vec<RecoveryEntry>), JournalError> {
        let inner = self.inner.lock().map_err(|_| JournalError::Poisoned)?;
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        Ok((inner.registry.len(), inner.registry.recovery_snapshot()))
    }

    fn append(&self, inner: &mut JournalInner, entry: JournalEntry) -> Result<(), JournalError> {
        let mut candidate = inner.registry.clone();
        apply_entry(&mut candidate, entry.clone())?;
        self.append_applied(inner, entry, candidate)
    }

    /// Writes one entry whose effect on the `candidate` registry has already
    /// been validated. Capacity or size failures mark the journal
    /// unavailable; nothing is written in that case and the journal fails
    /// closed.
    fn append_applied(
        &self,
        inner: &mut JournalInner,
        entry: JournalEntry,
        candidate: ExecutionRegistry,
    ) -> Result<(), JournalError> {
        if inner.failed {
            return Err(JournalError::Unavailable);
        }
        if inner.entries >= MAX_ENTRIES {
            inner.failed = true;
            return Err(JournalError::TooManyEntries);
        }
        let payload = serde_json::to_vec(&entry)?;
        if payload.is_empty() || payload.len() > MAX_RECORD_BYTES {
            inner.failed = true;
            return Err(JournalError::InvalidRecordLength(payload.len()));
        }
        let Some(next_bytes) = inner.bytes.checked_add(4 + payload.len() as u64) else {
            inner.failed = true;
            return Err(JournalError::FileTooLarge(u64::MAX));
        };
        if next_bytes > MAX_FILE_BYTES {
            inner.failed = true;
            return Err(JournalError::FileTooLarge(next_bytes));
        }
        let durable = inner
            .file
            .write_all(&(payload.len() as u32).to_be_bytes())
            .and_then(|()| inner.file.write_all(&payload))
            .and_then(|()| inner.file.flush())
            .and_then(|()| inner.file.sync_all());
        if let Err(error) = durable {
            inner.failed = true;
            return Err(JournalError::Io(error));
        }
        inner.registry = candidate;
        inner.entries += 1;
        inner.bytes = next_bytes;
        Ok(())
    }
}

fn apply_entry(registry: &mut ExecutionRegistry, entry: JournalEntry) -> Result<(), JournalError> {
    match entry {
        JournalEntry::Register { intent, at_ms } => {
            registry.register(intent, at_ms)?;
        }
        JournalEntry::Transition { command_id, event } => {
            registry.transition(&command_id, event)?;
        }
        JournalEntry::UpdateApplied { update } => {
            update.validate().map_err(JournalError::WireRejected)?;
            let (command_id, wire, at_update) = execution_update(&update)?;
            match registry.apply_update(&command_id, wire, at_update) {
                // Replay must never see a stale counter: the append-only log
                // would contradict itself, so fail closed.
                Ok(None) => return Err(JournalError::WireRejected("stale at_update")),
                Ok(Some(_)) => {}
                Err(error) => return Err(JournalError::Execution(error)),
            }
        }
        JournalEntry::ErrorApplied { error } => {
            error.validate().map_err(JournalError::WireRejected)?;
        }
        // Audit fact only: replay must not touch the registry, so journals
        // recorded by older builds (without this variant) and newer ones both
        // open and replay identically.
        JournalEntry::QueueDropped { .. } => {}
    }
    Ok(())
}

/// Converts one wire update into trading-core's
/// [`ExecutionRegistry::apply_update`] inputs: the status vocabulary, the
/// field payload without `command_id` and `at_update`, and the per-command
/// counter the registry orders and de-stales by.
fn execution_update(
    update: &OrderCommandUpdate,
) -> Result<(String, ExecutionUpdate, u64), JournalError> {
    let status: CommandStatus =
        serde_json::from_value(serde_json::Value::String(update.status.clone()))
            .map_err(|_| JournalError::WireRejected("unknown status"))?;
    Ok((
        update.command_id.clone(),
        ExecutionUpdate {
            status,
            retcode: update.retcode,
            last_error: update.last_error,
            broker_order_id: update.broker_order_id.clone(),
            deal_id: update.deal_id.clone(),
            position_id: update.position_id.clone(),
            filled_volume: update.filled_volume.clone(),
            message: update.message.clone(),
            updated_at_ms: update.updated_at_ms,
        },
        update.at_update,
    ))
}

fn read_header(reader: &mut impl Read, header: &mut [u8; 4]) -> io::Result<usize> {
    let mut count = 0;
    while count < header.len() {
        match reader.read(&mut header[count..])? {
            0 => break,
            size => count += size,
        }
    }
    Ok(count)
}

#[derive(Debug, Error)]
pub enum JournalError {
    #[error("journal I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("journal JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("execution registry rejected journal entry: {0}")]
    Execution(#[from] trading_core::execution::ExecutionError),
    #[error("journal record is truncated")]
    Truncated,
    #[error("wire execution message rejected: {0}")]
    WireRejected(&'static str),
    #[error("journal record length {0} is invalid")]
    InvalidRecordLength(usize),
    #[error("journal file is {0} bytes; maximum is 16 MiB")]
    FileTooLarge(u64),
    #[error("journal exceeds 100000 entries")]
    TooManyEntries,
    #[error("execution journal lock is poisoned")]
    Poisoned,
    #[error("execution journal already has a writer")]
    AlreadyOpen,
    #[error("execution journal is unavailable after a failed durable append")]
    Unavailable,
}

#[cfg(test)]
mod tests;
