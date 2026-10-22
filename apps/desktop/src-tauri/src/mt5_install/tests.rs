use super::commands::*;
use super::compile::*;
use super::discover::*;
use super::install::*;
use super::locate::*;
use super::restart::*;
use crate::execution_adapter::ExecutionQueueView;
use crate::mt5_backend::{is_configured, Mt5BackendConfig, ProcessCheck};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const TERMINAL_EXE: &str = "C:\\Program Files\\MetaTrader 5\\terminal64.exe";
const INSTALL_FOLDER_WINDOWS: &str = "C:\\Program Files\\MetaTrader 5";
/// The install folder as it sits inside a Wine prefix.
const INSTALL_FOLDER_IN_PREFIX: &str = "drive_c/Program Files/MetaTrader 5";
/// Data folder names as MT5 generates them: 32 hexadecimal characters.
const DATA_FOLDER_ID: &str = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const OTHER_DATA_FOLDER_ID: &str = "B2C3D4E5F60718293A4B5C6D7E8F90A1";
const EXPERT_ADVISOR_FILE: &str = "BetterChartsBridge.mq5";
const INDICATOR_FILE: &str = "BetterChartsTickHistoryReader.mq5";
/// Standard terminals root inside a test folder.
const TEST_TERMINALS_ROOT: &str = "roaming/MetaQuotes/Terminal";

/// Joins a '/'-separated relative constant component by component, so the result
/// uses the host separator and equals the path the code under test builds.
fn join_relative(base: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .fold(base.to_path_buf(), |path, part| path.join(part))
}

/// Test folders must be unique: the suite runs in parallel and every test shares
/// the process id. The counter keeps the name unique within one process.
static NEXT_FOLDER: AtomicU64 = AtomicU64::new(0);

/// Temporary folder that removes itself, so a failing assertion leaves no
/// MT5-shaped trees in the system temp folder.
struct TempFolder(PathBuf);

impl TempFolder {
    fn new(label: &str) -> Self {
        let unique = NEXT_FOLDER.fetch_add(1, Ordering::Relaxed);
        let name = format!("mt5-install-{label}-{}-{unique}", std::process::id());
        let path = std::env::temp_dir().join(name);
        fs::create_dir_all(&path).expect("test folder is creatable");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// Creates and returns a folder below the temporary folder.
    fn folder(&self, relative: &str) -> PathBuf {
        let folder = join_relative(&self.0, relative);
        create_folder(&folder);
        folder
    }
}

/// Creates `folder`, failing the test when it cannot be created.
fn create_folder(folder: &Path) {
    fs::create_dir_all(folder).expect("test folder is creatable");
}

impl Drop for TempFolder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn config_with_terminal(wine_prefix: &Path) -> Mt5BackendConfig {
    Mt5BackendConfig {
        wine_prefix: wine_prefix.to_path_buf(),
        wine_binary: PathBuf::from("wine"),
        terminal_exe_windows: TERMINAL_EXE.to_string(),
        config_ini_windows: None,
        enabled: false,
    }
}

fn unconfigured() -> Mt5BackendConfig {
    Mt5BackendConfig {
        wine_prefix: PathBuf::new(),
        wine_binary: PathBuf::from("wine"),
        terminal_exe_windows: String::new(),
        config_ini_windows: None,
        enabled: false,
    }
}

/// `origin.txt` as MT5 writes it: UTF-16LE behind a byte-order mark.
fn utf16_le_with_bom(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xfe];
    for code_unit in text.encode_utf16() {
        bytes.extend_from_slice(&code_unit.to_le_bytes());
    }
    bytes
}

/// Creates a standard data folder whose `origin.txt` holds `origin_bytes`.
fn create_standard_data_folder(terminals_root: &Path, origin_bytes: &[u8]) -> PathBuf {
    let data_folder = terminals_root.join(DATA_FOLDER_ID);
    fs::create_dir_all(data_folder.join("MQL5")).expect("data folder is creatable");
    fs::write(data_folder.join("origin.txt"), origin_bytes).expect("origin is writable");
    data_folder
}

fn expected_standard_folder(data_folder: &Path) -> DataFolder {
    DataFolder {
        mql5: data_folder.join("MQL5"),
        layout: Layout::Standard,
    }
}

fn expected_portable_folder(mql5: &Path) -> DataFolder {
    DataFolder {
        mql5: mql5.to_path_buf(),
        layout: Layout::Portable,
    }
}

#[test]
fn wine_mapping_places_the_windows_path_under_drive_c() {
    let wine_prefix = Path::new("/Users/trader/.wine");
    let expected = wine_prefix
        .join("drive_c")
        .join("Program Files")
        .join("MetaTrader 5")
        .join("terminal64.exe");
    let mapped = windows_path_on_host(TERMINAL_EXE, HostPlatform::Wine, wine_prefix);
    assert_eq!(mapped, Some(expected));

    // The drive letter is case-insensitive and forward slashes already work.
    let other_form = "c:/Program Files/MetaTrader 5/terminal64.exe";
    let mapped_again = windows_path_on_host(other_form, HostPlatform::Wine, wine_prefix);
    assert_eq!(mapped_again, mapped);
}

#[test]
fn windows_mapping_keeps_the_configured_path() {
    let mapped = windows_path_on_host(TERMINAL_EXE, HostPlatform::Windows, Path::new(""));
    assert_eq!(mapped, Some(PathBuf::from(TERMINAL_EXE)));
}

#[test]
fn another_drive_resolves_natively_but_not_under_wine() {
    let terminal_exe = "D:\\MetaTrader 5\\terminal64.exe";
    let native = windows_path_on_host(terminal_exe, HostPlatform::Windows, Path::new(""));
    assert_eq!(native, Some(PathBuf::from(terminal_exe)));

    let wine_prefix = Path::new("/Users/trader/.wine");
    let under_wine = windows_path_on_host(terminal_exe, HostPlatform::Wine, wine_prefix);
    assert_eq!(under_wine, None, "only drive C: exists inside the prefix");
}

#[test]
fn unsupported_paths_have_no_host_folder() {
    let wine_prefix = Path::new("/Users/trader/.wine");
    let rejected = [
        "",
        "   ",
        "terminal64.exe",
        "\\Program Files\\terminal64.exe",
        "\\\\server\\share\\terminal64.exe",
    ];
    for windows_path in rejected {
        let under_wine = windows_path_on_host(windows_path, HostPlatform::Wine, wine_prefix);
        assert_eq!(
            under_wine, None,
            "{windows_path:?} must not resolve under Wine"
        );
        let native = windows_path_on_host(windows_path, HostPlatform::Windows, Path::new(""));
        assert_eq!(native, None, "{windows_path:?} must not resolve natively");
    }
    let without_prefix = windows_path_on_host(TERMINAL_EXE, HostPlatform::Wine, Path::new(""));
    assert_eq!(without_prefix, None, "a Wine path needs a prefix");
}

#[cfg(not(windows))]
#[test]
fn install_dir_is_the_wine_folder_of_the_configured_terminal() {
    let fixture = TempFolder::new("install-dir");
    let expected = join_relative(fixture.path(), INSTALL_FOLDER_IN_PREFIX);
    let config = config_with_terminal(fixture.path());
    assert_eq!(install_dir(&config), Some(expected));
}

#[cfg(windows)]
#[test]
fn install_dir_is_the_native_folder_of_the_configured_terminal() {
    let config = config_with_terminal(Path::new(""));
    assert_eq!(
        install_dir(&config),
        Some(PathBuf::from(INSTALL_FOLDER_WINDOWS))
    );
}

#[test]
fn unconfigured_installations_have_no_data_folder() {
    let config = unconfigured();
    assert_eq!(install_dir(&config), None);
    assert!(locate_data_folders(&config).is_empty());
}

#[test]
fn portable_layout_is_the_install_folder_itself() {
    let fixture = TempFolder::new("portable");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let mql5 = fixture.folder(&format!("{INSTALL_FOLDER_IN_PREFIX}/MQL5"));
    // A matching standard data folder is ignored: a portable terminal loads the
    // MQL5 folder beside its executable.
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    create_standard_data_folder(&terminals_root, &utf16_le_with_bom(INSTALL_FOLDER_WINDOWS));

    let found = data_folders(&install_folder, Some(terminals_root.as_path()));
    assert_eq!(found, vec![expected_portable_folder(&mql5)]);
}

/// The install folder as `origin.txt` records it. Under Wine the fixture folder
/// maps to the `C:` form; natively it already carries its own drive letter.
#[cfg(windows)]
fn origin_of(install_folder: &Path) -> String {
    install_folder.to_string_lossy().into_owned()
}

#[cfg(not(windows))]
fn origin_of(_install_folder: &Path) -> String {
    INSTALL_FOLDER_WINDOWS.to_string()
}

#[test]
fn standard_layout_reads_a_utf16_origin_file() {
    let fixture = TempFolder::new("standard-utf16");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    // Trailing separator and line break, as MT5 writes them.
    let origin = format!("{}\\\r\n", origin_of(&install_folder));
    let data_folder = create_standard_data_folder(&terminals_root, &utf16_le_with_bom(&origin));

    let found = data_folders(&install_folder, Some(terminals_root.as_path()));
    assert_eq!(found, vec![expected_standard_folder(&data_folder)]);
}

#[test]
fn standard_layout_accepts_a_utf8_origin_file() {
    let fixture = TempFolder::new("standard-utf8");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    // Separators and letter case are ignored when the origin is compared.
    let folder_form = origin_of(&install_folder).to_lowercase().replace('\\', "/");
    let origin = format!("{folder_form}\r\n");
    let data_folder = create_standard_data_folder(&terminals_root, origin.as_bytes());

    let found = data_folders(&install_folder, Some(terminals_root.as_path()));
    assert_eq!(found, vec![expected_standard_folder(&data_folder)]);
}

#[test]
fn standard_layout_ignores_other_installations() {
    let fixture = TempFolder::new("standard-other");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    let meta_trader_4 = utf16_le_with_bom("C:\\Program Files\\MetaTrader 4\\");
    create_standard_data_folder(&terminals_root, &meta_trader_4);
    // A data folder without an origin file belongs to no installation either.
    let other_folder = terminals_root.join(OTHER_DATA_FOLDER_ID).join("MQL5");
    create_folder(&other_folder);

    assert!(data_folders(&install_folder, Some(terminals_root.as_path())).is_empty());
    assert!(data_folders(&install_folder, None).is_empty());
}

#[test]
fn standard_layout_matches_a_windows_install_folder() {
    let fixture = TempFolder::new("standard-native");
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    let origin = utf16_le_with_bom(INSTALL_FOLDER_WINDOWS);
    let data_folder = create_standard_data_folder(&terminals_root, &origin);
    let install_folder = Path::new(INSTALL_FOLDER_WINDOWS);

    let found = data_folders(install_folder, Some(terminals_root.as_path()));
    assert_eq!(found, vec![expected_standard_folder(&data_folder)]);
}

