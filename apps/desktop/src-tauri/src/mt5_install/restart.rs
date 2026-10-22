//! Restart the MT5 terminal with the bridge expert advisor attached.
//!
//! MT5 reads a startup configuration only when it starts, and a running terminal
//! ignores `/config:`, so attaching the advisor means closing the terminal and
//! starting it again with two files this module writes:
//!
//! * `config/BetterChartsStartup.ini` — UTF-16LE behind a byte-order mark, CRLF, one
//!   `[StartUp]` section naming the advisor and the preset. Under wine it sits below
//!   the install folder and is passed as a *relative* Windows path
//!   (`config\BetterChartsStartup.ini`) with the install folder as the working folder,
//!   because wine re-quotes an absolute path whose folders contain a space and MT5
//!   then silently ignores the option. On native Windows it sits below the data folder
//!   instead, because `C:\Program Files` is not writable for a normal user, and is
//!   passed as an absolute path. No `Symbol=`/`Period=` line, so MT5 opens its own
//!   default chart; symbol names are broker-specific.
//! * `<data folder MQL5>/Presets/BetterChartsStartup.set` — UTF-16LE behind a
//!   byte-order mark, CRLF, the three bridge inputs the advisor declares. MT5 has no
//!   `Presets` folder until it saves one, so the write creates it.
//!
//! Both files carry the bridge token, so both are deleted again: as soon as the
//! restarted terminal has a bridge session of its own, or after a timeout, and at
//! every app start for whatever an interrupted run left behind. There is one fixed
//! pair of names precisely so that cleanup can find them.
//!
//! Verified invocation on the owner's Mac (official MT5 application, Wine): working
//! folder = the install folder, program = the wine binary with `WINEPREFIX`, arguments
//! `terminal64.exe /portable /config:config\BetterChartsStartup.ini`; the standard
//! layout passes the same without `/portable`. Native Windows runs `terminal64.exe`
//! itself with the same working folder and the absolute `/config:<data folder>
//! \config\BetterChartsStartup.ini`; that form is not yet verified on a real terminal.
//!
//! Privacy and safety: nothing else below an MT5 folder is written, AutoTrading is
//! never enabled, and the token never reaches a log line or an error message. The
//! process inspection, the stop, and the launch are injected, so the whole sequence is
//! unit-tested without touching a real terminal.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use thiserror::Error;

use super::compile::relative_windows_path;
use super::discover::Mt5Installation;
use super::install::{ensure_no_order_pending, write_atomically};
use super::locate::{default_path, install_dir, DataFolder, HostPlatform, Layout, Mql5File};
use crate::bridge::connection::validate_bind_address;
use crate::execution_adapter::ExecutionQueueView;
use crate::mt5_backend::{inspect_terminal, stop_terminal, ProcessCheck};

/// Startup ini of this app. The name is ours and fixed, so the startup cleanup can
/// find a file an interrupted restart left behind.
pub(crate) const STARTUP_INI_FILE: &str = "BetterChartsStartup.ini";
/// Preset of this app, holding the bridge inputs and therefore the token.
pub(crate) const STARTUP_PRESET_FILE: &str = "BetterChartsStartup.set";
/// Folder beside the terminal executable that `/config:` paths are read from.
const CONFIG_FOLDER: &str = "config";
/// Folder below `MQL5` holding expert presets.
const PRESETS_FOLDER: &str = "Presets";
/// Folder below `MQL5` from which MT5 loads expert advisors; `Expert=` is relative to
/// it.
const EXPERTS_FOLDER: &str = "Experts";
/// Windows file name of the terminal executable.
const TERMINAL_EXE_FILE: &str = "terminal64.exe";
/// Option that makes the terminal use the `MQL5` folder beside its executable. Only
/// the portable layout passes it.
const PORTABLE_OPTION: &str = "/portable";
/// Extension of a bundled MQL5 source; `Expert=` takes the path without it.
const SOURCE_EXTENSION: &str = ".mq5";
/// Extension MT5 compiles a source to, and loads beside it.
const COMPILED_EXTENSION: &str = "ex5";
/// Environment variable that points wine at the prefix holding `drive_c`.
const WINEPREFIX_VARIABLE: &str = "WINEPREFIX";
/// Byte-order mark of the UTF-16LE files MT5 writes and reads.
const UTF16_LE_BOM: [u8; 2] = [0xff, 0xfe];
/// Line break both startup files use.
const LINE_BREAK: &str = "\r\n";

