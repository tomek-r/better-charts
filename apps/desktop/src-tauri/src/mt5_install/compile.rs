//! Compile the installed MQL5 sources with MetaEditor and report the result.
//!
//! MetaEditor is run once per installed file, through wine on macOS and Linux and
//! directly on Windows, with the data folder as its working folder. It receives a
//! *relative* Windows source path and the bare `/log` option, because wine
//! re-quotes an argument that contains a space and an absolute
//! `C:\Program Files\...` argument then silently fails; a relative path that would
//! need quoting is refused instead of run. The log MetaEditor writes beside the
//! source — `<source stem>.log`, UTF-16LE — decides the outcome: 0 errors and 0
//! warnings is a success, and MetaEditor's exit code is ignored. Every run deletes
//! the previous log first, so an earlier result is never reported for a later
//! compile.
//!
//! Privacy: the only file read here is that compile log of one of our own two
//! sources, the exception the module rule in `mod.rs` records. Nothing else below
//! the MT5 folder is opened.
//!
//! Nothing here starts the MT5 terminal: compiling works while it runs, so this
//! module never touches the backend's process. The runner is injected, so the
//! compile loop is unit-tested without starting anything.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use thiserror::Error;

use super::discover::Mt5Installation;
use super::install::InstalledFile;
use super::locate::{
    install_dir, HostPlatform, InstallationLocation, Mql5File, WINDOWS_FOLDER_SEPARATOR,
};

/// Editor that ships beside `terminal64.exe` and compiles one source standalone.
pub(super) const METAEDITOR_EXE_FILE: &str = "MetaEditor64.exe";
/// Option naming the source to compile; the path that follows is relative to the
/// working folder.
const COMPILE_OPTION_PREFIX: &str = "/compile:";
/// Option that makes MetaEditor write its log beside the source. It carries no
/// path, because an absolute log path fails the same way an absolute source path
/// does.
const LOG_OPTION: &str = "/log";
/// Extension of the log MetaEditor writes for `name.mq5`: `name.log`.
const LOG_EXTENSION: &str = "log";
/// Upper bound on the diagnostics one result carries: a broken compile logs
/// hundreds of lines, and the first ones name the cause.
pub(super) const MAX_MESSAGES: usize = 20;
/// Environment variable that points wine at the prefix holding `drive_c`.
const WINEPREFIX_VARIABLE: &str = "WINEPREFIX";
/// Word a result line puts its error count before.
const ERROR_WORD: &str = "error";
/// Word a result line puts its warning count before.
const WARNING_WORD: &str = "warning";
/// Prefix of the line that carries the counts:
/// `Result: 0 errors, 0 warnings, 2806 ms elapsed, cpu='X64 Regular'`.
const RESULT_LINE_PREFIX: &str = "Result:";
/// Kind markers of a diagnostic line: `name.mq5(12,9) : error 123: …`.
const ERROR_MARKER: &str = " : error ";
const WARNING_MARKER: &str = " : warning ";
/// A compile of one small file takes seconds; the bound only stops a stuck wine
/// process from holding the install command forever.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
/// How often the running editor is polled while it compiles.
const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Byte-order marks a log may carry. The decoder also accepts UTF-8, because the
/// log format is undocumented and an editor may rewrite the file.
const UTF16_LE_BOM: [u8; 2] = [0xff, 0xfe];
const UTF8_BOM: [u8; 3] = [0xef, 0xbb, 0xbf];
const UTF16_CODE_UNIT_BYTES: usize = 2;

/// Outcome of one compile, read back from MetaEditor's log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileResult {
    pub file: Mql5File,
    pub errors: u32,
    pub warnings: u32,
    /// The log's error and warning lines, trimmed and capped at [`MAX_MESSAGES`].
    pub messages: Vec<String>,
}