#[test]
fn existing_copy_finds_the_shipped_files_in_sub_folders() {
    let fixture = TempFolder::new("existing-copy");
    // The verified installation keeps the advisor one level below `Experts`.
    let advisor = fixture
        .folder("MQL5/Experts/Advisors")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&advisor, "// advisor\n").expect("advisor copy is writable");
    let indicator = fixture.folder("MQL5/Indicators").join(INDICATOR_FILE);
    fs::write(&indicator, "// indicator\n").expect("indicator copy is writable");
    let mql5 = fixture.path().join("MQL5");

    assert_eq!(existing_copy(&mql5, Mql5File::ExpertAdvisor), Some(advisor));
    assert_eq!(existing_copy(&mql5, Mql5File::Indicator), Some(indicator));
}

#[test]
fn existing_copy_prefers_the_shallowest_copy() {
    let fixture = TempFolder::new("shallowest");
    let shallow = fixture.folder("MQL5/Experts").join(EXPERT_ADVISOR_FILE);
    fs::write(&shallow, "// shallow\n").expect("shallow copy is writable");
    let deeper = fixture
        .folder("MQL5/Experts/Advisors")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&deeper, "// deeper\n").expect("deeper copy is writable");
    let mql5 = fixture.path().join("MQL5");

    assert_eq!(existing_copy(&mql5, Mql5File::ExpertAdvisor), Some(shallow));
}

#[test]
fn existing_copy_reports_the_first_folder_in_name_order() {
    let fixture = TempFolder::new("name-order");
    let advisors = fixture
        .folder("MQL5/Experts/Advisors")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&advisors, "// advisors\n").expect("advisor copy is writable");
    let zulu = fixture
        .folder("MQL5/Experts/Zulu")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&zulu, "// zulu\n").expect("second copy is writable");
    let mql5 = fixture.path().join("MQL5");

    assert_eq!(
        existing_copy(&mql5, Mql5File::ExpertAdvisor),
        Some(advisors)
    );
}

#[test]
fn every_copy_reports_all_copies_in_name_order() {
    let fixture = TempFolder::new("every-copy");
    let advisors = fixture
        .folder("MQL5/Experts/Advisors")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&advisors, "// advisors\n").expect("advisor copy is writable");
    let zulu = fixture
        .folder("MQL5/Experts/Zulu")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&zulu, "// zulu\n").expect("second copy is writable");
    let mql5 = fixture.path().join("MQL5");

    assert_eq!(
        every_copy(&mql5, Mql5File::ExpertAdvisor),
        vec![advisors, zulu]
    );
    assert!(every_copy(&mql5, Mql5File::Indicator).is_empty());
}

#[test]
fn existing_copy_reports_nothing_without_a_copy() {
    let fixture = TempFolder::new("no-copy");
    create_folder(&fixture.path().join("MQL5/Experts/Advisors"));
    let elsewhere = fixture.folder("MQL5/Files").join(EXPERT_ADVISOR_FILE);
    fs::write(&elsewhere, "// elsewhere\n").expect("copy is writable");
    let mql5 = fixture.path().join("MQL5");

    // The search stays inside its own MT5 folder: the same name in `MQL5/Files`
    // is not a copy MT5 would load.
    assert_eq!(existing_copy(&mql5, Mql5File::ExpertAdvisor), None);
    assert_eq!(existing_copy(&mql5, Mql5File::Indicator), None);
}

#[test]
fn existing_copy_stops_at_the_depth_bound() {
    let fixture = TempFolder::new("depth-bound");
    let mut deepest = fixture.folder("MQL5/Experts");
    for level in 1..=MAX_FOLDER_DEPTH + 1 {
        deepest = deepest.join(format!("Level{level}"));
    }
    create_folder(&deepest);
    let copy = deepest.join(EXPERT_ADVISOR_FILE);
    fs::write(&copy, "// beyond the bound\n").expect("deep copy is writable");
    let mql5 = fixture.path().join("MQL5");

    assert_eq!(existing_copy(&mql5, Mql5File::ExpertAdvisor), None);
}

#[cfg(unix)]
#[test]
fn existing_copy_does_not_follow_symlinks() {
    let fixture = TempFolder::new("symlink");
    let outside = fixture.folder("Outside");
    let outside_copy = outside.join(EXPERT_ADVISOR_FILE);
    fs::write(&outside_copy, "// outside\n").expect("outside copy is writable");
    let experts = fixture.folder("MQL5/Experts");
    let linked_folder = experts.join("Linked");
    std::os::unix::fs::symlink(&outside, &linked_folder).expect("folder link is allowed");
    std::os::unix::fs::symlink(&outside_copy, experts.join(EXPERT_ADVISOR_FILE))
        .expect("file link is allowed");
    let mql5 = fixture.path().join("MQL5");

    assert_eq!(existing_copy(&mql5, Mql5File::ExpertAdvisor), None);
}

#[cfg(not(windows))]
#[test]
fn wine_terminals_roots_lists_every_user_profile_in_name_order() {
    let fixture = TempFolder::new("profiles");
    let second = fixture.folder("drive_c/users/trader/AppData/Roaming/MetaQuotes/Terminal");
    let first = fixture.folder("drive_c/users/analyst/AppData/Roaming/MetaQuotes/Terminal");
    // A profile without a terminals root contributes no root.
    create_folder(&fixture.path().join("drive_c/users/empty"));

    let roots = terminals_roots(&config_with_terminal(fixture.path()));
    assert_eq!(roots, vec![first, second]);
}

#[test]
fn windows_terminals_root_is_the_metaquotes_folder_directly_below_appdata() {
    let fixture = TempFolder::new("appdata");
    // `%APPDATA%` already ends in `AppData\Roaming`; a second `AppData\Roaming`
    // below it is not where MT5 writes its data folders.
    fixture.folder("AppData/Roaming/MetaQuotes/Terminal");
    let app_data = fixture.path().to_path_buf();
    assert_eq!(windows_terminals_root(Some(app_data.clone())), None);

    let terminals_root = fixture.folder("MetaQuotes/Terminal");
    assert_eq!(windows_terminals_root(Some(app_data)), Some(terminals_root));
    assert_eq!(windows_terminals_root(None), None);
}

#[cfg(not(windows))]
#[test]
fn locate_data_folders_follows_the_configured_installation() {
    let fixture = TempFolder::new("configured");
    let profile_terminals = "drive_c/users/trader/AppData/Roaming/MetaQuotes/Terminal";
    let terminals_root = fixture.folder(profile_terminals);
    let origin = utf16_le_with_bom(INSTALL_FOLDER_WINDOWS);
    let data_folder = create_standard_data_folder(&terminals_root, &origin);
    let config = config_with_terminal(fixture.path());

    let standard = locate_data_folders(&config);
    assert_eq!(standard, vec![expected_standard_folder(&data_folder)]);

    // Creating `MQL5` beside the terminal makes the installation portable, and
    // the standard folder is then no longer the one the terminal loads.
    let portable_mql5 = fixture.folder(&format!("{INSTALL_FOLDER_IN_PREFIX}/MQL5"));
    let portable = locate_data_folders(&config);
    assert_eq!(portable, vec![expected_portable_folder(&portable_mql5)]);
}

/// macOS defaults of the official application, verified on the owner's machine.
const MACOS_HOME: &str = "/Users/trader";
const MACOS_PREFIX: &str =
    "/Users/trader/Library/Application Support/net.metaquotes.wine.metatrader5";
const MACOS_WINE_BINARY: &str =
    "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine";
/// Linux defaults: the prefix MetaQuotes' installer creates, a plain Wine prefix,
/// and a `wine` binary on PATH.
const LINUX_HOME: &str = "/home/trader";
const LINUX_MT5_PREFIX: &str = "/home/trader/.mt5";
const LINUX_WINE_PREFIX: &str = "/home/trader/.wine";
const LINUX_PATH_FOLDER: &str = "/usr/local/bin";
const WINE_ON_PATH: &str = "/usr/local/bin/wine";
/// Windows default program folder and the broker-branded folders scanned below it.
const PROGRAM_FILES: &str = r"C:\Program Files";
const ACME_TERMINAL_EXE: &str = r"C:\Program Files\Acme MetaTrader 5\terminal64.exe";
const ZULU_TERMINAL_EXE: &str = r"C:\Program Files\Zulu MetaTrader 5\terminal64.exe";

/// Environment lookup over `pairs`; every other variable reads as unset.
fn env_map(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let pairs: Vec<(String, String)> = pairs
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    move |key: &str| {
        pairs
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    }
}

/// Host path of the default terminal inside a Wine prefix.
fn terminal_exe_in_prefix(wine_prefix: &str) -> PathBuf {
    windows_path_on_host(TERMINAL_EXE, HostPlatform::Wine, Path::new(wine_prefix))
        .expect("the default terminal path resolves inside a prefix")
}

fn discovered_wine_installation(wine_prefix: &str, wine_binary: &str) -> Mt5Installation {
    Mt5Installation {
        host: HostPlatform::Wine,
        wine_prefix: Some(PathBuf::from(wine_prefix)),
        wine_binary: Some(PathBuf::from(wine_binary)),
        terminal_exe_windows: TERMINAL_EXE.to_string(),
        source: InstallationSource::Discovered,
    }
}

fn discovered_windows_installation(terminal_exe_windows: &str) -> Mt5Installation {
    Mt5Installation {
        host: HostPlatform::Windows,
        wine_prefix: None,
        wine_binary: None,
        terminal_exe_windows: terminal_exe_windows.to_string(),
        source: InstallationSource::Discovered,
    }
}

/// Probe over a fixed picture of the disk, so all three operating systems are
/// tested on any host.
#[derive(Default)]
struct FakeProbe {
    files: BTreeSet<PathBuf>,
    folders: BTreeMap<PathBuf, Vec<String>>,
}

impl FakeProbe {
    /// Probe where exactly `files` exist and no folder is listed.
    fn with_files(files: impl IntoIterator<Item = PathBuf>) -> Self {
        Self {
            files: files.into_iter().collect(),
            folders: BTreeMap::new(),
        }
    }

    /// Adds `folder`, listing `names` in the name order the real probe produces.
    fn listing(mut self, folder: &str, names: &[&str]) -> Self {
        let names = names.iter().map(|name| (*name).to_string()).collect();
        self.folders.insert(PathBuf::from(folder), names);
        self
    }
}

impl InstallProbe for FakeProbe {
    fn is_file(&self, path: &Path) -> bool {
        self.files.contains(path)
    }

    fn folder_names(&self, folder: &Path) -> Vec<String> {
        self.folders.get(folder).cloned().unwrap_or_default()
    }
}