/// Why a restart did not happen, or did not finish. Every message is a sentence a
/// trader can act on; the bridge token is never part of one.
#[derive(Debug, Error)]
pub(crate) enum RestartError {
    /// The order guard refused the restart; nothing was written.
    #[error("An order is being sent to MT5; restart MT5 after it settles.")]
    OrderInFlight,
    /// An advisor without the token can only fail its handshake, which reads like a
    /// broken bridge instead of a missing setting.
    #[error("Set the bridge token in App settings first.")]
    TokenMissing,
    #[error("The bridge address {address} cannot be used ({reason}); check the bridge settings.")]
    AddressUnusable { address: String, reason: String },
    /// MT5 would start without the advisor, which then reports nothing at all.
    #[error("Install the EA first.")]
    ExpertNotInstalled,
    #[error("The installed EA sits where MT5 cannot load it: {reason}")]
    ExpertPathUnusable { reason: String },
    #[error(
        "The MT5 installation folder for {path} cannot be resolved; reload the list of \
         installations and try again."
    )]
    InstallFolderMissing { path: String },
    #[error(
        "The MT5 installation has no wine prefix or wine binary; set MT5_WINE_PREFIX and \
         MT5_WINE_BINARY, then try again."
    )]
    WineUnavailable,
    #[error("The MT5 startup file at {} cannot be written: {reason}", path.display())]
    StartupFileUnwritable { path: PathBuf, reason: String },
    #[error("MT5 could not be closed: {reason}")]
    StopFailed { reason: String },
    #[error("MT5 did not close in time; nothing was started. Close MT5 and try again.")]
    StopTimedOut,
    #[error("Whether MT5 is running cannot be determined; nothing was started. Try again.")]
    ProcessStateUnknown,
    #[error("MT5 could not be started: {reason}")]
    LaunchFailed { reason: String },
}

/// The bridge endpoint the preset hands to the advisor: where the app listens, and
/// the token it expects.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct StartupSession {
    host: String,
    port: u16,
    token: String,
}

impl StartupSession {
    /// Endpoint for the address the bridge listens on, split into the host and the
    /// port `SocketConnect` takes.
    ///
    /// The address is parsed the way `run_server` parses it, so an address the bridge
    /// accepts is exactly an address this accepts. The bracketed IPv6 form is what the
    /// parser takes as input; the preset carries the bare address, because that is
    /// what the advisor hands to `SocketConnect`. The token is carried verbatim,
    /// because the bridge compares it verbatim.
    pub(super) fn from_bind_address(address: &str, token: &str) -> Result<Self, RestartError> {
        if token.is_empty() {
            return Err(RestartError::TokenMissing);
        }
        let address = address.trim();
        let parsed =
            validate_bind_address(address).map_err(|reason| RestartError::AddressUnusable {
                address: address.to_string(),
                reason: reason.to_string(),
            })?;
        Ok(Self {
            host: parsed.ip().to_string(),
            port: parsed.port(),
            token: token.to_string(),
        })
    }
}

/// The token stays out of every log line and error message, so the debug form
/// redacts it instead of trusting each caller.
impl std::fmt::Debug for StartupSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StartupSession")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("token", &"<redacted>")
            .finish()
    }
}

/// The two files one restart writes. Both are deleted again once the terminal read
/// them, because the preset holds the bridge token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StartupFiles {
    pub(crate) ini: PathBuf,
    pub(crate) preset: PathBuf,
}

