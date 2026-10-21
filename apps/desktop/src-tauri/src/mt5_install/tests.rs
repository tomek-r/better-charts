use super::discover::*;
use super::install::*;
use super::locate::*;
use crate::execution_adapter::ExecutionQueueView;
use crate::mt5_backend::{is_configured, Mt5BackendConfig};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

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
        let folder = self.0.join(relative);
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
    let expected = fixture.path().join(INSTALL_FOLDER_IN_PREFIX);
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

#[test]
fn standard_layout_reads_a_utf16_origin_file() {
    let fixture = TempFolder::new("standard-utf16");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    // Trailing separator and line break, as MT5 writes them.
    let origin = format!("{INSTALL_FOLDER_WINDOWS}\\\r\n");
    let data_folder = create_standard_data_folder(&terminals_root, &utf16_le_with_bom(&origin));

    let found = data_folders(&install_folder, Some(terminals_root.as_path()));
    assert_eq!(found, vec![expected_standard_folder(&data_folder)]);
}

#[test]
fn standard_layout_accepts_a_utf8_origin_file() {
    let fixture = TempFolder::new("standard-utf8");
    let install_folder = fixture.folder(INSTALL_FOLDER_IN_PREFIX);
    let terminals_root = fixture.folder(TEST_TERMINALS_ROOT);
    let origin = b"c:/program files/metatrader 5\r\n";
    let data_folder = create_standard_data_folder(&terminals_root, origin);

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
        Some(PathBuf::from(LINUX_MT5_PREFIX).join(INSTALL_FOLDER_IN_PREFIX))
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
    let advisor = mql5.join("Experts").join(EXPERT_ADVISOR_FILE);

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
fn an_existing_copy_is_updated_where_it_is() {
    let fixture = TempFolder::new("install-update");
    let mql5 = fixture.folder("MQL5");
    // The verified installation keeps the advisor one level below `Experts`.
    let advisors = fixture.folder("MQL5/Experts/Advisors");
    let advisor = advisors.join(EXPERT_ADVISOR_FILE);
    fs::write(&advisor, PREVIOUS_SOURCE).expect("previous advisor copy is writable");

    let installed = install_bundled_sources(&bundled_sources(&fixture), &mql5, &idle_queue())
        .expect("the update succeeds");

    let updated = installed.last().expect("the advisor is installed last");
    assert_eq!(updated.file, Mql5File::ExpertAdvisor);
    assert_eq!(updated.path, advisor);
    assert_eq!(updated.outcome, InstallOutcome::Updated);
    assert_eq!(
        fs::read_to_string(&advisor).expect("advisor is readable"),
        BUNDLED_ADVISOR_SOURCE
    );
    // No second copy appears in the MT5-recommended folder.
    assert!(!mql5.join("Experts").join(EXPERT_ADVISOR_FILE).exists());
}

#[test]
fn identical_content_is_unchanged_and_keeps_its_timestamp() {
    let fixture = TempFolder::new("install-unchanged");
    let mql5 = fixture.folder("MQL5");
    let indicator = fixture.folder("MQL5/Indicators").join(INDICATOR_FILE);
    fs::write(&indicator, BUNDLED_INDICATOR_SOURCE).expect("indicator copy is writable");
    let advisor = fixture.folder("MQL5/Experts").join(EXPERT_ADVISOR_FILE);
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