#[test]
fn macos_finds_the_official_application() {
    let probe = FakeProbe::with_files([
        terminal_exe_in_prefix(MACOS_PREFIX),
        PathBuf::from(MACOS_WINE_BINARY),
    ]);
    let env = env_map(&[("HOME", MACOS_HOME)]);

    assert_eq!(
        discover_installations_with(&env, HostOs::MacOs, &probe),
        vec![discovered_wine_installation(
            MACOS_PREFIX,
            MACOS_WINE_BINARY
        )]
    );
}

#[test]
fn macos_reports_nothing_when_the_application_is_incomplete() {
    let env = env_map(&[("HOME", MACOS_HOME)]);
    let without_wine = FakeProbe::with_files([terminal_exe_in_prefix(MACOS_PREFIX)]);
    assert!(discover_installations_with(&env, HostOs::MacOs, &without_wine).is_empty());

    let without_terminal = FakeProbe::with_files([PathBuf::from(MACOS_WINE_BINARY)]);
    assert!(discover_installations_with(&env, HostOs::MacOs, &without_terminal).is_empty());

    // Without a home folder neither default can be resolved.
    let complete = FakeProbe::with_files([
        terminal_exe_in_prefix(MACOS_PREFIX),
        PathBuf::from(MACOS_WINE_BINARY),
    ]);
    assert!(discover_installations_with(&env_map(&[]), HostOs::MacOs, &complete).is_empty());
}

#[test]
fn linux_probes_the_metaquotes_prefix_before_a_plain_wine_prefix() {
    let probe = FakeProbe::with_files([
        terminal_exe_in_prefix(LINUX_MT5_PREFIX),
        terminal_exe_in_prefix(LINUX_WINE_PREFIX),
        PathBuf::from(WINE_ON_PATH),
    ]);
    let env = env_map(&[("HOME", LINUX_HOME), ("PATH", LINUX_PATH_FOLDER)]);

    assert_eq!(
        discover_installations_with(&env, HostOs::Linux, &probe),
        vec![
            discovered_wine_installation(LINUX_MT5_PREFIX, WINE_ON_PATH),
            discovered_wine_installation(LINUX_WINE_PREFIX, WINE_ON_PATH),
        ]
    );
}

#[test]
fn linux_reports_nothing_without_a_wine_prefix() {
    let probe = FakeProbe::with_files([PathBuf::from(WINE_ON_PATH)]);
    let env = env_map(&[("HOME", LINUX_HOME), ("PATH", LINUX_PATH_FOLDER)]);

    assert!(discover_installations_with(&env, HostOs::Linux, &probe).is_empty());
}

#[test]
fn linux_reports_nothing_when_wine_is_not_on_path() {
    // Both prefixes look complete, but the bare `wine` that runs them is missing.
    let probe = FakeProbe::with_files([
        terminal_exe_in_prefix(LINUX_MT5_PREFIX),
        terminal_exe_in_prefix(LINUX_WINE_PREFIX),
    ]);
    let env = env_map(&[("HOME", LINUX_HOME), ("PATH", LINUX_PATH_FOLDER)]);

    assert!(discover_installations_with(&env, HostOs::Linux, &probe).is_empty());
}

#[test]
fn windows_finds_the_metaquotes_folder() {
    let probe = FakeProbe::with_files([PathBuf::from(TERMINAL_EXE)]);
    let env = env_map(&[("ProgramFiles", PROGRAM_FILES)]);

    assert_eq!(
        discover_installations_with(&env, HostOs::Windows, &probe),
        vec![discovered_windows_installation(TERMINAL_EXE)]
    );
}

#[test]
fn windows_scans_broker_folders_below_the_program_folder() {
    let probe = FakeProbe::with_files([
        PathBuf::from(TERMINAL_EXE),
        PathBuf::from(ACME_TERMINAL_EXE),
        PathBuf::from(ZULU_TERMINAL_EXE),
        PathBuf::from(r"C:\Program Files\Unrelated\tool.exe"),
    ]);
    // The real probe lists sub-folders in name order; the default folder is
    // listed too and must not be reported twice.
    let probe = probe.listing(
        PROGRAM_FILES,
        &[
            "Acme MetaTrader 5",
            "MetaTrader 5",
            "Unrelated",
            "Zulu MetaTrader 5",
        ],
    );
    let env = env_map(&[("ProgramFiles", PROGRAM_FILES)]);

    assert_eq!(
        discover_installations_with(&env, HostOs::Windows, &probe),
        vec![
            discovered_windows_installation(TERMINAL_EXE),
            discovered_windows_installation(ACME_TERMINAL_EXE),
            discovered_windows_installation(ZULU_TERMINAL_EXE),
        ]
    );
}

#[test]
fn windows_reports_nothing_when_no_terminal_exists() {
    let unrelated_tool = PathBuf::from(r"C:\Program Files\Unrelated\tool.exe");
    let probe = FakeProbe::with_files([unrelated_tool]);
    let probe = probe.listing(PROGRAM_FILES, &["Unrelated"]);
    let env = env_map(&[("ProgramFiles", PROGRAM_FILES)]);

    assert!(discover_installations_with(&env, HostOs::Windows, &probe).is_empty());
}

#[test]
fn a_configured_linux_installation_wins_over_the_defaults() {
    // The defaults are present, but the environment override is the only answer.
    let probe = FakeProbe::with_files([
        terminal_exe_in_prefix(LINUX_MT5_PREFIX),
        PathBuf::from(WINE_ON_PATH),
    ]);
    let env = env_map(&[
        ("HOME", LINUX_HOME),
        ("PATH", LINUX_PATH_FOLDER),
        ("MT5_WINE_PREFIX", "/custom/prefix"),
        ("MT5_WINE_BINARY", "/custom/wine"),
        ("MT5_TERMINAL_EXE", "D:\\Custom\\terminal64.exe"),
    ]);

    assert_eq!(
        discover_installations_with(&env, HostOs::Linux, &probe),
        vec![Mt5Installation {
            host: HostPlatform::Wine,
            wine_prefix: Some(PathBuf::from("/custom/prefix")),
            wine_binary: Some(PathBuf::from("/custom/wine")),
            terminal_exe_windows: "D:\\Custom\\terminal64.exe".to_string(),
            source: InstallationSource::Configured,
        }]
    );
}

#[test]
fn a_configured_windows_installation_carries_no_wine_settings() {
    let env = env_map(&[
        ("MT5_TERMINAL_EXE", "D:\\MetaTrader 5\\terminal64.exe"),
        // Nothing on Windows can use a Wine prefix, so it is not reported.
        ("MT5_WINE_PREFIX", "/ignored/prefix"),
        ("MT5_WINE_BINARY", "/ignored/wine"),
    ]);

    assert_eq!(
        discover_installations_with(&env, HostOs::Windows, &FakeProbe::default()),
        vec![Mt5Installation {
            host: HostPlatform::Windows,
            wine_prefix: None,
            wine_binary: None,
            terminal_exe_windows: "D:\\MetaTrader 5\\terminal64.exe".to_string(),
            source: InstallationSource::Configured,
        }]
    );
}

#[test]
fn a_blank_override_falls_back_to_discovery() {
    let probe = FakeProbe::with_files([PathBuf::from(TERMINAL_EXE)]);
    let env = env_map(&[("ProgramFiles", PROGRAM_FILES), ("MT5_TERMINAL_EXE", "  ")]);

    assert_eq!(
        discover_installations_with(&env, HostOs::Windows, &probe),
        vec![discovered_windows_installation(TERMINAL_EXE)]
    );
}

#[test]
fn a_discovered_installation_drives_the_locator() {
    // The locator reads both sources through one accessor; only the Wine mapping
    // is host independent, so the native case stays covered by its own test.
    let installation = discovered_wine_installation(LINUX_MT5_PREFIX, WINE_ON_PATH);

    assert_eq!(
        install_dir(&installation),
        Some(join_relative(
            Path::new(LINUX_MT5_PREFIX),
            INSTALL_FOLDER_IN_PREFIX
        ))
    );
}

#[test]
fn discovery_never_reaches_the_configuration_auto_start_reads() {
    let probe = FakeProbe::with_files([
        terminal_exe_in_prefix(LINUX_MT5_PREFIX),
        PathBuf::from(WINE_ON_PATH),
    ]);
    let env = env_map(&[("HOME", LINUX_HOME), ("PATH", LINUX_PATH_FOLDER)]);
    assert_eq!(
        discover_installations_with(&env, HostOs::Linux, &probe).len(),
        1
    );

    // The configuration auto-start is gated on stays unconfigured, so a
    // discovered terminal can never make an unconfigured machine start MT5.
    let config = Mt5BackendConfig::from_env_with(|_| None);
    assert!(!is_configured(&config));
}

/// Bundled sources the install tests copy; the app ships the same two file names.
const BUNDLED_ADVISOR_SOURCE: &str = "// bundled expert advisor\n";
const BUNDLED_INDICATOR_SOURCE: &str = "// bundled indicator\n";
/// Content of a destination copy an install has to replace.
const PREVIOUS_SOURCE: &str = "// previous version\n";
/// Folder holding the test's copy of the bundled resources.
const BUNDLED_RESOURCES_FOLDER: &str = "Resources/mql5";

/// Writes both bundled sources into the test folder, named as MT5 loads them, so
/// the only difference between a test's source and its destination is the folder
/// it sits in.
fn bundled_sources(fixture: &TempFolder) -> BundledSources {
    let resources = fixture.folder(BUNDLED_RESOURCES_FOLDER);
    let expert_advisor = resources.join(EXPERT_ADVISOR_FILE);
    fs::write(&expert_advisor, BUNDLED_ADVISOR_SOURCE).expect("bundled advisor is writable");
    let indicator = resources.join(INDICATOR_FILE);
    fs::write(&indicator, BUNDLED_INDICATOR_SOURCE).expect("bundled indicator is writable");
    BundledSources {
        expert_advisor,
        indicator,
    }
}

/// Queue view of a settled adapter: nothing queued and nothing in flight.
fn idle_queue() -> ExecutionQueueView {
    ExecutionQueueView {
        pending: 0,
        in_flight: None,
        dispatch_enabled: true,
        stranded: 0,
    }
}

fn installed_file(file: Mql5File, path: &Path, outcome: InstallOutcome) -> InstalledFile {
    InstalledFile {
        file,
        path: path.to_path_buf(),
        outcome,
    }
}

fn is_empty_folder(folder: &Path) -> bool {
    let mut entries = fs::read_dir(folder).expect("test folder is readable");
    entries.next().is_none()
}

