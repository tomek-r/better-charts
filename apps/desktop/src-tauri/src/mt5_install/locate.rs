//! Locate the MQL5 data folders of an MT5 installation, and any existing copy of
//! the two MQL5 files the app ships.
//!
//! MT5 supports two data-folder layouts:
//!
//! * portable — the data folder *is* the install folder, so `MQL5` sits beside
//!   `terminal64.exe`. The bundled macOS application always uses this one.
//! * standard — the data folder is `%APPDATA%\MetaQuotes\Terminal\<id>`, and an
//!   `origin.txt` inside it records the install folder it belongs to.
//!
//! On macOS and Linux the same trees live inside the Wine prefix: the install
//! folder under `drive_c/`, the standard roots under
//! `drive_c/users/<user>/AppData/Roaming/MetaQuotes/Terminal/`.
//!
//! Privacy: this module reads `origin.txt` and directory listings only. Every
//! other file below an MT5 folder stays closed, because those folders also hold
//! account state, logs, and journal files that are private to the user.
//!
//! Fail-closed throughout: an unusable configuration, an unreadable folder, or
//! an unexpected encoding yields "nothing found" instead of a guessed path, so a
//! later install step can never write into the wrong folder.

use std::collections::VecDeque;
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use super::discover::{host_platform, HostOs};
use crate::download_resources::{EXPERT_ADVISOR_RESOURCE, INDICATOR_RESOURCE};
use crate::mt5_backend::Mt5BackendConfig;

/// Drive a Wine prefix maps to `drive_c`. Only `C:` is guaranteed to exist inside
/// a prefix, so any other drive is unresolvable under Wine; native Windows
/// accepts every drive letter.
const WINE_DRIVE: char = 'c';
/// Separator of the Windows paths the configuration and `origin.txt` carry.
pub(super) const WINDOWS_FOLDER_SEPARATOR: char = '\\';
/// Folder a Wine prefix maps to drive `C:`.
pub(super) const WINE_DRIVE_C: &str = "drive_c";
/// Folder of a Wine prefix that holds the Windows user profiles.
const WINE_USERS: &str = "users";
/// Folder below a Windows user profile that holds the standard data folders; the
/// Wine prefix has no `%APPDATA%`, so its profiles are walked from here.
const PROFILE_TERMINALS_ROOT: [&str; 4] = ["AppData", "Roaming", "MetaQuotes", "Terminal"];
/// The same folder below `%APPDATA%`, which already ends in `AppData\Roaming`.
const APPDATA_TERMINALS_ROOT: [&str; 2] = ["MetaQuotes", "Terminal"];
/// Environment variable of the roaming profile folder on Windows.
const APPDATA_VARIABLE: &str = "APPDATA";
/// Folder MT5 keeps terminal-wide data in.
const MQL5_FOLDER: &str = "MQL5";
/// File MT5 writes beside a standard data folder: the install folder it belongs
/// to, which is how a data folder is attributed to an installation.
const ORIGIN_FILE: &str = "origin.txt";
/// `origin.txt` is UTF-16LE with a byte-order mark; the decoder tolerates UTF-8
/// because the format is undocumented and an editor may rewrite it.
const UTF16_LE_BOM: [u8; 2] = [0xff, 0xfe];
const UTF8_BOM: [u8; 3] = [0xef, 0xbb, 0xbf];
const UTF16_CODE_UNIT_BYTES: usize = 2;
/// Prefix of the bundled MQL5 resources; the remainder is the path inside the
/// data folder's `MQL5` folder.
const MQL5_RESOURCE_PREFIX: &str = "mql5/";
/// Sub-folder of `Experts` the advisor is installed into: MT5's own folder for
/// expert advisors, where MetaQuotes' sample advisors live too.
pub const EXPERT_ADVISOR_SUB_FOLDER: &str = "Advisors";
/// The shipped sources sit one or two folders below their MT5 root; the bound
/// only stops a pathological tree from stalling the caller.
pub(crate) const MAX_FOLDER_DEPTH: usize = 4;

/// Host a Windows path is resolved on. Passed as data so the native and the Wine
/// mapping are both unit-tested on any operating system.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostPlatform {
    /// Windows: the Windows path is a host path already.
    Windows,
    /// macOS or Linux: the path is resolved inside the Wine prefix.
    Wine,
}