/// Root of a data folder: the folder holding its `MQL5` tree.
fn data_folder_root(data_folder: &DataFolder) -> &Path {
    match data_folder.mql5.parent() {
        Some(root) => root,
        None => &data_folder.mql5,
    }
}

/// `<folder>/config/BetterChartsStartup.ini`. The ini location and the startup cleanup
/// are both built from this one join, so they cannot drift apart.
fn config_ini_path(folder: &Path) -> PathBuf {
    folder.join(CONFIG_FOLDER).join(STARTUP_INI_FILE)
}

/// Path of the startup ini: below the install folder under wine, because MT5 resolves
/// the relative `config\BetterChartsStartup.ini` argument from there; below the data
/// folder on native Windows, because the install folder (`C:\Program Files\MetaTrader
/// 5`) is not writable for a normal user.
fn startup_ini_path(
    host: HostPlatform,
    install_folder: &Path,
    data_folder: &DataFolder,
) -> PathBuf {
    match host {
        HostPlatform::Wine => config_ini_path(install_folder),
        HostPlatform::Windows => config_ini_path(data_folder_root(data_folder)),
    }
}

/// Path of the startup preset below the data folder's `MQL5` tree.
fn preset_path(mql5: &Path) -> PathBuf {
    mql5.join(PRESETS_FOLDER).join(STARTUP_PRESET_FILE)
}

pub(super) fn startup_file_paths(
    host: HostPlatform,
    install_folder: &Path,
    data_folder: &DataFolder,
) -> StartupFiles {
    StartupFiles {
        ini: startup_ini_path(host, install_folder, data_folder),
        preset: preset_path(&data_folder.mql5),
    }
}

/// Lines as MT5 writes them: CRLF after every line, including the last.
fn startup_text(lines: &[&str]) -> String {
    let mut text = String::new();
    for line in lines {
        text.push_str(line);
        text.push_str(LINE_BREAK);
    }
    text
}

/// Body of the startup ini: the advisor to load and the preset that supplies its
/// inputs.
fn startup_ini_text(expert_path: &str, preset_name: &str) -> String {
    let expert_line = format!("Expert={expert_path}");
    let preset_line = format!("ExpertParameters={preset_name}");
    startup_text(&["[StartUp]", &expert_line, &preset_line])
}

/// Body of the startup preset: the advisor's three bridge inputs, in declaration
/// order.
fn startup_preset_text(session: &StartupSession) -> String {
    let StartupSession { host, port, token } = session;
    startup_text(&[
        &format!("InpBridgeToken={token}"),
        &format!("InpBridgeHost={host}"),
        &format!("InpBridgePort={port}"),
    ])
}

/// Bytes MT5 expects for both startup files: UTF-16LE behind a byte-order mark.
fn utf16_le_text_bytes(text: &str) -> Vec<u8> {
    let mut bytes = UTF16_LE_BOM.to_vec();
    for code_unit in text.encode_utf16() {
        bytes.extend_from_slice(&code_unit.to_le_bytes());
    }
    bytes
}

pub(super) fn startup_ini_bytes(expert_path: &str, preset_name: &str) -> Vec<u8> {
    utf16_le_text_bytes(&startup_ini_text(expert_path, preset_name))
}

pub(super) fn startup_preset_bytes(session: &StartupSession) -> Vec<u8> {
    utf16_le_text_bytes(&startup_preset_text(session))
}

/// `path` without the extension of a bundled source, which is the form `Expert=`
/// takes.
fn without_source_extension(path: &str) -> &str {
    match path.strip_suffix(SOURCE_EXTENSION) {
        Some(stem) => stem,
        None => path,
    }
}