#[test]
fn fresh_install_writes_both_files_to_the_default_folders() {
    let fixture = TempFolder::new("install-fresh");
    let mql5 = fixture.folder("MQL5");
    let indicator = mql5.join("Indicators").join(INDICATOR_FILE);
    let advisors = mql5.join("Experts").join(EXPERT_ADVISOR_SUB_FOLDER);
    let advisor = advisors.join(EXPERT_ADVISOR_FILE);

    let installed = install_bundled_sources(&bundled_sources(&fixture), &mql5, &idle_queue())
        .expect("a fresh install succeeds");

    // The indicator comes first: the advisor loads it through iCustom.
    assert_eq!(
        installed,
        vec![
            installed_file(Mql5File::Indicator, &indicator, InstallOutcome::Installed),
            installed_file(Mql5File::ExpertAdvisor, &advisor, InstallOutcome::Installed),
        ]
    );
    assert_eq!(
        fs::read_to_string(&indicator).expect("indicator is readable"),
        BUNDLED_INDICATOR_SOURCE
    );
    assert_eq!(
        fs::read_to_string(&advisor).expect("advisor is readable"),
        BUNDLED_ADVISOR_SOURCE
    );
}

#[test]
fn an_old_copy_in_the_experts_root_moves_to_the_advisors_folder() {
    let fixture = TempFolder::new("install-move");
    let mql5 = fixture.folder("MQL5");
    // An older install left the advisor in the `Experts` root, where MT5 keeps the
    // sources it ships itself.
    let experts = fixture.folder("MQL5/Experts");
    let old_copy = experts.join(EXPERT_ADVISOR_FILE);
    fs::write(&old_copy, PREVIOUS_SOURCE).expect("previous advisor copy is writable");
    let compiled = old_copy.with_extension("ex5");
    fs::write(&compiled, "// compiled\n").expect("compiled advisor is writable");
    let log = old_copy.with_extension("log");
    fs::write(&log, "// log\n").expect("advisor log is writable");
    let unrelated = experts.join("Other.mq5");
    fs::write(&unrelated, PREVIOUS_SOURCE).expect("unrelated source is writable");

    let installed = install_bundled_sources(&bundled_sources(&fixture), &mql5, &idle_queue())
        .expect("the move succeeds");

    let advisor = experts
        .join(EXPERT_ADVISOR_SUB_FOLDER)
        .join(EXPERT_ADVISOR_FILE);
    let installed_advisor = installed.last().expect("the advisor is installed last");
    assert_eq!(installed_advisor.file, Mql5File::ExpertAdvisor);
    assert_eq!(installed_advisor.path, advisor);
    assert_eq!(installed_advisor.outcome, InstallOutcome::Installed);
    assert_eq!(
        fs::read_to_string(&advisor).expect("advisor is readable"),
        BUNDLED_ADVISOR_SOURCE
    );
    assert!(!old_copy.exists(), "the older copy is gone");
    assert!(!compiled.exists(), "its compiled sibling is gone");
    assert!(!log.exists(), "its log is gone");
    assert!(
        unrelated.exists(),
        "another source in the `Experts` root stays"
    );
}

#[test]
fn identical_content_is_unchanged_and_keeps_its_timestamp() {
    let fixture = TempFolder::new("install-unchanged");
    let mql5 = fixture.folder("MQL5");
    let indicator = fixture.folder("MQL5/Indicators").join(INDICATOR_FILE);
    fs::write(&indicator, BUNDLED_INDICATOR_SOURCE).expect("indicator copy is writable");
    let advisor = fixture
        .folder("MQL5/Experts/Advisors")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&advisor, BUNDLED_ADVISOR_SOURCE).expect("advisor copy is writable");
    let modified = fs::metadata(&indicator)
        .and_then(|metadata| metadata.modified())
        .expect("timestamp is readable");

    let installed = install_bundled_sources(&bundled_sources(&fixture), &mql5, &idle_queue())
        .expect("the comparison succeeds");

    let outcomes: Vec<InstallOutcome> = installed.iter().map(|file| file.outcome).collect();
    assert_eq!(outcomes, vec![InstallOutcome::Unchanged; 2]);
    let rewritten = fs::metadata(&indicator)
        .and_then(|metadata| metadata.modified())
        .expect("timestamp is readable");
    assert_eq!(rewritten, modified, "an unchanged file is not rewritten");
}

#[test]
fn an_identical_copy_in_the_advisors_folder_is_unchanged() {
    let fixture = TempFolder::new("install-advisor-unchanged");
    let mql5 = fixture.folder("MQL5");
    let advisor = fixture
        .folder("MQL5/Experts/Advisors")
        .join(EXPERT_ADVISOR_FILE);
    fs::write(&advisor, BUNDLED_ADVISOR_SOURCE).expect("advisor copy is writable");

    let installed = install_bundled_sources(&bundled_sources(&fixture), &mql5, &idle_queue())
        .expect("the comparison succeeds");

    // The default path is the copy that gets compared, so a repeated install neither
    // rewrites it nor adds a second copy in the `Experts` root.
    let installed_advisor = installed.last().expect("the advisor is installed last");
    assert_eq!(installed_advisor.file, Mql5File::ExpertAdvisor);
    assert_eq!(installed_advisor.path, advisor);
    assert_eq!(installed_advisor.outcome, InstallOutcome::Unchanged);
    assert_eq!(
        fs::read_to_string(&advisor).expect("advisor is readable"),
        BUNDLED_ADVISOR_SOURCE
    );
    assert!(!mql5.join("Experts").join(EXPERT_ADVISOR_FILE).exists());
}

/// The install refuses a queue that still carries work and writes nothing at all.
fn assert_refused_without_writing(queue: &ExecutionQueueView) {
    let fixture = TempFolder::new("install-order");
    let mql5 = fixture.folder("MQL5");

    let error = install_bundled_sources(&bundled_sources(&fixture), &mql5, queue)
        .expect_err("an order in the queue refuses the install");

    assert!(matches!(error, InstallError::OrderInFlight));
    assert!(is_empty_folder(&mql5), "the order guard writes nothing");
}

#[test]
fn a_pending_order_refuses_the_install() {
    let pending = ExecutionQueueView {
        pending: 1,
        ..idle_queue()
    };

    assert_refused_without_writing(&pending);
}

#[test]
fn an_order_in_flight_refuses_the_install() {
    let in_flight = ExecutionQueueView {
        in_flight: Some("cmd-1".to_string()),
        ..idle_queue()
    };

    assert_refused_without_writing(&in_flight);
}

#[test]
fn a_missing_source_is_reported_before_anything_is_written() {
    let fixture = TempFolder::new("install-source-missing");
    let mql5 = fixture.folder("MQL5");
    let sources = BundledSources {
        expert_advisor: fixture.path().join(EXPERT_ADVISOR_FILE),
        indicator: fixture.path().join("absent").join(INDICATOR_FILE),
    };

    let error = install_bundled_sources(&sources, &mql5, &idle_queue())
        .expect_err("a missing source fails the install");

    match error {
        InstallError::SourceUnreadable { file, .. } => {
            assert_eq!(file, Mql5File::Indicator, "the indicator is read first");
        }
        other => panic!("unexpected install error: {other:?}"),
    }
    assert!(is_empty_folder(&mql5), "a missing source writes nothing");
}

/// Lines MetaEditor puts in a compile log: the diagnostics first, the counts last.
/// The real line adds `, cpu='X64 Regular'` at the end, which the parser ignores.
const SUCCESS_RESULT_LINE: &str = "Result: 0 errors, 0 warnings, 2806 ms elapsed";
const ERROR_DIAGNOSTIC: &str =
    "BetterChartsBridge.mq5(12,9) : error 123: 'lots' - undeclared identifier";
const WARNING_DIAGNOSTIC: &str = "BetterChartsBridge.mq5(20,3) : warning 42: implicit conversion";
/// Content of the executable stubs a fixture holds: the command builder only checks
/// that the editor exists, never what it contains.
const EXECUTABLE_STUB: &str = "stub\n";

#[test]
fn a_compile_log_decodes_from_utf16_le_with_and_without_a_bom() {
    let bytes = utf16_le_with_bom(SUCCESS_RESULT_LINE);

    assert_eq!(decode_log(&bytes), SUCCESS_RESULT_LINE);
    assert_eq!(
        decode_log(&bytes[2..]),
        SUCCESS_RESULT_LINE,
        "the mark is optional"
    );
}

#[test]
fn a_compile_log_decodes_from_utf8_with_and_without_a_bom() {
    let mut with_bom = vec![0xef, 0xbb, 0xbf];
    with_bom.extend_from_slice(SUCCESS_RESULT_LINE.as_bytes());

    assert_eq!(
        decode_log(SUCCESS_RESULT_LINE.as_bytes()),
        SUCCESS_RESULT_LINE
    );
    assert_eq!(decode_log(&with_bom), SUCCESS_RESULT_LINE);
}

#[test]
fn a_compile_log_reports_the_counts_and_the_diagnostics() {
    let text =
        format!("{ERROR_DIAGNOSTIC}\r\n{WARNING_DIAGNOSTIC}\r\nResult: 1 errors, 1 warnings\r\n");

    let parsed = parse_compile_log(&text).expect("the log carries a result line");

    assert_eq!(parsed.0, 1);
    assert_eq!(parsed.1, 1);
    assert_eq!(
        parsed.2,
        vec![ERROR_DIAGNOSTIC.to_string(), WARNING_DIAGNOSTIC.to_string()]
    );
}

#[test]
fn a_compile_log_without_a_result_line_reports_nothing() {
    // Diagnostics without counts say nothing about whether the file compiled.
    let text = format!("compiling\r\n{WARNING_DIAGNOSTIC}\r\n");

    assert_eq!(parse_compile_log(&text), None);
}

#[test]
fn only_the_first_diagnostics_are_kept() {
    let diagnostics: String = (0..MAX_MESSAGES + 5)
        .map(|line| format!("\r\nBetterChartsBridge.mq5({line},1) : warning 42: note"))
        .collect();
    let text = format!("{SUCCESS_RESULT_LINE}{diagnostics}");

    let parsed = parse_compile_log(&text).expect("the log carries a result line");

    assert_eq!(parsed.2.len(), MAX_MESSAGES);
    assert_eq!(
        parsed.2.first().map(String::as_str),
        Some("BetterChartsBridge.mq5(0,1) : warning 42: note"),
        "the first diagnostics name the cause"
    );
}

#[test]
fn a_portable_source_maps_to_a_relative_windows_path() {
    // The data folder is the install folder, and only the part below it travels to
    // MetaEditor, so a space in the folders above it is harmless.
    let data_folder = Path::new(
        "/Users/trader/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5",
    );
    let source = join_relative(data_folder, "MQL5/Experts/Advisors").join(EXPERT_ADVISOR_FILE);

    let relative =
        relative_windows_path(data_folder, &source).expect("the source is inside the folder");

    assert_eq!(
        relative,
        format!(r"MQL5\Experts\Advisors\{EXPERT_ADVISOR_FILE}")
    );
}

