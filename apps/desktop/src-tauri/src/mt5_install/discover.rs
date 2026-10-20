//! Find MT5 installations on the machine that runs this process, so the install
//! feature works without a single `MT5_*` environment variable.
//!
//! Discovery is read-only and fails closed: it checks that `terminal64.exe` — and,
//! off Windows, the wine binary — exists, and lists one level of `%ProgramFiles%`
//! for broker-branded installs. No file content is read, nothing is written, and
//! nothing is started.
//!
//! The `MT5_*` variables stay overrides: a configured `MT5_TERMINAL_EXE` is the
//! only reported installation, parsed by [`Mt5BackendConfig::resolve`] so the
//! override means exactly what it means to the backend.
//!
//! Why discovery never feeds [`Mt5BackendConfig`]: the boot hook starts a terminal
//! only for an explicitly configured installation. Discovered paths would make
//! every machine that happens to have MT5 installed auto-start it, so this module
//! is reachable from the install command alone and never from `from_env`.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use super::locate::{
    sorted_folders, windows_path_on_host, HostPlatform, InstallationLocation,
    WINDOWS_FOLDER_SEPARATOR,
};
use crate::mt5_backend::{
    non_empty_env, resolve_executable_with_path, Mt5BackendConfig, DEFAULT_WINE_BINARY,
};

/// Home folder holding the macOS and Linux defaults.
const HOME_VARIABLE: &str = "HOME";
/// `PATH`, searched for the `wine` binary on Linux.
const PATH_VARIABLE: &str = "PATH";
/// Native Windows variable holding the program folder.
const PROGRAM_FILES_VARIABLE: &str = "ProgramFiles";
/// Program folder Windows uses when the variable is unset; the only place MT5
/// installs into by default.
const DEFAULT_PROGRAM_FILES: &str = r"C:\Program Files";
/// Folder MetaQuotes' installer creates below the program folder. Broker builds
/// keep the same name behind their brand (`Acme MetaTrader 5`).
const METAQUOTES_INSTALL_FOLDER: &str = "MetaTrader 5";
/// Terminal executable MT5 writes into every install folder.
const TERMINAL_EXE_FILE: &str = "terminal64.exe";
/// Windows path of a default installation: native on Windows, and inside
/// `drive_c` of the Wine prefix on macOS and Linux.
const TERMINAL_EXE_WINDOWS: &str = r"C:\Program Files\MetaTrader 5\terminal64.exe";
/// Wine prefix of the official macOS application, which bundles its own Wine build
/// instead of using one from `PATH`.
const MACOS_PREFIX_FOLDER: &str = "Library/Application Support/net.metaquotes.wine.metatrader5";
/// Wine binary inside the official macOS application bundle.
const MACOS_WINE_BINARY: &str =
    "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine";
/// Wine prefixes probed on Linux, most specific first: MetaQuotes' `mt5linux.sh`
/// installer creates `~/.mt5`, a plain Wine installation uses `~/.wine`.
const LINUX_PREFIX_FOLDERS: [&str; 2] = [".mt5", ".wine"];

/// The operating system discovery keys its defaults on. Passed as data, so the
/// Windows, macOS, and Linux branches are unit-tested on any host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostOs {
    Windows,
    MacOs,
    Linux,
}

/// Where an [`Mt5Installation`] came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallationSource {
    /// The `MT5_*` environment variables; wins over every default.
    Configured,
    /// A default location on this machine.
    Discovered,
}

/// One MT5 installation the install feature can target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mt5Installation {
    /// Host the Windows paths below are resolved on.
    pub host: HostPlatform,
    /// Wine prefix that holds `drive_c`; `None` on Windows.
    pub wine_prefix: Option<PathBuf>,
    /// Wine binary that runs the terminal, as configured or as resolved through
    /// `PATH`; `None` on Windows.
    pub wine_binary: Option<PathBuf>,
    /// Windows path of `terminal64.exe`, in the form the backend accepts.
    pub terminal_exe_windows: String,
    pub source: InstallationSource,
}

impl InstallationLocation for Mt5Installation {
    fn host(&self) -> HostPlatform {
        self.host
    }

    fn wine_prefix(&self) -> &Path {
        self.wine_prefix.as_deref().unwrap_or(Path::new(""))
    }

    fn terminal_exe_windows(&self) -> &str {
        &self.terminal_exe_windows
    }
}