/// The operating system this process runs on. The only place that looks at the
/// compile-time target, so every mapping function below stays pure.
pub(super) fn current_host_os() -> HostOs {
    if cfg!(windows) {
        HostOs::Windows
    } else if cfg!(target_os = "macos") {
        HostOs::MacOs
    } else {
        HostOs::Linux
    }
}

/// The host a Windows path is resolved on for this operating system.
fn current_host() -> HostPlatform {
    host_platform(current_host_os())
}

/// What the locator needs to know about an installation. Implemented by the
/// explicit backend configuration and by an installation that
/// [`super::discover`] found, so both reach the same path mapping.
pub trait InstallationLocation {
    /// Host the Windows paths of this installation are resolved on.
    fn host(&self) -> HostPlatform;
    /// Wine prefix holding `drive_c`; empty when the installation has none.
    fn wine_prefix(&self) -> &Path;
    /// Windows path of the terminal executable.
    fn terminal_exe_windows(&self) -> &str;
}

impl InstallationLocation for Mt5BackendConfig {
    fn host(&self) -> HostPlatform {
        current_host()
    }

    fn wine_prefix(&self) -> &Path {
        &self.wine_prefix
    }

    fn terminal_exe_windows(&self) -> &str {
        &self.terminal_exe_windows
    }
}

/// Splits `C:\folder\file.exe` into its drive letter and the path after `C:`,
/// or `None` for a path without a drive letter (relative paths and UNC shares).
fn split_drive(windows_path: &str) -> Option<(char, &str)> {
    let mut characters = windows_path.char_indices();
    let (_, drive) = characters.next()?;
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    // `char_indices` locates the separator, so the remainder never needs a byte
    // offset that could split a multi-byte character.
    let (separator_index, separator) = characters.next()?;
    if separator != ':' {
        return None;
    }
    Some((drive, windows_path.get(separator_index + 1..)?))
}

/// Body segments of a Windows path. Both separators are accepted because the
/// configuration and `origin.txt` reach the app through different Windows APIs.
fn path_segments(windows_path: &str) -> impl Iterator<Item = &str> {
    windows_path
        .split(['\\', '/'])
        .filter(|segment| !segment.is_empty())
}

/// Maps a configured Windows path onto the host filesystem: unchanged on
/// Windows for any drive letter, and `drive_c`-relative inside the Wine prefix
/// elsewhere, where only `C:` exists.
///
/// Returns `None` for an empty path, a path without a drive letter, a non-`C:`
/// drive under Wine, and a Wine path without a prefix — nothing that can be
/// resolved.
pub fn windows_path_on_host(
    windows_path: &str,
    host: HostPlatform,
    wine_prefix: &Path,
) -> Option<PathBuf> {
    let trimmed = windows_path.trim();
    let (drive, body) = split_drive(trimmed)?;
    match host {
        HostPlatform::Windows => Some(PathBuf::from(trimmed)),
        HostPlatform::Wine if !drive.eq_ignore_ascii_case(&WINE_DRIVE) => None,
        HostPlatform::Wine if wine_prefix.as_os_str().is_empty() => None,
        HostPlatform::Wine => {
            let mut host_path = wine_prefix.join(WINE_DRIVE_C);
            host_path.extend(path_segments(body));
            Some(host_path)
        }
    }
}

/// Folder holding the installation's `terminal64.exe`, which is the install
/// folder and therefore the parent of a portable data folder. The path is
/// resolved on the installation's host: unchanged on Windows, inside the Wine
/// prefix elsewhere.
pub fn install_dir(installation: &impl InstallationLocation) -> Option<PathBuf> {
    let terminal_exe = windows_path_on_host(
        installation.terminal_exe_windows(),
        installation.host(),
        installation.wine_prefix(),
    )?;
    terminal_exe.parent().map(Path::to_path_buf)
}

/// Portability of a data folder: where MT5 keeps its `MQL5` folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    /// `MQL5` sits beside the terminal executable, so the install folder is the
    /// data folder.
    Portable,
    /// `MQL5` lives in a per-installation folder under the terminals root.
    Standard,
}