#[test]
fn a_source_below_a_folder_with_a_space_is_refused() {
    let data_folder = Path::new("/tmp/data");
    let source = join_relative(data_folder, "MQL5/My Advisors").join(EXPERT_ADVISOR_FILE);

    match relative_windows_path(data_folder, &source) {
        Err(CompileError::PathHasSpace { path }) => assert_eq!(path, source),
        other => panic!("unexpected compile outcome: {other:?}"),
    }
}

#[test]
fn a_source_outside_the_data_folder_is_refused() {
    let data_folder = Path::new("/tmp/data");
    let source = Path::new("/tmp/elsewhere").join(EXPERT_ADVISOR_FILE);

    match relative_windows_path(data_folder, &source) {
        Err(CompileError::NotInsideDataFolder { path }) => assert_eq!(path, source),
        other => panic!("unexpected compile outcome: {other:?}"),
    }
}

/// Writes the editor stub into `install_folder`.
fn write_executable_stub(install_folder: &Path) {
    let editor = install_folder.join(METAEDITOR_EXE_FILE);
    fs::write(&editor, EXECUTABLE_STUB).expect("the editor stub is writable");
}

/// A Wine installation rooted in `fixture`, with the `MetaEditor64.exe` that ships
/// beside the terminal executable. Returns the installation and its install folder,
/// which the portable layout also uses as the data folder.
fn wine_installation_with_editor(fixture: &TempFolder) -> (Mt5Installation, PathBuf) {
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    write_executable_stub(&install_folder);
    let wine_prefix = fixture.path().to_string_lossy().into_owned();
    let installation = discovered_wine_installation(&wine_prefix, MACOS_WINE_BINARY);
    (installation, install_folder)
}

/// A native installation whose install folder exists on this host: the Windows
/// mapping keeps the path unchanged, so a host path stands in for a Windows one.
/// Only a Windows host has drive-letter temp paths, so only it can run this.
#[cfg(windows)]
fn windows_installation_with_editor(fixture: &TempFolder) -> (Mt5Installation, PathBuf) {
    let install_folder = fixture.folder("Program Files/MetaTrader 5");
    write_executable_stub(&install_folder);
    let terminal_exe = install_folder.join("terminal64.exe");
    let installation = discovered_windows_installation(&terminal_exe.to_string_lossy());
    (installation, install_folder)
}

/// A Wine installation with both shipped files installed in the portable layout,
/// reported the way the install step reports them: indicator first.
fn portable_install(fixture: &TempFolder) -> (Mt5Installation, PathBuf, Vec<InstalledFile>) {
    let (installation, install_folder) = wine_installation_with_editor(fixture);
    let indicator = fixture
        .folder(&format!("{INSTALL_FOLDER_IN_PREFIX}/MQL5/Indicators"))
        .join(INDICATOR_FILE);
    let advisor = fixture
        .folder(&format!("{INSTALL_FOLDER_IN_PREFIX}/MQL5/Experts/Advisors"))
        .join(EXPERT_ADVISOR_FILE);
    let installed = vec![
        installed_file(Mql5File::Indicator, &indicator, InstallOutcome::Installed),
        installed_file(Mql5File::ExpertAdvisor, &advisor, InstallOutcome::Installed),
    ];
    (installation, install_folder, installed)
}

/// Runner that stands in for MetaEditor: it records every command and writes the
/// log that command would have written, so the compile loop runs without starting
/// anything.
#[derive(Default)]
struct FakeRunner {
    /// Log text per log path; a path that is absent means the run writes nothing.
    logs: BTreeMap<PathBuf, String>,
    commands: RefCell<Vec<CompileCommand>>,
}

impl FakeRunner {
    fn writing(logs: impl IntoIterator<Item = (PathBuf, String)>) -> Self {
        Self {
            logs: logs.into_iter().collect(),
            commands: RefCell::new(Vec::new()),
        }
    }

    fn run_count(&self) -> usize {
        self.commands.borrow().len()
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, command: &CompileCommand, log: &Path) -> Result<(), CompileError> {
        self.commands.borrow_mut().push(command.clone());
        if let Some(text) = self.logs.get(log) {
            fs::write(log, text).expect("the fake compile log is writable");
        }
        Ok(())
    }
}

#[test]
fn the_wine_command_runs_the_editor_relative_to_the_data_folder() {
    let fixture = TempFolder::new("compile-wine-command");
    let (installation, install_folder) = wine_installation_with_editor(&fixture);
    let source = join_relative(&install_folder, "MQL5/Experts/Advisors").join(EXPERT_ADVISOR_FILE);

    let command =
        compile_command(&installation, &install_folder, &source).expect("the command is built");

    let editor = install_folder
        .join(METAEDITOR_EXE_FILE)
        .to_string_lossy()
        .into_owned();
    let expected_source = format!(r"/compile:MQL5\Experts\Advisors\{EXPERT_ADVISOR_FILE}");
    assert_eq!(command.program, PathBuf::from(MACOS_WINE_BINARY));
    assert_eq!(
        command.args,
        vec![editor, expected_source, "/log".to_string()]
    );
    assert_eq!(command.working_directory, install_folder);
    let prefix = fixture.path().to_string_lossy().into_owned();
    assert_eq!(command.env, vec![("WINEPREFIX".to_string(), prefix)]);
}

#[cfg(windows)]
#[test]
fn the_windows_command_runs_the_editor_itself() {
    let fixture = TempFolder::new("compile-windows-command");
    let (installation, install_folder) = windows_installation_with_editor(&fixture);
    let source = join_relative(&install_folder, "MQL5/Indicators").join(INDICATOR_FILE);
    let editor = install_folder.join(METAEDITOR_EXE_FILE);

    let command =
        compile_command(&installation, &install_folder, &source).expect("the command is built");

    let expected_source = format!(r"/compile:MQL5\Indicators\{INDICATOR_FILE}");
    assert_eq!(command.program, editor, "no wine on native Windows");
    assert_eq!(command.args, vec![expected_source, "/log".to_string()]);
    assert_eq!(command.working_directory, install_folder);
    assert!(command.env.is_empty(), "a native run needs no Wine prefix");
}

#[test]
fn a_missing_editor_is_reported_before_the_run() {
    let fixture = TempFolder::new("compile-editor-missing");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let wine_prefix = fixture.path().to_string_lossy().into_owned();
    let installation = discovered_wine_installation(&wine_prefix, MACOS_WINE_BINARY);
    let source = join_relative(&install_folder, "MQL5/Experts").join(EXPERT_ADVISOR_FILE);

    match compile_command(&installation, &install_folder, &source) {
        Err(CompileError::EditorMissing { path }) => {
            assert_eq!(path, install_folder.join(METAEDITOR_EXE_FILE));
        }
        other => panic!("unexpected compile outcome: {other:?}"),
    }
}

#[test]
fn the_compile_reports_the_installed_files_in_order() {
    let fixture = TempFolder::new("compile-order");
    let (installation, data_folder, installed) = portable_install(&fixture);
    let indicator_warning = format!("{INDICATOR_FILE}(40,5) : warning 42: implicit conversion");
    let indicator_log = log_path_for(&installed[0].path);
    let advisor_log = log_path_for(&installed[1].path);
    let runner = FakeRunner::writing([
        (
            indicator_log,
            format!("{indicator_warning}\r\nResult: 0 errors, 1 warnings\r\n"),
        ),
        (advisor_log, SUCCESS_RESULT_LINE.to_string()),
    ]);

    let results = compile_installed(&installation, &data_folder, &installed, &runner)
        .expect("both files compile");

    let files: Vec<Mql5File> = results.iter().map(|result| result.file).collect();
    assert_eq!(files, vec![Mql5File::Indicator, Mql5File::ExpertAdvisor]);
    assert_eq!(results[0].warnings, 1);
    assert_eq!(results[0].messages, vec![indicator_warning]);
    assert_eq!(results[1].errors, 0);
    assert!(results[1].messages.is_empty());
    assert_eq!(runner.run_count(), 2);
}

#[test]
fn a_broken_indicator_ends_the_run_before_the_advisor() {
    let fixture = TempFolder::new("compile-indicator-error");
    let (installation, data_folder, installed) = portable_install(&fixture);
    let indicator_log = log_path_for(&installed[0].path);
    let failed_log = "Result: 2 errors, 0 warnings, 800 ms elapsed\r\n";
    let runner = FakeRunner::writing([(indicator_log, failed_log.to_string())]);

    let results = compile_installed(&installation, &data_folder, &installed, &runner)
        .expect("a compile with errors is a result, not a failure");

    assert_eq!(results.len(), 1, "the advisor is not compiled");
    assert_eq!(results[0].file, Mql5File::Indicator);
    assert_eq!(results[0].errors, 2);
    assert_eq!(runner.run_count(), 1, "the reader has to compile first");
}

#[test]
fn a_run_without_a_log_reports_a_missing_log() {
    let fixture = TempFolder::new("compile-log-missing");
    let (installation, data_folder, installed) = portable_install(&fixture);
    let runner = FakeRunner::default();

    let outcome = compile_installed(&installation, &data_folder, &installed, &runner);

    assert!(matches!(outcome, Err(CompileError::LogMissing { .. })));
}

#[test]
fn a_log_without_a_result_line_reports_no_result() {
    let fixture = TempFolder::new("compile-no-result");
    let (installation, data_folder, installed) = portable_install(&fixture);
    let indicator_log = log_path_for(&installed[0].path);
    let runner = FakeRunner::writing([(indicator_log, WARNING_DIAGNOSTIC.to_string())]);

    let outcome = compile_installed(&installation, &data_folder, &installed, &runner);

    assert!(matches!(outcome, Err(CompileError::NoResultLine)));
}

#[test]
fn an_old_log_is_removed_before_the_run() {
    let fixture = TempFolder::new("compile-stale-log");
    let (installation, data_folder, installed) = portable_install(&fixture);
    let log = log_path_for(&installed[0].path);
    fs::write(&log, SUCCESS_RESULT_LINE).expect("the stale log is writable");
    let runner = FakeRunner::default();

    let outcome = compile_installed(&installation, &data_folder, &installed, &runner);

    assert!(matches!(outcome, Err(CompileError::LogMissing { .. })));
    assert!(!log.exists(), "an old log is never this run's result");
}

/// Data folder of the MetaTrader installation the command tests target.
fn metaquotes_mql5() -> PathBuf {
    Path::new("/wine/drive_c/Program Files/MetaTrader 5/MQL5").to_path_buf()
}

/// A configured installation, as the `MT5_*` environment variables produce one.
fn configured_installation(terminal_exe_windows: &str) -> Mt5Installation {
    Mt5Installation {
        host: HostPlatform::Windows,
        wine_prefix: None,
        wine_binary: None,
        terminal_exe_windows: terminal_exe_windows.to_string(),
        source: InstallationSource::Configured,
    }
}