#[derive(Debug, Error)]
pub enum CompileError {
    /// The editor is not beside the terminal executable, so nothing can compile.
    #[error("MetaEditor is missing: {} is not a file", path.display())]
    EditorMissing { path: PathBuf },
    /// Wine would re-quote the argument and MetaEditor would silently compile
    /// nothing.
    #[error(
        "the MQL5 file at {} sits in a folder whose name contains a space, \
         which wine cannot pass to MetaEditor",
        path.display()
    )]
    PathHasSpace { path: PathBuf },
    /// Only a relative path below the data folder can be passed, so a source
    /// anywhere else cannot be compiled.
    #[error("the MQL5 file at {} is outside the data folder", path.display())]
    NotInsideDataFolder { path: PathBuf },
    #[error("MetaEditor could not be run: {reason}")]
    LaunchFailed { reason: String },
    #[error("MetaEditor did not finish within the time limit")]
    TimedOut,
    /// The run left no log behind, so it produced no result at all.
    #[error("MetaEditor wrote no compile log at {}", path.display())]
    LogMissing { path: PathBuf },
    #[error("the compile log at {} cannot be read: {reason}", path.display())]
    LogUnreadable { path: PathBuf, reason: String },
    #[error("the compile log carries no result line")]
    NoResultLine,
}

/// Whether `bytes` look like UTF-16LE without a byte-order mark: an even number of
/// bytes and a zero high byte in most code units, which is what ASCII log lines
/// look like. Text that defeats the guess is read as UTF-8 and then yields no
/// result line, which is reported instead of a wrong outcome.
fn looks_like_utf16_le(bytes: &[u8]) -> bool {
    let code_units = bytes.chunks_exact(UTF16_CODE_UNIT_BYTES);
    if bytes.is_empty() || !code_units.remainder().is_empty() {
        return false;
    }
    let ascii_units = code_units.filter(|&unit| unit[1] == 0).count();
    ascii_units * 2 > bytes.len() / UTF16_CODE_UNIT_BYTES
}

fn decode_utf16_le(bytes: &[u8]) -> String {
    let code_units: Vec<u16> = bytes
        .chunks_exact(UTF16_CODE_UNIT_BYTES)
        .filter_map(|unit| <[u8; UTF16_CODE_UNIT_BYTES]>::try_from(unit).ok())
        .map(u16::from_le_bytes)
        .collect();
    String::from_utf16_lossy(&code_units)
}

/// Text of a compile log: UTF-16LE behind a byte-order mark, UTF-16LE without one
/// when the bytes look like it, UTF-8 otherwise.
pub fn decode_log(bytes: &[u8]) -> String {
    if let Some(body) = bytes.strip_prefix(UTF16_LE_BOM.as_slice()) {
        return decode_utf16_le(body);
    }
    if looks_like_utf16_le(bytes) {
        return decode_utf16_le(bytes);
    }
    let body = bytes.strip_prefix(UTF8_BOM.as_slice()).unwrap_or(bytes);
    String::from_utf8_lossy(body).into_owned()
}

/// Number `line` reports before `word`: the `0` of `Result: 0 errors, …`.
fn count_before(line: &str, word: &str) -> Option<u32> {
    let mut previous = "";
    for candidate in line.split_whitespace() {
        if candidate.starts_with(word) {
            return previous.parse().ok();
        }
        previous = candidate;
    }
    None
}

/// The log's error and warning lines, trimmed and capped, in log order.
fn diagnostic_messages(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| line.contains(ERROR_MARKER) || line.contains(WARNING_MARKER))
        .take(MAX_MESSAGES)
        .map(str::to_string)
        .collect()
}

/// Error count, warning count, and diagnostics of a compile log, or `None` when
/// the log carries no result line and therefore no outcome.
///
/// The last result line wins, because an editor may append to a log; the counts
/// come from that line alone, never from the diagnostics.
pub fn parse_compile_log(text: &str) -> Option<(u32, u32, Vec<String>)> {
    let result_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with(RESULT_LINE_PREFIX))?;
    let errors = count_before(result_line, ERROR_WORD)?;
    let warnings = count_before(result_line, WARNING_WORD)?;
    Some((errors, warnings, diagnostic_messages(text)))
}

