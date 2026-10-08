//! Optional MT5 process management.
//!
//! Windows launches a configured terminal directly; macOS and Linux use Wine.
//! Installation paths and startup INI files must be explicitly configured.
//! Unknown process state and an active bridge session always suppress startup.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{env, ffi::OsStr};

use serde::{Deserialize, Serialize};

/// Resolve Wine from PATH unless the user supplies `MT5_WINE_BINARY`.
const DEFAULT_WINE_BINARY: &str = "wine";
/// Process pattern matched against full command lines for detection and stop.
const TERMINAL_PROCESS_PATTERN: &str = "terminal64.exe";
/// Background console helpers must not create windows alongside the GUI app.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
/// `O_EXCL` spawn lock in the Wine prefix or Windows app data; held through spawn and
/// removed on every normal exit path.
const SPAWN_LOCK_FILE: &str = ".mt5-backend-spawn.lock";
/// A lock older than this is considered abandoned by a crashed process and
/// may be stolen (spawn itself takes milliseconds; nothing legitimate holds
/// the lock this long).
const SPAWN_LOCK_STALE_SECS: u64 = 300;

/// Explicit installation settings; Wine fields are ignored on Windows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mt5BackendConfig {
    pub wine_prefix: PathBuf,
    pub wine_binary: PathBuf,
    pub terminal_exe_windows: String,
    /// Windows path of the ini passed as `/config:<path>`; `None` starts the
    /// terminal without a config argument.
    pub config_ini_windows: Option<String>,
    /// Auto-start flag: ON by default, `MT5_BACKEND_ENABLED=0|false|no|off`
    /// opts out.
    pub enabled: bool,
}

impl Mt5BackendConfig {
    /// Reads explicit installation settings from the process environment.
    pub fn from_env() -> Self {
        Self::resolve(|key| std::env::var(key).ok())
    }

    #[cfg(test)]
    pub fn from_env_with<F>(get: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        Self::resolve(get)
    }

    fn resolve<F>(get: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        let non_empty = |key: &str| {
            get(key)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let wine_prefix = non_empty("MT5_WINE_PREFIX").map_or_else(PathBuf::new, PathBuf::from);
        let wine_binary = non_empty("MT5_WINE_BINARY")
            .map_or_else(|| PathBuf::from(DEFAULT_WINE_BINARY), PathBuf::from);
        let terminal_exe_windows = non_empty("MT5_TERMINAL_EXE").unwrap_or_default();
        // Never discover an INI from CWD or the build machine's source tree.
        let config_ini_windows = non_empty("MT5_BACKEND_INI");
        let enabled = get("MT5_BACKEND_ENABLED")
            .map(|value| {
                !matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "0" | "false" | "no" | "off"
                )
            })
            .unwrap_or(true);
        Self {
            wine_prefix,
            wine_binary,
            terminal_exe_windows,
            config_ini_windows,
            enabled,
        }
    }
}

/// Health/control status of the MT5 backend process (distinct from the
/// bridge connection state in `BridgeStatus`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Mt5BackendStatus {
    pub running: bool,
    pub configured: bool,
    pub auto_start_enabled: bool,
}

/// Optional startup arguments, shared by native Windows and Wine launches.
fn terminal_args(config: &Mt5BackendConfig) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(ini) = &config.config_ini_windows {
        args.push(format!("/config:{ini}"));
    }
    args
}

/// Environment variables for the Wine invocation. Pure helper for tests.
fn terminal_env(config: &Mt5BackendConfig) -> Vec<(String, String)> {
    if cfg!(windows) {
        Vec::new()
    } else {
        vec![(
            "WINEPREFIX".to_string(),
            config.wine_prefix.to_string_lossy().into_owned(),
        )]
    }
}

/// Tri-state process inspection feeding the spawn gates: only
/// [`ProcessCheck::NotRunning`] may lead to a spawn — a failed inspection
/// (missing `pgrep`, permissions, unexpected exit status) is `Unknown` and
/// biases the caller away from spawning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessCheck {
    Running,
    NotRunning,
    Unknown,
}

/// Detects a running `terminal64.exe` for the read-only status/stop paths
/// (`Unknown` collapses to `false`, preserving their historical semantics).
pub fn is_terminal_running() -> bool {
    matches!(inspect_terminal(), ProcessCheck::Running)
}