/// One scanned installation, as both commands receive it.
fn located_installation(
    installation: Mt5Installation,
    data_folders: Vec<DataFolder>,
) -> LocatedInstallation {
    LocatedInstallation {
        installation,
        data_folders,
    }
}

/// Two installations, each with its own portable data folder: the picture the
/// matching tests validate requests against.
fn two_located_installations() -> Vec<LocatedInstallation> {
    let acme_mql5 = Path::new("/wine/drive_c/Program Files/Acme MetaTrader 5/MQL5");
    vec![
        located_installation(
            discovered_windows_installation(TERMINAL_EXE),
            vec![expected_portable_folder(&metaquotes_mql5())],
        ),
        located_installation(
            discovered_windows_installation(ACME_TERMINAL_EXE),
            vec![expected_portable_folder(acme_mql5)],
        ),
    ]
}

#[test]
fn the_list_shows_each_installation_with_the_data_folders_the_locator_found() {
    let fixture = TempFolder::new("list-views");
    let standard_root = join_relative(fixture.path(), TEST_TERMINALS_ROOT).join(DATA_FOLDER_ID);
    let installations = vec![
        located_installation(
            discovered_windows_installation(TERMINAL_EXE),
            vec![
                expected_portable_folder(&metaquotes_mql5()),
                expected_standard_folder(&standard_root),
            ],
        ),
        // An installation without a data folder is still listed, with an empty
        // list, and a configured one says so.
        located_installation(configured_installation(ACME_TERMINAL_EXE), Vec::new()),
    ];

    let views =
        serde_json::to_value(installation_views(&installations)).expect("the list serializes");

    let expected = serde_json::json!([
        {
            "terminalPath": TERMINAL_EXE,
            "label": "MetaTrader 5",
            "configured": false,
            "dataFolders": [
                {
                    "mql5Path": metaquotes_mql5().display().to_string(),
                    "layout": "portable",
                    "expertAdvisorInstalled": false,
                },
                {
                    "mql5Path": standard_root.join("MQL5").display().to_string(),
                    "layout": "standard",
                    "expertAdvisorInstalled": false,
                },
            ],
        },
        {
            "terminalPath": ACME_TERMINAL_EXE,
            "label": "Acme MetaTrader 5",
            "configured": true,
            "dataFolders": [],
        },
    ]);
    assert_eq!(views, expected);
}

#[test]
fn the_list_says_which_data_folder_already_holds_the_advisor() {
    let fixture = TempFolder::new("list-advisor-installed");
    let portable_mql5 = fixture.folder("MQL5");
    let advisors = fixture.folder("MQL5/Experts/Advisors");
    fs::write(advisors.join(EXPERT_ADVISOR_FILE), BUNDLED_ADVISOR_SOURCE)
        .expect("the advisor copy is writable");
    let standard_root = join_relative(fixture.path(), TEST_TERMINALS_ROOT).join(DATA_FOLDER_ID);
    create_folder(&standard_root.join("MQL5"));
    let installations = vec![located_installation(
        discovered_windows_installation(TERMINAL_EXE),
        vec![
            expected_portable_folder(&portable_mql5),
            expected_standard_folder(&standard_root),
        ],
    )];

    let views =
        serde_json::to_value(installation_views(&installations)).expect("the list serializes");

    // The guide opens its setup instructions on first launch when no data folder
    // holds the advisor yet, so the list has to say which ones do.
    let folders = &views[0]["dataFolders"];
    assert_eq!(folders[0]["expertAdvisorInstalled"].as_bool(), Some(true));
    assert_eq!(folders[1]["expertAdvisorInstalled"].as_bool(), Some(false));
}

#[test]
fn the_listed_data_folder_of_the_requested_installation_is_accepted() {
    let installations = two_located_installations();
    let requested = metaquotes_mql5().display().to_string();

    let target = matched_target(&installations, TERMINAL_EXE, &requested)
        .expect("a data folder the list reported is accepted");

    assert_eq!(target.installation.terminal_exe_windows, TERMINAL_EXE);
    assert_eq!(target.data_folder.mql5, metaquotes_mql5());
}

#[test]
fn a_terminal_that_was_not_listed_is_refused() {
    let installations = two_located_installations();
    let requested = metaquotes_mql5().display().to_string();

    let refused = matched_target(
        &installations,
        r"C:\Program Files\Zulu MetaTrader 5\terminal64.exe",
        &requested,
    )
    .expect_err("an unlisted terminal is refused");

    assert!(
        refused.contains("Zulu MetaTrader 5") && refused.contains("reload"),
        "the message names the terminal and what to do: {refused}"
    );
}

#[test]
fn a_data_folder_of_another_installation_is_refused() {
    let installations = two_located_installations();
    // The folder is real, but it belongs to the Acme installation.
    let other_installation_mql5 = Path::new("/wine/drive_c/Program Files/Acme MetaTrader 5/MQL5")
        .display()
        .to_string();

    let refused = matched_target(&installations, TERMINAL_EXE, &other_installation_mql5)
        .expect_err("a folder of another installation is refused");

    assert!(
        refused.contains(&other_installation_mql5) && refused.contains("reload"),
        "the message names the refused folder and what to do: {refused}"
    );
}

#[test]
fn only_the_exact_listed_form_of_a_data_folder_is_accepted() {
    let installations = two_located_installations();
    let with_trailing_separator = format!("{}/", metaquotes_mql5().display());

    // The comparison is the exact string the list returned, so another spelling of
    // the same folder is refused instead of being normalised into a write.
    assert!(matched_target(&installations, TERMINAL_EXE, &with_trailing_separator).is_err());
    assert!(matched_target(&installations, TERMINAL_EXE, "MQL5").is_err());
}

#[test]
fn the_report_names_each_file_with_its_outcome_and_compile_result() {
    let indicator_path =
        Path::new("/wine/drive_c/Program Files/MetaTrader 5/MQL5/Indicators").join(INDICATOR_FILE);
    let advisors = Path::new("/wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/Advisors");
    let advisor_path = advisors.join(EXPERT_ADVISOR_FILE);
    let installed = vec![
        installed_file(
            Mql5File::Indicator,
            &indicator_path,
            InstallOutcome::Unchanged,
        ),
        installed_file(
            Mql5File::ExpertAdvisor,
            &advisor_path,
            InstallOutcome::Updated,
        ),
    ];
    // The broken indicator ended the compile run, so the advisor never ran.
    let compiles = vec![CompileResult {
        file: Mql5File::Indicator,
        errors: 1,
        warnings: 1,
        messages: vec![ERROR_DIAGNOSTIC.to_string(), WARNING_DIAGNOSTIC.to_string()],
    }];

    let report =
        serde_json::to_value(install_report(&installed, &compiles)).expect("the report serializes");

    let expected = serde_json::json!({
        "files": [
            {
                "file": "indicator",
                "path": indicator_path.display().to_string(),
                "outcome": "unchanged",
                "compiled": {
                    "errors": 1,
                    "warnings": 1,
                    "messages": [ERROR_DIAGNOSTIC, WARNING_DIAGNOSTIC],
                },
            },
            {
                "file": "expertAdvisor",
                "path": advisor_path.display().to_string(),
                "outcome": "updated",
                "compiled": null,
            },
        ],
    });
    assert_eq!(report, expected);
}

#[test]
fn a_compile_result_belongs_to_its_own_file() {
    let advisors = Path::new("/wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/Advisors");
    let advisor_path = advisors.join(EXPERT_ADVISOR_FILE);
    let installed = vec![installed_file(
        Mql5File::ExpertAdvisor,
        &advisor_path,
        InstallOutcome::Installed,
    )];
    // Results are matched by file, never by position: the indicator's result says
    // nothing about the advisor.
    let compiles = vec![
        CompileResult {
            file: Mql5File::Indicator,
            errors: 3,
            warnings: 0,
            messages: Vec::new(),
        },
        CompileResult {
            file: Mql5File::ExpertAdvisor,
            errors: 0,
            warnings: 2,
            messages: vec![WARNING_DIAGNOSTIC.to_string()],
        },
    ];

    let report =
        serde_json::to_value(install_report(&installed, &compiles)).expect("the report serializes");

    assert_eq!(report["files"][0]["outcome"], "installed");
    assert_eq!(report["files"][0]["compiled"]["errors"], 0);
    assert_eq!(report["files"][0]["compiled"]["warnings"], 2);
}

/// Bridge token the restart tests hand to the advisor. Never a real one.
const TEST_BRIDGE_TOKEN: &str = "test-bridge-token";
/// Bind address the restart tests write into the preset, the bridge default.
const TEST_BRIDGE_ADDRESS: &str = "127.0.0.1:8765";

/// Policy a restart test runs with: a stop timeout of a few polls, no sleeping
/// between them, so the whole sequence stays instant.
fn test_policy() -> RestartPolicy {
    RestartPolicy {
        stop_poll: Duration::from_millis(1),
        stop_timeout: Duration::from_millis(10),
        cleanup_poll: Duration::from_millis(1),
        cleanup_timeout: Duration::from_millis(10),
    }
}

/// A portable Wine installation whose data folder holds the advisor and its
/// compiled copy, which is the state a restart requires.
fn restartable_installation(fixture: &TempFolder) -> (Mt5Installation, DataFolder) {
    // The install folder sits where the Wine mapping puts the terminal.
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let mql5 = install_folder.join("MQL5");
    let advisors = mql5.join("Experts").join("Advisors");
    create_folder(&advisors);
    let advisor = advisors.join(EXPERT_ADVISOR_FILE);
    fs::write(&advisor, BUNDLED_ADVISOR_SOURCE).expect("the advisor copy is writable");
    fs::write(advisor.with_extension("ex5"), EXECUTABLE_STUB)
        .expect("the compiled advisor is writable");
    let wine_prefix = fixture.path().to_string_lossy().into_owned();
    (
        discovered_wine_installation(&wine_prefix, MACOS_WINE_BINARY),
        expected_portable_folder(&mql5),
    )
}

/// The same installation without any advisor copy, which is what a data folder
/// looks like before the install step ran.
fn installation_without_advisor(fixture: &TempFolder) -> (Mt5Installation, DataFolder) {
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let mql5 = install_folder.join("MQL5");
    create_folder(&mql5);
    let wine_prefix = fixture.path().to_string_lossy().into_owned();
    (
        discovered_wine_installation(&wine_prefix, MACOS_WINE_BINARY),
        expected_portable_folder(&mql5),
    )
}

/// Restart request against `installation`, with the bridge settings a running
/// bridge reports.
fn restart_request(installation: Mt5Installation, data_folder: DataFolder) -> RestartRequest {
    RestartRequest {
        installation,
        data_folder,
        address: TEST_BRIDGE_ADDRESS.to_string(),
        token: TEST_BRIDGE_TOKEN.to_string(),
    }
}