/// `Expert=` value: the path of the advisor the install wrote, below `MQL5\Experts`
/// and without its extension, e.g. `Advisors\BetterChartsBridge`.
///
/// Refuses when that copy or the compiled `.ex5` beside it is missing: an older copy
/// elsewhere below `Experts` is not the one the install wrote, and MT5 would start
/// without the advisor, which reports nothing and looks like a bridge that cannot
/// connect.
pub(super) fn expert_startup_path(mql5: &Path) -> Result<String, RestartError> {
    let Some(installed) = default_path(mql5, Mql5File::ExpertAdvisor) else {
        return Err(RestartError::ExpertNotInstalled);
    };
    if !installed.is_file() || !installed.with_extension(COMPILED_EXTENSION).is_file() {
        return Err(RestartError::ExpertNotInstalled);
    }
    let experts = mql5.join(EXPERTS_FOLDER);
    let relative = relative_windows_path(&experts, &installed).map_err(|error| {
        RestartError::ExpertPathUnusable {
            reason: error.to_string(),
        }
    })?;
    Ok(without_source_extension(&relative).to_string())
}

fn write_startup_file(path: &Path, bytes: &[u8]) -> Result<(), RestartError> {
    write_atomically(path, bytes).map_err(|error| RestartError::StartupFileUnwritable {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })
}

/// Writes both startup files, preset first: the ini names the preset, and MT5 reads
/// both at launch, so an ini whose preset is missing would start the advisor with its
/// defaults — and without a token.
fn write_startup_files(
    files: &StartupFiles,
    expert_path: &str,
    session: &StartupSession,
) -> Result<(), RestartError> {
    write_startup_file(&files.preset, &startup_preset_bytes(session))?;
    let ini_bytes = startup_ini_bytes(expert_path, STARTUP_PRESET_FILE);
    write_startup_file(&files.ini, &ini_bytes)
}

fn remove_file(path: &Path) {
    let _ = fs::remove_file(path);
}

/// Deletes both startup files. A file that is already gone is not an error, so the
/// cleanup runs on every path without having to know which files exist.
pub(crate) fn remove_startup_files(files: &StartupFiles) {
    remove_file(&files.ini);
    remove_file(&files.preset);
}

/// Deletes whatever an interrupted restart left behind for one installation and the
/// data folders located under it: the ini below the install folder and, per data
/// folder, the ini below its root's `config` and the preset. Both ini locations are
/// swept because the host decides which one a restart writes. Best effort: a folder
/// that cannot be read or written is not the startup hook's problem, so nothing is
/// reported.
pub(crate) fn remove_startup_files_in(installation: &Mt5Installation, data_folders: &[DataFolder]) {
    if let Some(install_folder) = install_dir(installation) {
        // The wine location, and where earlier Windows builds also tried to write.
        remove_file(&config_ini_path(&install_folder));
    }
    for data_folder in data_folders {
        remove_file(&config_ini_path(data_folder_root(data_folder)));
        remove_file(&preset_path(&data_folder.mql5));
    }
}

/// One terminal launch as plain data: program, arguments, working folder, and
/// environment, so a test compares it without starting anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalCommand {
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) working_directory: PathBuf,
    pub(crate) env: Vec<(String, String)>,
}

/// Text form of a host path in a command argument.
fn argument_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The `/config:` argument naming `ini`: a relative Windows path under wine, which is
/// the only form wine passes through unchanged, and the absolute path on native
/// Windows, where the ini lives outside the install folder.
fn ini_argument(host: HostPlatform, ini: &Path) -> String {
    match host {
        HostPlatform::Wine => format!("/config:{CONFIG_FOLDER}\\{STARTUP_INI_FILE}"),
        HostPlatform::Windows => format!("/config:{}", argument_text(ini)),
    }
}