/// The filesystem knowledge discovery needs, injected so the three operating
/// systems are tested without touching this machine's disk. Deliberately minimal:
/// existence checks and one level of folder names, never file contents.
pub trait InstallProbe {
    /// Whether `path` is an existing regular file.
    fn is_file(&self, path: &Path) -> bool;

    /// Names of the sub-folders of `folder`, in name order so repeated scans
    /// report the same installations.
    fn folder_names(&self, folder: &Path) -> Vec<String>;
}

/// The real filesystem, read-only.
pub struct HostProbe;

impl InstallProbe for HostProbe {
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn folder_names(&self, folder: &Path) -> Vec<String> {
        let mut names = Vec::new();
        for child in sorted_folders(folder) {
            let Some(name) = child.file_name() else {
                continue;
            };
            names.push(name.to_string_lossy().into_owned());
        }
        names
    }
}

/// Platform the installation's Windows paths are resolved on.
fn host_platform(host_os: HostOs) -> HostPlatform {
    match host_os {
        HostOs::Windows => HostPlatform::Windows,
        HostOs::MacOs | HostOs::Linux => HostPlatform::Wine,
    }
}

/// The configured Wine prefix, or `None` when the variable was left unset: an
/// empty prefix resolves no Windows path.
fn configured_wine_prefix(wine_prefix: PathBuf) -> Option<PathBuf> {
    if wine_prefix.as_os_str().is_empty() {
        return None;
    }
    Some(wine_prefix)
}

/// The installation the `MT5_*` variables describe, or `None` when
/// `MT5_TERMINAL_EXE` is unset or blank.
fn configured_installation(
    env: &dyn Fn(&str) -> Option<String>,
    host_os: HostOs,
) -> Option<Mt5Installation> {
    let config = Mt5BackendConfig::resolve(env);
    if config.terminal_exe_windows.is_empty() {
        return None;
    }
    Some(match host_platform(host_os) {
        // Wine settings are reported as given, because the user already chose
        // them; nothing on Windows can use them, so they stay empty there.
        HostPlatform::Windows => Mt5Installation {
            host: HostPlatform::Windows,
            wine_prefix: None,
            wine_binary: None,
            terminal_exe_windows: config.terminal_exe_windows,
            source: InstallationSource::Configured,
        },
        HostPlatform::Wine => Mt5Installation {
            host: HostPlatform::Wine,
            wine_prefix: configured_wine_prefix(config.wine_prefix),
            wine_binary: Some(config.wine_binary),
            terminal_exe_windows: config.terminal_exe_windows,
            source: InstallationSource::Configured,
        },
    })
}

/// The home folder the macOS and Linux defaults are relative to.
fn home_folder(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    non_empty_env(env, HOME_VARIABLE).map(PathBuf::from)
}