/// The two startup files a restart of `installation` has to write, at the paths MT5
/// reads them from.
fn expected_startup_files(
    installation: &Mt5Installation,
    data_folder: &DataFolder,
) -> StartupFiles {
    let install_folder = install_dir(installation).expect("the install folder resolves");
    let mql5 = &data_folder.mql5;
    StartupFiles {
        ini: install_folder.join("config").join(STARTUP_INI_FILE),
        preset: mql5.join("Presets").join(STARTUP_PRESET_FILE),
    }
}

/// Session the tests write into the preset.
fn test_session() -> StartupSession {
    StartupSession::from_bind_address(TEST_BRIDGE_ADDRESS, TEST_BRIDGE_TOKEN)
        .expect("the test address is a loopback address")
}

/// Terminal a restart test drives: the process picture a restart observes and the
/// commands it issues, with no process started.
struct FakeTerminal {
    /// Inspection results in call order; past the last one that result repeats, so a
    /// terminal that stays running keeps reporting that.
    inspections: Vec<ProcessCheck>,
    inspection_index: Cell<usize>,
    /// Result the close reports.
    stop_result: Result<(), String>,
    stops: Cell<u32>,
    launches: RefCell<Vec<TerminalCommand>>,
}

impl FakeTerminal {
    /// Terminal that reports `inspections` in order and repeats the last one.
    fn reporting(inspections: impl IntoIterator<Item = ProcessCheck>) -> Self {
        Self {
            inspections: inspections.into_iter().collect(),
            inspection_index: Cell::new(0),
            stop_result: Ok(()),
            stops: Cell::new(0),
            launches: RefCell::new(Vec::new()),
        }
    }

    /// The same picture, with the close failing.
    fn stop_failing(mut self) -> Self {
        self.stop_result = Err("MT5 refused to close".to_string());
        self
    }

    fn stop_count(&self) -> u32 {
        self.stops.get()
    }

    fn launched(&self) -> Vec<TerminalCommand> {
        self.launches.borrow().clone()
    }
}

impl ProcessControl for FakeTerminal {
    fn inspect(&self) -> ProcessCheck {
        let index = self.inspection_index.get();
        let reported = self.inspections.get(index).or(self.inspections.last());
        self.inspection_index.set(index + 1);
        reported.copied().unwrap_or(ProcessCheck::NotRunning)
    }

    fn stop(&self) -> Result<(), String> {
        self.stops.set(self.stops.get() + 1);
        self.stop_result.clone()
    }

    fn launch(&self, command: &TerminalCommand) -> Result<(), String> {
        self.launches.borrow_mut().push(command.clone());
        Ok(())
    }

    fn pause(&self, _duration: Duration) {}
}

#[test]
fn the_startup_files_sit_where_mt5_reads_them() {
    let fixture = TempFolder::new("restart-file-paths");
    let install_folder = join_relative(fixture.path(), INSTALL_FOLDER_IN_PREFIX);
    let mql5 = install_folder.join("MQL5");
    let expected_ini = install_folder.join("config").join(STARTUP_INI_FILE);
    let expected_preset = mql5.join("Presets").join(STARTUP_PRESET_FILE);

    let files = startup_file_paths(
        HostPlatform::Wine,
        &install_folder,
        &expected_portable_folder(&mql5),
    );

    // The `/config:` argument is resolved from the install folder, and the preset
    // sits in the data folder's `MQL5` tree.
    assert_eq!(files.ini, expected_ini);
    assert_eq!(files.preset, expected_preset);
}

#[test]
fn the_startup_ini_names_the_advisor_and_the_preset() {
    let bytes = startup_ini_bytes("Advisors\\BetterChartsBridge", STARTUP_PRESET_FILE);

    assert_eq!(
        bytes,
        utf16_le_with_bom(
            "[StartUp]\r\n\
             Expert=Advisors\\BetterChartsBridge\r\n\
             ExpertParameters=BetterChartsStartup.set\r\n"
        )
    );
}

#[test]
fn the_startup_preset_carries_the_bridge_endpoint() {
    assert_eq!(
        startup_preset_bytes(&test_session()),
        utf16_le_with_bom(
            "InpBridgeToken=test-bridge-token\r\n\
             InpBridgeHost=127.0.0.1\r\n\
             InpBridgePort=8765\r\n"
        )
    );

    // The bracketed form is the parser's input; the advisor takes the bare address.
    let ipv6 = StartupSession::from_bind_address("[::1]:9100", TEST_BRIDGE_TOKEN)
        .expect("a loopback IPv6 address is accepted");
    assert_eq!(
        startup_preset_bytes(&ipv6),
        utf16_le_with_bom(
            "InpBridgeToken=test-bridge-token\r\n\
             InpBridgeHost=::1\r\n\
             InpBridgePort=9100\r\n"
        )
    );
}

#[test]
fn an_address_the_bridge_cannot_listen_on_is_refused() {
    let unreachable = StartupSession::from_bind_address("0.0.0.0:8765", TEST_BRIDGE_TOKEN)
        .expect_err("a non-loopback address is refused");
    let message = unreachable.to_string();
    assert!(
        matches!(unreachable, RestartError::AddressUnusable { .. }),
        "unexpected error: {message}"
    );

    let unparsable = StartupSession::from_bind_address("localhost:8765", TEST_BRIDGE_TOKEN)
        .expect_err("a host name is not a socket address");
    assert!(matches!(unparsable, RestartError::AddressUnusable { .. }));
}

#[test]
fn a_startup_session_never_prints_the_token() {
    let session = test_session();

    let printed = format!("{session:?}");

    assert!(
        !printed.contains(TEST_BRIDGE_TOKEN),
        "the token is redacted: {printed}"
    );
    assert!(printed.contains("127.0.0.1") && printed.contains("8765"));
}

#[test]
fn the_expert_path_is_the_installed_advisor_below_experts() {
    let fixture = TempFolder::new("restart-expert-path");
    let mql5 = fixture.folder("MQL5");
    let advisors = fixture.folder("MQL5/Experts/Advisors");
    let advisor = advisors.join(EXPERT_ADVISOR_FILE);
    fs::write(&advisor, BUNDLED_ADVISOR_SOURCE).expect("the advisor copy is writable");
    fs::write(advisor.with_extension("ex5"), EXECUTABLE_STUB)
        .expect("the compiled advisor is writable");

    let startup_path = expert_startup_path(&mql5).expect("an installed advisor resolves");

    assert_eq!(startup_path, "Advisors\\BetterChartsBridge");
}

#[test]
fn an_advisor_without_a_compiled_copy_has_no_startup_path() {
    let fixture = TempFolder::new("restart-expert-uncompiled");
    let mql5 = fixture.folder("MQL5");
    let advisors = fixture.folder("MQL5/Experts/Advisors");
    // A source without the `.ex5` beside it is not an advisor MT5 can load.
    fs::write(advisors.join(EXPERT_ADVISOR_FILE), BUNDLED_ADVISOR_SOURCE)
        .expect("the advisor source is writable");

    assert!(matches!(
        expert_startup_path(&mql5),
        Err(RestartError::ExpertNotInstalled)
    ));
}

#[test]
fn the_wine_command_starts_the_portable_terminal_with_a_relative_config() {
    let fixture = TempFolder::new("restart-command-wine");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let wine_prefix = fixture.path().to_string_lossy().into_owned();
    let installation = discovered_wine_installation(&wine_prefix, MACOS_WINE_BINARY);

    let command = startup_command(
        &installation,
        &install_folder,
        Layout::Portable,
        &install_folder.join("config").join(STARTUP_INI_FILE),
    )
    .expect("the portable command is built");
    let expected_env = vec![("WINEPREFIX".to_string(), wine_prefix)];

    assert_eq!(command.program, PathBuf::from(MACOS_WINE_BINARY));
    assert_eq!(
        command.args,
        vec![
            "terminal64.exe".to_string(),
            "/portable".to_string(),
            "/config:config\\BetterChartsStartup.ini".to_string(),
        ]
    );
    assert_eq!(command.working_directory, install_folder);
    assert_eq!(command.env, expected_env);
}

#[test]
fn the_wine_command_omits_the_portable_option_for_a_standard_folder() {
    let fixture = TempFolder::new("restart-command-standard");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let wine_prefix = fixture.path().to_string_lossy().into_owned();
    let installation = discovered_wine_installation(&wine_prefix, MACOS_WINE_BINARY);

    let command = startup_command(
        &installation,
        &install_folder,
        Layout::Standard,
        &install_folder.join("config").join(STARTUP_INI_FILE),
    )
    .expect("the standard command is built");

    assert_eq!(
        command.args,
        vec![
            "terminal64.exe".to_string(),
            "/config:config\\BetterChartsStartup.ini".to_string(),
        ]
    );
}

#[test]
fn the_windows_command_starts_the_terminal_itself() {
    let fixture = TempFolder::new("restart-command-windows");
    let install_folder = fixture.folder("Program Files/MetaTrader 5");
    let terminal_exe = install_folder.join("terminal64.exe");
    // A host path stands in for the Windows one: the command builder only joins the
    // two, so the native form is testable on any host.
    let installation = discovered_windows_installation(&terminal_exe.to_string_lossy());
    let data_folder = expected_standard_folder(
        &fixture.folder("Users/trader/AppData/Roaming/MetaQuotes/Terminal/ABC"),
    );
    let files = startup_file_paths(HostPlatform::Windows, &install_folder, &data_folder);

    let command = startup_command(&installation, &install_folder, Layout::Standard, &files.ini)
        .expect("the native command is built");

    assert_eq!(command.program, terminal_exe, "no wine here");
    assert_eq!(
        command.args,
        vec![format!("/config:{}", files.ini.to_string_lossy())]
    );
    assert_eq!(command.working_directory, install_folder);
    assert!(command.env.is_empty(), "a native run needs no prefix");
}

#[test]
fn windows_startup_ini_is_written_to_the_data_folder_not_program_files() {
    let fixture = TempFolder::new("restart-windows-ini");
    let install_folder = fixture.folder("Program Files/MetaTrader 5");
    let data_root = fixture.folder("Users/trader/AppData/Roaming/MetaQuotes/Terminal/ABC");
    let data_folder = expected_standard_folder(&data_root);

    let files = startup_file_paths(HostPlatform::Windows, &install_folder, &data_folder);

    assert_eq!(
        files.ini,
        data_root.join("config").join(STARTUP_INI_FILE),
        "the ini sits below the data folder, where a user may write"
    );
    assert!(
        !files.ini.starts_with(&install_folder),
        "Program Files is not writable for a normal user"
    );
    assert_eq!(
        files.preset,
        data_root
            .join("MQL5")
            .join("Presets")
            .join(STARTUP_PRESET_FILE)
    );
}