/// Windows path of `file_path` relative to `data_folder`, separated by
/// backslashes: the form MetaEditor receives, and the only form wine passes
/// through unchanged.
///
/// Refuses a source outside `data_folder` and a relative path that contains a
/// space, because both would otherwise come back as a compile with no result
/// instead of the reason. The space check applies on both hosts, as the argument
/// form is shared and no shipped source sits in such a folder.
pub fn relative_windows_path(data_folder: &Path, file_path: &Path) -> Result<String, CompileError> {
    let relative =
        file_path
            .strip_prefix(data_folder)
            .map_err(|_| CompileError::NotInsideDataFolder {
                path: file_path.to_path_buf(),
            })?;
    let mut windows_path = String::new();
    for part in relative.iter() {
        if !windows_path.is_empty() {
            windows_path.push(WINDOWS_FOLDER_SEPARATOR);
        }
        windows_path.push_str(&part.to_string_lossy());
    }
    if windows_path.is_empty() {
        return Err(CompileError::NotInsideDataFolder {
            path: file_path.to_path_buf(),
        });
    }
    if windows_path.contains(' ') {
        return Err(CompileError::PathHasSpace {
            path: file_path.to_path_buf(),
        });
    }
    Ok(windows_path)
}

/// Log MetaEditor writes for `source`: the source name with a `.log` extension
/// beside it, because [`LOG_OPTION`] carries no path.
pub fn log_path_for(source: &Path) -> PathBuf {
    source.with_extension(LOG_EXTENSION)
}

/// One MetaEditor invocation as plain data: program, arguments, working folder,
/// and environment, so a test compares it without starting anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub working_directory: PathBuf,
    pub env: Vec<(String, String)>,
}

/// Text form of a host path in a command argument: the program argument wine
/// takes, and the prefix it reads from the environment.
fn argument_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// `MetaEditor64.exe` beside the terminal executable: the editor ships with the
/// terminal, so the install folder holds both. Checked before anything runs, so a
/// missing editor is never mistaken for a compile failure.
fn editor_path(installation: &Mt5Installation) -> Result<PathBuf, CompileError> {
    let editor = install_dir(installation).map_or_else(
        || PathBuf::from(METAEDITOR_EXE_FILE),
        |install_folder| install_folder.join(METAEDITOR_EXE_FILE),
    );
    if editor.is_file() {
        return Ok(editor);
    }
    Err(CompileError::EditorMissing { path: editor })
}

/// The wine binary that runs the editor. Only a Wine installation has one, and a
/// Wine installation without it cannot compile.
fn wine_program(installation: &Mt5Installation) -> Result<PathBuf, CompileError> {
    installation
        .wine_binary
        .clone()
        .ok_or_else(|| CompileError::LaunchFailed {
            reason: "the installation has no wine binary".to_string(),
        })
}

/// Command that compiles `source` inside `data_folder`, for the host the
/// installation's paths are resolved on.
///
/// On Windows the editor is the program itself; under wine it is wine's first
/// argument, at a host path, with the prefix in `WINEPREFIX`, the same way the
/// backend starts the terminal.
pub fn compile_command(
    installation: &Mt5Installation,
    data_folder: &Path,
    source: &Path,
) -> Result<CompileCommand, CompileError> {
    let editor = editor_path(installation)?;
    let source_argument = format!(
        "{COMPILE_OPTION_PREFIX}{}",
        relative_windows_path(data_folder, source)?
    );
    match installation.host {
        HostPlatform::Windows => Ok(CompileCommand {
            program: editor,
            args: vec![source_argument, LOG_OPTION.to_string()],
            working_directory: data_folder.to_path_buf(),
            env: Vec::new(),
        }),
        HostPlatform::Wine => {
            let prefix = argument_text(installation.wine_prefix());
            Ok(CompileCommand {
                program: wine_program(installation)?,
                // Wine takes the editor as its first argument, at a host path.
                args: vec![
                    argument_text(&editor),
                    source_argument,
                    LOG_OPTION.to_string(),
                ],
                working_directory: data_folder.to_path_buf(),
                env: vec![(WINEPREFIX_VARIABLE.to_string(), prefix)],
            })
        }
    }
}

/// Runs one compile. Injected so the compile loop is tested without starting
/// MetaEditor: the real runner is the only implementation that spawns anything.
pub trait CommandRunner {
    /// Runs `command`, whose log has to appear at `log`; the caller deleted the
    /// previous one first, so the runner never mistakes an old result for its own.
    /// Reports only what it can observe — launch failure and timeout — because the
    /// log decides the outcome.
    fn run(&self, command: &CompileCommand, log: &Path) -> Result<(), CompileError>;
}