/// Uses PowerShell `Get-Process` on Windows and `pgrep` from PATH on Unix. Failed
/// inspection always returns `Unknown`.
fn inspect_terminal() -> ProcessCheck {
    inspect_terminal_with(|| {
        #[cfg(windows)]
        {
            // Exit codes avoid localized tasklist output and code-page decoding.
            let output = Command::new("powershell.exe")
                .creation_flags(CREATE_NO_WINDOW)
                .args([
                    "-NoProfile", "-NonInteractive", "-Command",
                    "$ErrorActionPreference = 'Stop'; try { if (Get-Process | Where-Object { $_.ProcessName -eq 'terminal64' }) { exit 0 }; exit 1 } catch { exit 2 }",
                ])
                .output()?;
            Ok(process_check_from_exit_code(output.status.code()))
        }
        #[cfg(not(windows))]
        {
            let output = Command::new("pgrep")
                .arg("-f")
                .arg(TERMINAL_PROCESS_PATTERN)
                .output()?;
            Ok(process_check_from_exit_code(output.status.code()))
        }
    })
}

fn process_check_from_exit_code(code: Option<i32>) -> ProcessCheck {
    match code {
        Some(0) => ProcessCheck::Running,
        Some(1) => ProcessCheck::NotRunning,
        _ => ProcessCheck::Unknown,
    }
}

/// Runner-injected core of [`inspect_terminal`] so tests can fake the
/// process check without spawning anything; an inspection error degrades to
/// `Unknown` — never to `NotRunning`.
fn inspect_terminal_with<F>(run: F) -> ProcessCheck
where
    F: FnOnce() -> std::io::Result<ProcessCheck>,
{
    run().unwrap_or(ProcessCheck::Unknown)
}

/// Creates the lockfile exclusively (`O_EXCL|O_CREAT`, mode 0600 on unix).
fn create_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn spawn_lock_error(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        "spawn already in progress (lock held)".to_string()
    } else {
        format!("spawn lock unavailable: {error}")
    }
}

fn spawn_lock_is_stale(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    modified
        .elapsed()
        .map(|age| age.as_secs() >= SPAWN_LOCK_STALE_SECS)
        .unwrap_or(false)
}

/// Exclusive spawn guard: an `O_EXCL` file in the platform lock directory, held from
/// the pre-spawn checks until the child is spawned and removed on drop (every
/// exit path), so two racers can never both pass the spawn section. A lock
/// abandoned by a crashed process is stolen once it is older than
/// [`SPAWN_LOCK_STALE_SECS`].
#[derive(Debug)]
struct SpawnLock {
    path: PathBuf,
    file: Option<std::fs::File>,
}

impl SpawnLock {
    fn acquire(directory: &Path) -> Result<Self, String> {
        let path = directory.join(SPAWN_LOCK_FILE);
        let file = match create_exclusive(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if !spawn_lock_is_stale(&path) {
                    return Err(spawn_lock_error(&error));
                }
                let _ = std::fs::remove_file(&path);
                create_exclusive(&path).map_err(|retry| spawn_lock_error(&retry))?
            }
            Err(error) => return Err(spawn_lock_error(&error)),
        };
        Ok(Self {
            path,
            file: Some(file),
        })
    }
}