#[test]
fn a_wine_installation_without_prefix_or_binary_is_refused() {
    let installation = Mt5Installation {
        host: HostPlatform::Wine,
        wine_prefix: None,
        wine_binary: None,
        terminal_exe_windows: TERMINAL_EXE.to_string(),
        source: InstallationSource::Discovered,
    };
    let install_folder = Path::new("/tmp/install");

    let refused = startup_command(
        &installation,
        install_folder,
        Layout::Standard,
        &install_folder.join("config").join(STARTUP_INI_FILE),
    );

    assert!(matches!(refused, Err(RestartError::WineUnavailable)));
}

#[test]
fn a_running_terminal_is_closed_and_started_again_with_the_advisor() {
    let fixture = TempFolder::new("restart-sequence");
    let (installation, data_folder) = restartable_installation(&fixture);
    let expected = expected_startup_files(&installation, &data_folder);
    let install_folder = install_dir(&installation).expect("the install folder resolves");
    let terminal = FakeTerminal::reporting([ProcessCheck::Running, ProcessCheck::NotRunning]);
    let request = restart_request(installation, data_folder);

    let files = restart_with_expert(&request, &idle_queue(), &terminal, &test_policy())
        .expect("the restart succeeds");

    assert_eq!(files, expected, "both startup files are reported");
    assert_eq!(terminal.stop_count(), 1, "the close runs once");
    let launched = terminal.launched();
    assert_eq!(launched.len(), 1, "the terminal starts once");
    assert_eq!(
        launched[0].working_directory, install_folder,
        "the config argument resolves from the install folder"
    );
    assert_eq!(
        fs::read(&files.ini).expect("the ini is readable"),
        startup_ini_bytes("Advisors\\BetterChartsBridge", STARTUP_PRESET_FILE)
    );
    assert_eq!(
        fs::read(&files.preset).expect("the preset is readable"),
        startup_preset_bytes(&test_session())
    );
}

#[test]
fn a_terminal_that_does_not_close_leaves_no_startup_files_behind() {
    let fixture = TempFolder::new("restart-stop-timeout");
    let (installation, data_folder) = restartable_installation(&fixture);
    let expected = expected_startup_files(&installation, &data_folder);
    // The inspection keeps reporting a running terminal, so the stop times out.
    let terminal = FakeTerminal::reporting([ProcessCheck::Running]);
    let request = restart_request(installation, data_folder);

    let error = restart_with_expert(&request, &idle_queue(), &terminal, &test_policy())
        .expect_err("a terminal that stays running ends the restart");

    let message = error.to_string();
    assert!(
        matches!(error, RestartError::StopTimedOut),
        "unexpected error: {message}"
    );
    assert_eq!(terminal.stop_count(), 1, "the close is attempted once");
    assert!(terminal.launched().is_empty(), "nothing is started");
    assert!(!expected.ini.exists(), "the ini is deleted again");
    assert!(!expected.preset.exists(), "the preset is deleted again");
}

#[test]
fn an_unknown_process_state_starts_nothing() {
    let fixture = TempFolder::new("restart-unknown");
    let (installation, data_folder) = restartable_installation(&fixture);
    let expected = expected_startup_files(&installation, &data_folder);
    let terminal = FakeTerminal::reporting([ProcessCheck::Unknown]);
    let request = restart_request(installation, data_folder);

    let error = restart_with_expert(&request, &idle_queue(), &terminal, &test_policy())
        .expect_err("a failed inspection ends the restart");

    let message = error.to_string();
    assert!(
        matches!(error, RestartError::ProcessStateUnknown),
        "unexpected error: {message}"
    );
    assert_eq!(terminal.stop_count(), 0, "nothing is stopped blindly");
    assert!(terminal.launched().is_empty(), "nothing is started");
    assert!(!expected.ini.exists() && !expected.preset.exists());
}

#[test]
fn a_terminal_that_cannot_be_closed_keeps_the_token_out_of_the_error() {
    let fixture = TempFolder::new("restart-stop-failed");
    let (installation, data_folder) = restartable_installation(&fixture);
    let expected = expected_startup_files(&installation, &data_folder);
    let terminal = FakeTerminal::reporting([ProcessCheck::Running]).stop_failing();
    let request = restart_request(installation, data_folder);

    let error = restart_with_expert(&request, &idle_queue(), &terminal, &test_policy())
        .expect_err("a failed close ends the restart");

    let message = error.to_string();
    assert!(
        matches!(error, RestartError::StopFailed { .. }),
        "unexpected error: {message}"
    );
    assert!(
        !message.contains(TEST_BRIDGE_TOKEN),
        "the token stays out of every message: {message}"
    );
    assert!(terminal.launched().is_empty(), "nothing is started");
    assert!(!expected.ini.exists() && !expected.preset.exists());
}

#[test]
fn a_pending_or_in_flight_order_refuses_the_restart_before_anything_is_written() {
    let queues = [
        ExecutionQueueView {
            pending: 1,
            ..idle_queue()
        },
        ExecutionQueueView {
            in_flight: Some("cmd-1".to_string()),
            ..idle_queue()
        },
    ];
    for queue in queues {
        let fixture = TempFolder::new("restart-order");
        let (installation, data_folder) = restartable_installation(&fixture);
        let expected = expected_startup_files(&installation, &data_folder);
        let terminal = FakeTerminal::reporting([ProcessCheck::Running]);
        let request = restart_request(installation, data_folder);

        let error = restart_with_expert(&request, &queue, &terminal, &test_policy())
            .expect_err("an order in the queue refuses the restart");

        let message = error.to_string();
        assert!(
            matches!(error, RestartError::OrderInFlight),
            "unexpected error: {message}"
        );
        assert_eq!(terminal.stop_count(), 0, "the terminal keeps running");
        assert!(terminal.launched().is_empty(), "nothing is started");
        assert!(!expected.ini.exists(), "the ini is not written");
        assert!(!expected.preset.exists(), "the preset is not written");
    }
}

#[test]
fn an_empty_bridge_token_refuses_the_restart_before_anything_is_written() {
    let fixture = TempFolder::new("restart-token-missing");
    let (installation, data_folder) = restartable_installation(&fixture);
    let expected = expected_startup_files(&installation, &data_folder);
    let request = RestartRequest {
        token: String::new(),
        ..restart_request(installation, data_folder)
    };
    let terminal = FakeTerminal::reporting([ProcessCheck::Running]);

    let error = restart_with_expert(&request, &idle_queue(), &terminal, &test_policy())
        .expect_err("an advisor without a token could not connect");

    assert_eq!(
        error.to_string(),
        "Set the bridge token in App settings first."
    );
    assert_eq!(terminal.stop_count(), 0, "the terminal keeps running");
    assert!(terminal.launched().is_empty(), "nothing is started");
    assert!(!expected.ini.exists(), "the ini is not written");
    assert!(!expected.preset.exists(), "the preset is not written");
}

#[test]
fn a_data_folder_without_the_advisor_refuses_the_restart_before_anything_is_written() {
    let fixture = TempFolder::new("restart-advisor-missing");
    let (installation, data_folder) = installation_without_advisor(&fixture);
    let expected = expected_startup_files(&installation, &data_folder);
    let terminal = FakeTerminal::reporting([ProcessCheck::Running, ProcessCheck::NotRunning]);
    let request = restart_request(installation, data_folder);

    let error = restart_with_expert(&request, &idle_queue(), &terminal, &test_policy())
        .expect_err("an installation without the advisor is refused");

    assert_eq!(error.to_string(), "Install the EA first.");
    assert_eq!(terminal.stop_count(), 0, "the terminal keeps running");
    assert!(terminal.launched().is_empty(), "nothing is started");
    assert!(!expected.ini.exists(), "the ini is not written");
    assert!(!expected.preset.exists(), "the preset is not written");
}

#[test]
fn the_cleanup_deletes_both_startup_files() {
    let fixture = TempFolder::new("restart-cleanup");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let mql5 = install_folder.join("MQL5");
    create_folder(&mql5);
    let files = startup_file_paths(
        HostPlatform::Wine,
        &install_folder,
        &expected_portable_folder(&mql5),
    );
    write_atomically(&files.ini, b"leftover ini").expect("the ini is writable");
    write_atomically(&files.preset, b"leftover preset").expect("the preset is writable");

    remove_startup_files(&files);

    assert!(!files.ini.exists(), "the ini is deleted");
    assert!(!files.preset.exists(), "the preset is deleted");
    // The cleanup runs on every path, so a file that is already gone is fine.
    remove_startup_files(&files);
}

#[test]
fn the_startup_cleanup_deletes_what_an_interrupted_restart_left_behind() {
    let fixture = TempFolder::new("restart-leftovers");
    let (installation, data_folder) = restartable_installation(&fixture);
    let files = expected_startup_files(&installation, &data_folder);
    let data_root = data_folder
        .mql5
        .parent()
        .expect("the data folder root sits above MQL5");
    let data_folder_ini = data_root.join("config").join(STARTUP_INI_FILE);
    write_atomically(&files.ini, b"leftover ini").expect("the ini is writable");
    write_atomically(&files.preset, b"leftover preset").expect("the preset is writable");
    write_atomically(&data_folder_ini, b"leftover ini").expect("the data folder ini is writable");

    remove_startup_files_in(&installation, std::slice::from_ref(&data_folder));

    assert!(!files.ini.exists(), "the leftover ini is deleted");
    assert!(!files.preset.exists(), "the leftover preset is deleted");
    assert!(
        !data_folder_ini.exists(),
        "the data folder ini is deleted too"
    );
    // Only the two startup files are ours: the advisor copy stays.
    let advisor = existing_copy(&data_folder.mql5, Mql5File::ExpertAdvisor);
    assert!(advisor.is_some(), "the advisor copy stays");
}

#[test]
fn the_cleanup_waits_for_a_session_the_restart_did_not_replace() {
    // A disconnected bridge says nothing about whether MT5 read the files yet.
    assert!(!new_session_live(false, None, None));
    // The session the restart ended keeps the files on disk.
    assert!(!new_session_live(true, Some("old"), Some("old")));
    // The restarted terminal has a session of its own.
    assert!(new_session_live(true, Some("new"), Some("old")));
    assert!(new_session_live(true, Some("new"), None));
}

#[test]
fn the_stop_wait_polls_every_quarter_second_up_to_the_timeout() {
    let poll = Duration::from_millis(250);

    assert_eq!(poll_count(poll, Duration::from_secs(30)), 120);
    assert_eq!(poll_count(poll, Duration::from_secs(120)), 480);
    // A timeout shorter than one interval still observes the state once.
    assert_eq!(poll_count(poll, Duration::from_millis(10)), 1);
}