/// The real runner: a child process with a time limit and no standard streams,
/// because MetaEditor reports through its log.
pub struct ProcessRunner {
    pub timeout: Duration,
}

impl Default for ProcessRunner {
    fn default() -> Self {
        Self {
            timeout: COMPILE_TIMEOUT,
        }
    }
}

/// A process step that could not be carried out, with the operating system's
/// reason: the editor never ran, so no log decides anything.
fn launch_failed(error: io::Error) -> CompileError {
    CompileError::LaunchFailed {
        reason: error.to_string(),
    }
}

fn spawn_command(command: &CompileCommand) -> Result<Child, CompileError> {
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
    process.spawn().map_err(launch_failed)
}

/// Waits for the editor to exit, or terminates it once `timeout` has passed. The
/// exit code is ignored: only the log says whether the compile worked.
fn wait_until_finished(child: &mut Child, timeout: Duration) -> Result<(), CompileError> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_status)) => return Ok(()),
            Ok(None) => std::thread::sleep(POLL_INTERVAL),
            Err(error) => return Err(launch_failed(error)),
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(CompileError::TimedOut)
}

impl CommandRunner for ProcessRunner {
    fn run(&self, command: &CompileCommand, _log: &Path) -> Result<(), CompileError> {
        let mut child = spawn_command(command)?;
        wait_until_finished(&mut child, self.timeout)
    }
}

/// Removes the previous log, so a run that writes none is reported as
/// [`CompileError::LogMissing`] instead of repeating an older result.
fn remove_stale_log(log: &Path) -> Result<(), CompileError> {
    match fs::remove_file(log) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CompileError::LogUnreadable {
            path: log.to_path_buf(),
            reason: error.to_string(),
        }),
    }
}

/// Reads back the log of one of our own sources; that file is ours, as the module
/// privacy rule in `mod.rs` records.
fn read_compile_log(log: &Path) -> Result<(u32, u32, Vec<String>), CompileError> {
    let bytes = match fs::read(log) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(CompileError::LogMissing {
                path: log.to_path_buf(),
            })
        }
        Err(error) => {
            return Err(CompileError::LogUnreadable {
                path: log.to_path_buf(),
                reason: error.to_string(),
            })
        }
    };
    parse_compile_log(&decode_log(&bytes)).ok_or(CompileError::NoResultLine)
}

/// Compiles one installed file and reads its result back from the log.
fn compile_one(
    installation: &Mt5Installation,
    data_folder: &Path,
    installed_file: &InstalledFile,
    runner: &dyn CommandRunner,
) -> Result<CompileResult, CompileError> {
    let command = compile_command(installation, data_folder, &installed_file.path)?;
    let log = log_path_for(&installed_file.path);
    remove_stale_log(&log)?;
    runner.run(&command, &log)?;
    let (errors, warnings, messages) = read_compile_log(&log)?;
    Ok(CompileResult {
        file: installed_file.file,
        errors,
        warnings,
        messages,
    })
}

/// Compiles the installed copies in `installed` order — the indicator first, as
/// the install step reports them — and returns one result per compiled file.
///
/// A file that is not our indicator still yields its result when it has errors; a
/// broken indicator ends the run after its own result, because the expert advisor
/// loads it through `iCustom` and could only report the missing dependency on top.
/// Any other failure ends the run as an error, since the outcome of that file is
/// unknown.
pub fn compile_installed(
    installation: &Mt5Installation,
    data_folder: &Path,
    installed: &[InstalledFile],
    runner: &dyn CommandRunner,
) -> Result<Vec<CompileResult>, CompileError> {
    let mut results = Vec::with_capacity(installed.len());
    for installed_file in installed {
        let result = compile_one(installation, data_folder, installed_file, runner)?;
        let indicator_failed = result.file == Mql5File::Indicator && result.errors > 0;
        results.push(result);
        if indicator_failed {
            break;
        }
    }
    Ok(results)
}