/// `wine` from `PATH`, resolved the way the backend resolves a bare
/// `MT5_WINE_BINARY`.
fn wine_binary_on_path(
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Option<PathBuf> {
    let search_path = non_empty_env(env, PATH_VARIABLE)?;
    resolve_executable_with_path(
        Path::new(DEFAULT_WINE_BINARY),
        Some(OsStr::new(&search_path)),
        |candidate| probe.is_file(candidate),
    )
}

/// A Wine-host installation. The wine binary and the terminal executable must both
/// exist: without either, the install feature cannot run the terminal, so a
/// half-installed prefix is not reported.
fn wine_installation(
    wine_prefix: PathBuf,
    wine_binary: &Path,
    probe: &impl InstallProbe,
) -> Option<Mt5Installation> {
    let terminal_exe_windows = TERMINAL_EXE_WINDOWS.to_string();
    let terminal_exe_host =
        windows_path_on_host(&terminal_exe_windows, HostPlatform::Wine, &wine_prefix)?;
    if !probe.is_file(&terminal_exe_host) || !probe.is_file(wine_binary) {
        return None;
    }
    Some(Mt5Installation {
        host: HostPlatform::Wine,
        wine_prefix: Some(wine_prefix),
        wine_binary: Some(wine_binary.to_path_buf()),
        terminal_exe_windows,
        source: InstallationSource::Discovered,
    })
}

/// The macOS default: the official application, whose prefix lives in the user's
/// library and whose Wine build lives in the application bundle.
fn macos_installation(
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Option<Mt5Installation> {
    let home = home_folder(env)?;
    wine_installation(
        home.join(MACOS_PREFIX_FOLDER),
        Path::new(MACOS_WINE_BINARY),
        probe,
    )
}

/// Linux defaults, most specific first. Both need a `wine` binary on `PATH`.
fn linux_installations(
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Vec<Mt5Installation> {
    let Some(home) = home_folder(env) else {
        return Vec::new();
    };
    let Some(wine_binary) = wine_binary_on_path(env, probe) else {
        return Vec::new();
    };
    LINUX_PREFIX_FOLDERS
        .iter()
        .filter_map(|folder| wine_installation(home.join(folder), &wine_binary, probe))
        .collect()
}

/// `%ProgramFiles%` without a trailing separator, so a folder below it never
/// joins with two.
fn program_files_folder(env: &dyn Fn(&str) -> Option<String>) -> String {
    let program_files = non_empty_env(env, PROGRAM_FILES_VARIABLE)
        .unwrap_or_else(|| DEFAULT_PROGRAM_FILES.to_string());
    program_files.trim_end_matches(['\\', '/']).to_string()
}

/// `<folder>\<name>`: exactly one separator between the parts and Windows
/// separators throughout, because the reported path is the string Windows tools
/// open.
fn windows_child_path(folder: &str, name: &str) -> String {
    format!("{folder}{WINDOWS_FOLDER_SEPARATOR}{name}")
}

/// Install folders to probe on Windows in report order: the MetaQuotes folder
/// first, then every sub-folder of `%ProgramFiles%` in name order, which is where a
/// broker-branded build lives. That scan also lists the MetaQuotes folder, which
/// the case-insensitive dedup drops instead of reporting it twice.
fn windows_install_folders(program_files: &str, probe: &impl InstallProbe) -> Vec<String> {
    let mut install_folders = vec![METAQUOTES_INSTALL_FOLDER.to_string()];
    for name in probe.folder_names(Path::new(program_files)) {
        let known = install_folders
            .iter()
            .any(|folder| folder.eq_ignore_ascii_case(&name));
        if !known {
            install_folders.push(name);
        }
    }
    install_folders
}

/// A native Windows installation, reported only when its terminal executable
/// exists. No Wine settings apply, and the Windows path is the host path.
fn windows_installation(
    install_folder: &str,
    probe: &impl InstallProbe,
) -> Option<Mt5Installation> {
    let terminal_exe_windows = windows_child_path(install_folder, TERMINAL_EXE_FILE);
    if !probe.is_file(Path::new(&terminal_exe_windows)) {
        return None;
    }
    Some(Mt5Installation {
        host: HostPlatform::Windows,
        wine_prefix: None,
        wine_binary: None,
        terminal_exe_windows,
        source: InstallationSource::Discovered,
    })
}

/// Native Windows installations, the default folder before the broker-branded
/// ones.
fn windows_installations(
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Vec<Mt5Installation> {
    let program_files = program_files_folder(env);
    windows_install_folders(&program_files, probe)
        .into_iter()
        .filter_map(|install_folder| {
            let install_folder = windows_child_path(&program_files, &install_folder);
            windows_installation(&install_folder, probe)
        })
        .collect()
}

/// Every usable MT5 installation on `host_os`, in a deterministic order.
///
/// A configured `MT5_TERMINAL_EXE` is reported alone: the environment is an
/// override, so a default can never replace the user's choice. Otherwise only the
/// defaults whose files exist are reported, so a machine without MT5 yields an
/// empty list instead of a guessed path.
pub fn discover_installations(
    env: &dyn Fn(&str) -> Option<String>,
    host_os: HostOs,
) -> Vec<Mt5Installation> {
    discover_installations_with(env, host_os, &HostProbe)
}

/// Core of [`discover_installations`] with an injected [`InstallProbe`], so every
/// operating-system branch runs in the unit tests.
pub fn discover_installations_with(
    env: &dyn Fn(&str) -> Option<String>,
    host_os: HostOs,
    probe: &impl InstallProbe,
) -> Vec<Mt5Installation> {
    if let Some(configured) = configured_installation(env, host_os) {
        return vec![configured];
    }
    match host_os {
        HostOs::Windows => windows_installations(env, probe),
        HostOs::MacOs => macos_installation(env, probe).into_iter().collect(),
        HostOs::Linux => linux_installations(env, probe),
    }
}