/// A data folder that belongs to the configured installation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataFolder {
    pub mql5: PathBuf,
    pub layout: Layout,
}

/// Windows form of a folder path, which is what `origin.txt` records: a path that
/// already starts with a drive letter is a Windows path, and a path below a Wine
/// prefix's `drive_c` maps back to drive `C:`. A folder outside any prefix keeps
/// its host form and therefore matches no installation.
fn windows_folder_form(folder: &Path) -> String {
    let host_form = folder.to_string_lossy();
    if split_drive(&host_form).is_some() {
        return host_form.into_owned();
    }
    let Some(drive_position) = drive_c_position(folder) else {
        return host_form.into_owned();
    };
    windows_form_below(folder, drive_position)
}

/// Position of the deepest `drive_c` folder of `folder`. The deepest one wins, so a
/// prefix stored in a folder that happens to be called `drive_c` still maps to the
/// right drive.
fn drive_c_position(folder: &Path) -> Option<usize> {
    let parts: Vec<&OsStr> = folder.iter().collect();
    parts
        .iter()
        .rposition(|part| part.eq_ignore_ascii_case(WINE_DRIVE_C))
}

/// `folder` below the `drive_c` at `drive_position`, in the Windows form MT5 uses:
/// drive `C:` followed by every remaining folder.
fn windows_form_below(folder: &Path, drive_position: usize) -> String {
    let mut windows_form = format!("{}:", WINE_DRIVE.to_ascii_uppercase());
    for part in folder.iter().skip(drive_position + 1) {
        windows_form.push(WINDOWS_FOLDER_SEPARATOR);
        windows_form.push_str(&part.to_string_lossy());
    }
    windows_form
}

/// A host path below a Wine prefix's `drive_c`, as the prefix it belongs to and the
/// Windows path MT5 knows the file by. `None` for a path outside every prefix, which
/// no Wine installation can address.
pub(super) fn wine_path_form(path: &Path) -> Option<(PathBuf, String)> {
    let drive_position = drive_c_position(path)?;
    let wine_prefix = path.iter().take(drive_position).collect();
    Some((wine_prefix, windows_form_below(path, drive_position)))
}

/// Comparison form of a Windows folder path: separators are interchangeable,
/// case is ignored, and trailing separators carry no meaning.
fn windows_folder_key(windows_folder: &str) -> String {
    let mut key: String = windows_folder
        .trim()
        .chars()
        .map(|character| match character {
            '/' => WINDOWS_FOLDER_SEPARATOR,
            other => other.to_ascii_lowercase(),
        })
        .collect();
    while key.ends_with(WINDOWS_FOLDER_SEPARATOR) {
        key.pop();
    }
    key
}

/// Directory entries in name order: `read_dir` order is unspecified, and every
/// match this module reports must be deterministic.
fn sorted_entries(folder: &Path) -> Vec<fs::DirEntry> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut listed: Vec<fs::DirEntry> = entries.filter_map(Result::ok).collect();
    listed.sort_by_key(fs::DirEntry::file_name);
    listed
}

/// Sub-folders of `folder` in name order. `DirEntry::file_type` never follows a
/// symbolic link, so a linked folder is neither reported nor searched.
pub(super) fn sorted_folders(folder: &Path) -> Vec<PathBuf> {
    sorted_entries(folder)
        .into_iter()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect()
}

/// Decodes `origin.txt`: UTF-16LE when a byte-order mark says so, UTF-8
/// otherwise. This is the only file the module reads.
fn decode_origin_file(origin_file: &Path) -> Option<String> {
    fs::read(origin_file)
        .ok()
        .map(|bytes| decode_origin_text(&bytes))
}

fn decode_origin_text(bytes: &[u8]) -> String {
    if let Some(body) = bytes.strip_prefix(UTF16_LE_BOM.as_slice()) {
        let code_units: Vec<u16> = body
            .chunks_exact(UTF16_CODE_UNIT_BYTES)
            .filter_map(|unit| <[u8; UTF16_CODE_UNIT_BYTES]>::try_from(unit).ok())
            .map(u16::from_le_bytes)
            .collect();
        return String::from_utf16_lossy(&code_units);
    }
    let body = bytes.strip_prefix(UTF8_BOM.as_slice()).unwrap_or(bytes);
    String::from_utf8_lossy(body).into_owned()
}