/// Command that starts the terminal with the startup ini at `ini`, for the host the
/// installation's paths are resolved on.
///
/// Under wine the terminal is wine's first argument, at the relative name, with the
/// prefix in `WINEPREFIX`; on Windows the terminal is the program itself. The working
/// folder is the install folder in both cases, which is what makes the relative
/// `/config:` and terminal arguments resolve.
pub(super) fn startup_command(
    installation: &Mt5Installation,
    install_folder: &Path,
    layout: Layout,
    ini: &Path,
) -> Result<TerminalCommand, RestartError> {
    let mut args = Vec::new();
    let (program, env) = match installation.host {
        HostPlatform::Windows => (install_folder.join(TERMINAL_EXE_FILE), Vec::new()),
        HostPlatform::Wine => {
            let binary = installation.wine_binary.clone();
            let prefix = installation.wine_prefix.clone();
            let (Some(binary), Some(prefix)) = (binary, prefix) else {
                return Err(RestartError::WineUnavailable);
            };
            // Wine takes the terminal at the relative name, because it re-quotes an
            // absolute one whose folders contain a space.
            args.push(TERMINAL_EXE_FILE.to_string());
            let prefix = argument_text(&prefix);
            (binary, vec![(WINEPREFIX_VARIABLE.to_string(), prefix)])
        }
    };
    if layout == Layout::Portable {
        args.push(PORTABLE_OPTION.to_string());
    }
    args.push(ini_argument(installation.host, ini));
    Ok(TerminalCommand {
        program,
        args,
        working_directory: install_folder.to_path_buf(),
        env,
    })
}