impl Drop for SpawnLock {
    fn drop(&mut self) {
        // Windows cannot unlink an open lock file.
        drop(self.file.take());
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Spawns the configured terminal natively on Windows or through Wine on Unix.
///
/// Refuses (as `Err`) when a terminal is already running, when the process
/// inspection fails, while another racer holds the spawn lock, or when the
/// wine binary / prefix is missing; never panics.
pub fn start_terminal(config: &Mt5BackendConfig) -> Result<u32, String> {
    start_terminal_with(config, inspect_terminal)
}

/// Spawn core of [`start_terminal`] with an injected running-check so the
/// guard rails are testable without real processes. The check runs twice —
/// before acquiring the [`SpawnLock`] and again while holding it — so a
/// racer that already spawned and released the lock cannot be double-started.
fn start_terminal_with<F>(config: &Mt5BackendConfig, inspect: F) -> Result<u32, String>
where
    F: Fn() -> ProcessCheck,
{
    match inspect() {
        ProcessCheck::Running => return Err("MT5 terminal is already running".to_string()),
        ProcessCheck::Unknown => return Err("cannot inspect processes; not spawning".to_string()),
        ProcessCheck::NotRunning => {}
    }
    if !is_configured(config) {
        return Err("MT5 installation is unconfigured: set MT5_TERMINAL_EXE and, on Unix, a valid wine binary and wine prefix".to_string());
    }
    #[cfg(windows)]
    let lock_directory = {
        let directory = crate::execution_journal::app_data_dir()
            .ok_or_else(|| "MT5 spawn lock needs an application data directory".to_string())?;
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("MT5 spawn lock directory unavailable: {error}"))?;
        directory
    };
    #[cfg(not(windows))]
    let lock_directory = config.wine_prefix.clone();
    let _lock = SpawnLock::acquire(&lock_directory)?;
    match inspect() {
        ProcessCheck::Running => return Err("MT5 terminal is already running".to_string()),
        ProcessCheck::Unknown => return Err("cannot inspect processes; not spawning".to_string()),
        ProcessCheck::NotRunning => {}
    }
    #[cfg(windows)]
    let mut command = Command::new(&config.terminal_exe_windows);
    #[cfg(not(windows))]
    let mut command = {
        let binary = resolve_wine_binary(&config.wine_binary)
            .ok_or_else(|| "MT5 wine binary is unavailable".to_string())?;
        let mut command = Command::new(binary);
        command.arg(&config.terminal_exe_windows);
        command
    };
    for (key, value) in terminal_env(config) {
        command.env(key, value);
    }
    let child = command
        .args(terminal_args(config))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to start MT5 terminal: {error}"))?;
    Ok(child.id())
}

/// Point-in-time backend status for the status command.
pub fn status(config: &Mt5BackendConfig) -> Mt5BackendStatus {
    status_with(config, is_terminal_running())
}

/// Status core with an injected running flag so the shape is testable.
fn status_with(config: &Mt5BackendConfig, running: bool) -> Mt5BackendStatus {
    Mt5BackendStatus {
        running,
        configured: is_configured(config),
        auto_start_enabled: config.enabled,
    }
}

/// A native executable on Windows, or an explicit Wine installation on Unix.
fn is_configured(config: &Mt5BackendConfig) -> bool {
    is_configured_with_path(config, env::var_os("PATH").as_deref())
}

fn is_configured_with_path(config: &Mt5BackendConfig, search_path: Option<&OsStr>) -> bool {
    if config.terminal_exe_windows.is_empty() {
        return false;
    }
    if cfg!(windows) {
        Path::new(&config.terminal_exe_windows).is_absolute()
            && Path::new(&config.terminal_exe_windows).is_file()
    } else {
        resolve_wine_binary_with_path(&config.wine_binary, search_path).is_some()
            && config.wine_prefix.is_absolute()
            && config.wine_prefix.is_dir()
    }
}

#[cfg(not(windows))]
fn resolve_wine_binary(binary: &Path) -> Option<PathBuf> {
    resolve_wine_binary_with_path(binary, env::var_os("PATH").as_deref())
}

/// Resolve a bare executable name using the supplied PATH. Explicit paths,
/// including relative paths containing separators, retain Command's CWD
/// semantics and are checked directly.
fn resolve_wine_binary_with_path(binary: &Path, search_path: Option<&OsStr>) -> Option<PathBuf> {
    let is_bare_name = binary.file_name() == Some(binary.as_os_str()) && !binary.is_absolute();
    if !is_bare_name {
        return binary.is_file().then(|| binary.to_path_buf());
    }
    env::split_paths(search_path?)
        .map(|directory| directory.join(binary))
        .find(|candidate| candidate.is_file())
}

/// What the startup hook will do, resolved from injected facts (pure, unit
/// tested): active bridge session first, then the process inspection —
/// `Unknown` never reaches a spawn — then the opt-out flag, then the on-disk
/// configuration, then the locked spawn section.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoStartPlan {
    SessionActive,
    AlreadyRunning,
    InspectUnknown,
    Disabled,
    Unconfigured,
    Start,
}

