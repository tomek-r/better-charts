use super::locate::*;
use crate::mt5_backend::Mt5BackendConfig;
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