/// Seam over the running terminal, so the restart sequence is tested without
/// starting or stopping anything. The real implementation is the only one that
/// touches processes.
pub(crate) trait ProcessControl {
    fn inspect(&self) -> ProcessCheck;
    /// Closes the running terminal; the caller then waits for it to be gone.
    fn stop(&self) -> Result<(), String>;
    /// Starts the terminal and returns without waiting for it to exit.
    fn launch(&self, command: &TerminalCommand) -> Result<(), String>;
    /// Waits between two polls; a test shortens this to nothing.
    fn pause(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// Starts the terminal with no standard streams: wine is noisy on all three
/// descriptors, and nothing is waited for, so MT5 outlives this call.
fn spawn_terminal(command: &TerminalCommand) -> Result<(), String> {
    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .current_dir(&command.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (key, value) in &command.env {
        process.env(key, value);
    }
    match process.spawn() {
        Ok(_child) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// The real terminal: the backend's own process inspection and stop mechanism, and a
/// detached launch.
pub(crate) struct SystemTerminal;

impl ProcessControl for SystemTerminal {
    fn inspect(&self) -> ProcessCheck {
        inspect_terminal()
    }

    fn stop(&self) -> Result<(), String> {
        stop_terminal()
    }

    fn launch(&self, command: &TerminalCommand) -> Result<(), String> {
        spawn_terminal(command)
    }
}

/// Waits the restart sequence uses, passed as data so a test runs the whole sequence
/// without sleeping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RestartPolicy {
    /// How often the closing terminal is polled.
    pub(crate) stop_poll: Duration,
    /// How long a closing terminal has to be gone before the launch is abandoned.
    pub(crate) stop_timeout: Duration,
    /// How often the cleanup looks for the restarted terminal's bridge session.
    pub(crate) cleanup_poll: Duration,
    /// How long the startup files may stay before the cleanup deletes them anyway.
    pub(crate) cleanup_timeout: Duration,
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            stop_poll: Duration::from_millis(250),
            stop_timeout: Duration::from_secs(30),
            cleanup_poll: Duration::from_millis(250),
            cleanup_timeout: Duration::from_secs(120),
        }
    }
}

/// Number of polls a wait of `timeout` performs at `poll` intervals. Never zero, so
/// every wait observes the state at least once.
pub(crate) fn poll_count(poll: Duration, timeout: Duration) -> u32 {
    let interval = poll.as_millis().max(1);
    let total = timeout.as_millis() / interval;
    u32::try_from(total).unwrap_or(u32::MAX).max(1)
}

/// Polls the terminal until it is gone, and gives up once the timeout passed.
///
/// `Unknown` ends the wait immediately: a failed inspection says nothing about
/// whether the old terminal is still there, and starting a second one would make both
/// fight over the same data folder.
fn wait_until_gone(
    control: &dyn ProcessControl,
    policy: &RestartPolicy,
) -> Result<(), RestartError> {
    let polls = poll_count(policy.stop_poll, policy.stop_timeout);
    for poll in 1..=polls {
        match control.inspect() {
            ProcessCheck::NotRunning => return Ok(()),
            ProcessCheck::Unknown => return Err(RestartError::ProcessStateUnknown),
            ProcessCheck::Running if poll == polls => break,
            ProcessCheck::Running => control.pause(policy.stop_poll),
        }
    }
    Err(RestartError::StopTimedOut)
}

/// Closes a running terminal and waits until it is gone.
fn close_terminal(
    control: &dyn ProcessControl,
    policy: &RestartPolicy,
) -> Result<(), RestartError> {
    match control.inspect() {
        ProcessCheck::NotRunning => return Ok(()),
        ProcessCheck::Unknown => return Err(RestartError::ProcessStateUnknown),
        ProcessCheck::Running => {}
    }
    control
        .stop()
        .map_err(|reason| RestartError::StopFailed { reason })?;
    wait_until_gone(control, policy)
}

/// Whether the cleanup may delete the startup files: the bridge is connected and its
/// session is not the one the restart replaced.
///
/// Waiting for a *new* session keeps the files on disk until MT5 has read them, even
/// while the session that is being replaced is still reported as connected.
pub(crate) fn new_session_live(
    connected: bool,
    session: Option<&str>,
    replaced: Option<&str>,
) -> bool {
    connected && session.is_some() && session != replaced
}

/// What one restart works from: the matched installation and data folder, and the
/// bridge settings its preset carries.
///
/// Deliberately without a `Debug` form: it holds the bridge token, and no debug
/// output may print it.
pub(crate) struct RestartRequest {
    pub(crate) installation: Mt5Installation,
    pub(crate) data_folder: DataFolder,
    /// Bind address the bridge listens on, as `run_server` reads it.
    pub(crate) address: String,
    /// Token the advisor has to present.
    pub(crate) token: String,
}

/// Restarts the terminal with the bridge advisor attached and reports the two files
/// that carry the bridge settings, so the caller can delete them once the terminal has
/// read them.
///
/// Refuses before the first write while an order is queued or in flight, when the
/// bridge settings are unusable, when the advisor is not installed, and when the
/// launch command cannot be built; a failure after the writes deletes them again, and
/// the terminal is only started once the old process is observed to be gone.
pub(crate) fn restart_with_expert(
    request: &RestartRequest,
    queue: &ExecutionQueueView,
    control: &dyn ProcessControl,
    policy: &RestartPolicy,
) -> Result<StartupFiles, RestartError> {
    // The terminal is about to close, so nothing may be written while an order could
    // still be lost.
    ensure_no_order_pending(queue).map_err(|_error| RestartError::OrderInFlight)?;
    let session = StartupSession::from_bind_address(&request.address, &request.token)?;
    let install_folder =
        install_dir(&request.installation).ok_or_else(|| RestartError::InstallFolderMissing {
            path: request.installation.terminal_exe_windows.clone(),
        })?;
    // Checked before the first write, so an installation without the advisor keeps its
    // `config` and `Presets` folders untouched.
    let expert_path = expert_startup_path(&request.data_folder.mql5)?;
    let files = startup_file_paths(
        request.installation.host,
        &install_folder,
        &request.data_folder,
    );
    // Built before the terminal is closed: a missing wine binary must not leave the
    // user without a running terminal.
    let command = startup_command(
        &request.installation,
        &install_folder,
        request.data_folder.layout,
        &files.ini,
    )?;
    write_startup_files(&files, &expert_path, &session)?;
    if let Err(error) = close_terminal(control, policy) {
        remove_startup_files(&files);
        return Err(error);
    }
    if let Err(reason) = control.launch(&command) {
        remove_startup_files(&files);
        return Err(RestartError::LaunchFailed { reason });
    }
    Ok(files)
}