/// Whether a standard data folder belongs to the installation: its `origin.txt`
/// names the install folder.
fn origin_matches(data_folder: &Path, install_folder_key: &str) -> bool {
    let origin_file = data_folder.join(ORIGIN_FILE);
    decode_origin_file(&origin_file)
        .is_some_and(|origin| windows_folder_key(&origin) == install_folder_key)
}

/// Portable installs keep `MQL5` beside the terminal executable, so the install
/// folder is the data folder.
fn portable_data_folder(install_folder: &Path) -> Option<DataFolder> {
    let mql5 = install_folder.join(MQL5_FOLDER);
    if !mql5.is_dir() {
        return None;
    }
    Some(DataFolder {
        mql5,
        layout: Layout::Portable,
    })
}

/// Standard installs keep `MQL5` in a per-installation folder whose `origin.txt`
/// names the install folder it belongs to.
fn standard_data_folders(install_folder_key: &str, terminals_root: &Path) -> Vec<DataFolder> {
    sorted_folders(terminals_root)
        .into_iter()
        .filter(|data_folder| origin_matches(data_folder, install_folder_key))
        .map(|data_folder| DataFolder {
            mql5: data_folder.join(MQL5_FOLDER),
            layout: Layout::Standard,
        })
        .collect()
}

/// Data folders of one install folder: the portable one when `MQL5` sits beside
/// the terminal, otherwise every standard folder under the given roots whose
/// `origin.txt` names the install folder.
fn data_folders_under<'a>(
    install_folder: &Path,
    terminals_roots: impl IntoIterator<Item = &'a Path>,
) -> Vec<DataFolder> {
    if let Some(portable) = portable_data_folder(install_folder) {
        return vec![portable];
    }
    let install_folder_key = windows_folder_key(&windows_folder_form(install_folder));
    terminals_roots
        .into_iter()
        .flat_map(|terminals_root| standard_data_folders(&install_folder_key, terminals_root))
        .collect()
}

/// Data folders of `install_folder`, scanning `terminals_root` when the portable
/// layout does not apply.
///
/// A portable install never consults `terminals_root`: its terminal loads the
/// `MQL5` folder beside the executable, so a standard folder cannot be the one in
/// use.
///
/// Test entry point only: the commands resolve both inputs themselves through
/// [`locate_data_folders`].
#[cfg(test)]
pub fn data_folders(install_folder: &Path, terminals_root: Option<&Path>) -> Vec<DataFolder> {
    data_folders_under(install_folder, terminals_root)
}

/// `base` with `folders` pushed one by one, so each separator the path gains is
/// the host's own: `PathBuf::join` would keep a separator embedded in a longer
/// folder string verbatim on Windows.
pub(super) fn joined(base: &Path, folders: &[&str]) -> PathBuf {
    let mut path = base.to_path_buf();
    for &folder in folders {
        path.push(folder);
    }
    path
}

/// `%APPDATA%\MetaQuotes\Terminal`, when that folder exists.
pub(super) fn windows_terminals_root(app_data: Option<PathBuf>) -> Option<PathBuf> {
    let app_data = app_data?;
    let terminals_root = joined(&app_data, &APPDATA_TERMINALS_ROOT);
    terminals_root.is_dir().then_some(terminals_root)
}

/// Every Windows user profile of the prefix may carry its own terminals root;
/// they are listed in name order so repeated scans agree.
fn wine_terminals_roots(wine_prefix: &Path) -> Vec<PathBuf> {
    let profiles = wine_prefix.join(WINE_DRIVE_C).join(WINE_USERS);
    sorted_folders(&profiles)
        .into_iter()
        .map(|profile| joined(&profile, &PROFILE_TERMINALS_ROOT))
        .filter(|terminals_root| terminals_root.is_dir())
        .collect()
}

/// Roots of the standard layout: `%APPDATA%\MetaQuotes\Terminal` on Windows and
/// one root per Wine user profile on macOS/Linux. Empty when the installation has
/// no prefix, which reports no standard data folder instead of a guessed one.
pub fn terminals_roots(installation: &impl InstallationLocation) -> Vec<PathBuf> {
    match installation.host() {
        HostPlatform::Windows => {
            let app_data = env::var_os(APPDATA_VARIABLE).map(PathBuf::from);
            windows_terminals_root(app_data).into_iter().collect()
        }
        HostPlatform::Wine => wine_terminals_roots(installation.wine_prefix()),
    }
}