fn auto_start_plan(
    bridge_session_active: bool,
    inspect: impl FnOnce() -> ProcessCheck,
    enabled: bool,
    configured: bool,
) -> AutoStartPlan {
    if bridge_session_active {
        return AutoStartPlan::SessionActive;
    }
    if !enabled {
        return AutoStartPlan::Disabled;
    }
    match inspect() {
        ProcessCheck::Running => AutoStartPlan::AlreadyRunning,
        // Inspection failed: unknown must never bias toward spawning.
        ProcessCheck::Unknown => AutoStartPlan::InspectUnknown,
        ProcessCheck::NotRunning if !configured => AutoStartPlan::Unconfigured,
        ProcessCheck::NotRunning => AutoStartPlan::Start,
    }
}

/// Tauri-managed backend state; holds the resolved config and exposes the
/// health/control operations behind the `mt5_backend` commands.
#[derive(Debug, Clone)]
pub struct Mt5BackendState {
    config: Mt5BackendConfig,
}

impl Mt5BackendState {
    pub fn from_env() -> Self {
        Self {
            config: Mt5BackendConfig::from_env(),
        }
    }

    pub fn status(&self) -> Mt5BackendStatus {
        status(&self.config)
    }

    /// Manual control op: allowed regardless of the auto-start flag; refuses
    /// to double-start an already-running terminal.
    pub fn start(&self) -> Result<Mt5BackendStatus, String> {
        start_terminal(&self.config)?;
        Ok(self.status())
    }

    /// Manual control op: uses `taskkill` on Windows, `pkill` on Unix; stopping an
    /// already-stopped backend is a no-op success.
    pub fn stop(&self) -> Result<Mt5BackendStatus, String> {
        if !is_terminal_running() {
            return Ok(self.status());
        }
        #[cfg(windows)]
        let output = Command::new("taskkill")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/IM", TERMINAL_PROCESS_PATTERN])
            .output();
        #[cfg(not(windows))]
        let output = Command::new("pkill")
            .args(["-f", TERMINAL_PROCESS_PATTERN])
            .output();
        let output = output.map_err(|error| format!("failed to stop MT5 terminal: {error}"))?;
        if !output.status.success() && is_terminal_running() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("failed to stop MT5 terminal: {}", stderr.trim()));
        }
        Ok(self.status())
    }

    /// Best-effort boot hook run once at app startup: ensures the terminal
    /// runs unless a bridge session is already active, a `terminal64.exe` is
    /// already on the machine, auto-start is opted out, or the install paths
    /// are unconfigured. Every outcome is logged with the `[mt5-backend]`
    /// prefix (`started`, `already running`, `skipped (…)`, `failed: …`) to
    /// stderr — the app has no logging framework, and `tauri dev` captures
    /// stderr — and no outcome ever panics the app. Idempotent: a second call
    /// observes the running terminal and reports `already running`.
    pub fn auto_start_best_effort(&self, bridge_session_active: bool) {
        let plan = auto_start_plan(
            bridge_session_active,
            inspect_terminal,
            self.config.enabled,
            is_configured(&self.config),
        );
        let line = match plan {
            AutoStartPlan::SessionActive => "skipped (bridge session active)".to_string(),
            AutoStartPlan::AlreadyRunning => "already running".to_string(),
            AutoStartPlan::InspectUnknown => "skipped (cannot inspect processes)".to_string(),
            AutoStartPlan::Disabled => "skipped (disabled by MT5_BACKEND_ENABLED)".to_string(),
            AutoStartPlan::Unconfigured => "skipped (unconfigured installation)".to_string(),
            AutoStartPlan::Start => match start_terminal(&self.config) {
                Ok(pid) => {
                    eprintln!("[mt5-backend] auto-start: started (pid {pid})");
                    return;
                }
                // Spec log vocabulary: a held lock or a failed inspection is
                // a skip, not a failure.
                Err(error) if error.starts_with("spawn already in progress") => {
                    "skipped (spawn already in progress)".to_string()
                }
                Err(error) if error.starts_with("cannot inspect processes") => {
                    "skipped (cannot inspect processes)".to_string()
                }
                Err(error) => format!("failed: {error}"),
            },
        };
        eprintln!("[mt5-backend] auto-start: {line}");
    }
}

#[cfg(test)]
mod tests;