/// Every data folder of `installation`, for the host its paths are resolved on.
pub fn locate_data_folders(installation: &impl InstallationLocation) -> Vec<DataFolder> {
    let Some(install_folder) = install_dir(installation) else {
        return Vec::new();
    };
    let roots = terminals_roots(installation);
    data_folders_under(&install_folder, roots.iter().map(PathBuf::as_path))
}

/// The MQL5 files the app ships, told apart by the MT5 folder that runs them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mql5File {
    /// Bridge expert advisor, loaded from `Experts/Advisors`.
    ExpertAdvisor,
    /// Tick history reader, loaded from `Indicators`.
    Indicator,
}

impl Mql5File {
    /// Bundled resource that provides the source, so the shipped file name and
    /// its MT5 folder are defined once, in `download_resources`.
    fn resource(self) -> &'static str {
        match self {
            Self::ExpertAdvisor => EXPERT_ADVISOR_RESOURCE,
            Self::Indicator => INDICATOR_RESOURCE,
        }
    }
}

/// Folder below `MQL5` and file name of a bundled resource:
/// `mql5/Experts/BetterChartsBridge.mq5` becomes
/// (`Experts`, `BetterChartsBridge.mq5`).
fn install_location(file: Mql5File) -> Option<(&'static str, &'static str)> {
    file.resource()
        .strip_prefix(MQL5_RESOURCE_PREFIX)?
        .rsplit_once('/')
}

/// First file named `file_name` below `folder`, in traversal order: breadth
/// first, and every folder listed in name order, so the shallowest copy comes
/// first and repeated scans report the same copy. `DirEntry::file_type` never
/// follows a symbolic link, so a linked file or folder is neither reported nor
/// searched.
fn first_matching_file(folder: &Path, file_name: &str) -> Option<PathBuf> {
    let mut pending = VecDeque::from([(folder.to_path_buf(), 0)]);
    while let Some((current, depth)) = pending.pop_front() {
        for entry in sorted_entries(&current) {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_file() && entry.file_name().as_os_str() == OsStr::new(file_name) {
                return Some(entry.path());
            }
            if kind.is_dir() && depth < MAX_FOLDER_DEPTH {
                pending.push_back((entry.path(), depth + 1));
            }
        }
    }
    None
}

/// Existing copy of `file` below the data folder's `MQL5` folder, if there is one:
/// the shallowest copy, because [`first_matching_file`] searches breadth first.
///
/// An older install may have left a copy anywhere below the file's own MT5 folder,
/// in the `Experts` root or in a folder such as the `Experts/Advisors` the install
/// writes to, so the whole subtree is searched. Only the shipped file name is
/// reported, so no other expert advisor or indicator can ever be matched.
pub fn existing_copy(mql5: &Path, file: Mql5File) -> Option<PathBuf> {
    let (folder, file_name) = install_location(file)?;
    first_matching_file(&mql5.join(folder), file_name)
}

/// Folder below `MQL5` the install writes `file` to: the advisor's own folder
/// inside `Experts`, the indicator's folder unchanged.
fn install_folder(mql5: &Path, file: Mql5File) -> Option<PathBuf> {
    let (folder, _) = install_location(file)?;
    let shipped_folder = mql5.join(folder);
    Some(match file {
        Mql5File::ExpertAdvisor => shipped_folder.join(EXPERT_ADVISOR_SUB_FOLDER),
        Mql5File::Indicator => shipped_folder,
    })
}

/// Path the install writes `file` to: MT5's own folder for it, for example
/// `<mql5>/Experts/Advisors/BetterChartsBridge.mq5` for the advisor and
/// `<mql5>/Indicators/BetterChartsTickHistoryReader.mq5` for the indicator.
pub fn default_path(mql5: &Path, file: Mql5File) -> Option<PathBuf> {
    let (_, file_name) = install_location(file)?;
    Some(install_folder(mql5, file)?.join(file_name))
}
