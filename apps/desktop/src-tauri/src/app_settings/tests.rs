use super::detected_paths::fill_detected_paths;
use super::*;
use crate::mt5_backend::DEFAULT_WINE_BINARY;
use crate::mt5_install::discover::{InstallationSource, Mt5Installation};
use crate::mt5_install::locate::HostPlatform;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = env::temp_dir().join(format!(
            "better-charts-settings-{}-{}-{}",
            std::process::id(),
            FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> PathBuf {
        self.0.join(SETTINGS_FILE)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn valid() -> AppSettings {
    AppSettings {
        token: "fixture-secret".into(),
        ..AppSettings::default()
    }
}
fn queue_with(pending: usize, in_flight: Option<&str>) -> ExecutionQueueView {
    ExecutionQueueView {
        pending,
        in_flight: in_flight.map(str::to_owned),
        dispatch_enabled: true,
        stranded: 0,
    }
}
/// Saves with nothing queued and ignores what the save would apply.
fn save_idle(state: &AppSettingsState, settings: AppSettings) -> Result<AppSettingsView, String> {
    state.save(settings, &queue_with(0, None), |_| {})
}
/// Saves against `queue` and returns the view next to what the save applied, which is
/// `None` when the save was refused.
fn save_applying(
    state: &AppSettingsState,
    settings: AppSettings,
    queue: &ExecutionQueueView,
) -> (Result<AppSettingsView, String>, Option<AppliedSettings>) {
    let applied = std::cell::RefCell::new(None);
    let saved = state.save(settings, queue, |change| {
        *applied.borrow_mut() = Some(change);
    });
    (saved, applied.into_inner())
}
#[test]
fn first_launch_generates_a_bridge_token_and_never_starts_mt5() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(Some(fixture.path()), HashMap::new(), None);
    let view = state.view().unwrap();
    assert!(view.first_launch);
    assert!(view.configured);
    assert!(!state.trading_enabled());
    assert!(!view.mt5_bridge_settings.auto_start_mt5);
    assert!(view.configuration_error.is_none());
    let token = &view.mt5_bridge_settings.token;
    assert_eq!(token.len(), 64, "32 random bytes as lowercase hex");
    let is_lowercase_hex = token
        .chars()
        .all(|character| matches!(character, '0'..='9' | 'a'..='f'));
    assert!(is_lowercase_hex, "the generated token is lowercase hex");
    // The token reaches the file at once, so the next launch exports the same one.
    let stored = read_file(&fixture.path()).unwrap().unwrap();
    assert_eq!(stored.token, *token);
}
#[test]
fn an_empty_token_override_is_never_replaced_by_a_generated_one() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::from([("MT5_BRIDGE_TOKEN".into(), String::new())]),
        None,
    );
    let view = state.view().unwrap();
    assert_eq!(view.mt5_bridge_settings.token, "");
    assert!(!view.configured);
    // Nothing is invented for a token the operator deliberately left empty.
    assert!(!fixture.path().exists());
}
#[test]
fn environment_configuration_still_prompts_on_first_desktop_launch() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::from([("MT5_BRIDGE_TOKEN".into(), "external-secret".into())]),
        None,
    );
    let view = state.view().unwrap();
    assert!(view.configured);
    assert!(view.first_launch);
}
#[test]
fn saving_is_private_replaces_existing_and_applies_at_once() {
    let fixture = Fixture::new();
    let path = fixture.path();
    let state = AppSettingsState::resolve(Some(path.clone()), HashMap::new(), None);
    let mut settings = valid();
    settings.trading_enabled = true;
    let view = save_idle(&state, settings.clone()).unwrap();
    assert!(!view.first_launch);
    assert!(state.trading_enabled());
    let reopened = AppSettingsState::resolve(Some(path.clone()), HashMap::new(), None);
    assert!(reopened.trading_enabled());
    settings.token = "replacement-secret".into();
    save_idle(&state, settings.clone()).unwrap();
    assert!(read_file(&path).unwrap() == Some(settings));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
#[test]
fn environment_overrides_persisted_values_and_empty_token_still_wins() {
    let fixture = Fixture::new();
    persist(&fixture.path(), &valid()).unwrap();
    let mut env = HashMap::from([
        ("MT5_BRIDGE_TOKEN".into(), "external-secret".into()),
        ("MT5_BRIDGE_TRADING_ENABLED".into(), "true".into()),
    ]);
    let state = AppSettingsState::resolve(Some(fixture.path()), env.clone(), None);
    assert_eq!(
        state.view().unwrap().mt5_bridge_settings.token,
        "external-secret"
    );
    assert!(state.trading_enabled());
    let view = save_idle(&state, valid()).unwrap();
    assert!(view.overridden_keys.contains(&"token".into()));
    env.insert("MT5_BRIDGE_TOKEN".into(), String::new());
    let state = AppSettingsState::resolve(Some(fixture.path()), env, None);
    assert_eq!(state.view().unwrap().mt5_bridge_settings.token, "");
    // Empty explicit token preserves runtime authentication policy; it cannot
    // authorize trading through a newly unconfigured first-launch setup.
    assert!(!state.trading_enabled());
}
#[test]
fn corrupt_settings_and_invalid_overrides_fail_closed_without_secret_errors() {
    let fixture = Fixture::new();
    fs::write(fixture.path(), "{private-secret").unwrap();
    let env = HashMap::from([
        ("MT5_BRIDGE_TOKEN".into(), "external-secret".into()),
        ("MT5_BRIDGE_TRADING_ENABLED".into(), "true".into()),
    ]);
    let state = AppSettingsState::resolve(Some(fixture.path()), env, None);
    let view = state.view().unwrap();
    assert!(view.first_launch);
    assert!(!view.mt5_bridge_settings.trading_enabled);
    assert!(!view.mt5_bridge_settings.auto_start_mt5);
    assert!(!view.configuration_error.unwrap().contains("secret"));
    assert!(save_idle(&state, valid())
        .unwrap()
        .configuration_error
        .is_none());
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::from([("MT5_BRIDGE_TRADING_ENABLED".into(), "unexpected".into())]),
        None,
    );
    assert!(!state.trading_enabled());
    assert!(state.view().unwrap().configuration_error.is_some());
    assert!(save_idle(&state, valid())
        .unwrap()
        .configuration_error
        .is_some());
}
#[test]
fn malformed_dotenv_remains_visible_after_saving_and_keeps_trading_off() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::new(),
        Some("Invalid runtime .env file".into()),
    );
    assert!(!state.trading_enabled());
    let mut settings = valid();
    settings.trading_enabled = true;
    let view = save_idle(&state, settings).unwrap();
    assert!(view.configuration_error.is_some());
    assert!(
        !state.trading_enabled(),
        "a runtime configuration error keeps execution off after a save"
    );
}
#[test]
fn invalid_save_preserves_previous_settings_and_errors_hide_token() {
    let fixture = Fixture::new();
    let previous = valid();
    persist(&fixture.path(), &previous).unwrap();
    let mut settings = previous.clone();
    settings.address = "0.0.0.0:8765".into();
    let error = persist(&fixture.path(), &settings).unwrap_err();
    assert!(!error.contains(&settings.token));
    assert!(read_file(&fixture.path()).unwrap() == Some(previous));
    settings = valid();
    settings.max_frame_bytes = 1023;
    assert!(settings.validate().is_err());
    settings.max_frame_bytes = trading_core::protocol::max_frame_bytes();
    assert!(settings.validate().is_ok());
    settings.max_frame_bytes += 1;
    assert!(settings.validate().is_err());
    settings = valid();
    settings.address = "127.0.0.1:0".into();
    assert!(settings.validate().is_err());
    settings = valid();
    settings.auto_start_mt5 = true;
    assert!(settings.validate().is_err());
    settings = valid();
    settings.token = "secret\ninvalid".into();
    assert!(settings.validate().is_err());
}
#[test]
fn unavailable_directory_is_reported_without_mutating_view() {
    let state = AppSettingsState::resolve(None, HashMap::new(), None);
    assert!(save_idle(&state, valid()).is_err());
    assert!(state.view().unwrap().first_launch);
    let fixture = Fixture::new();
    let parent = fixture.0.join("file-parent");
    fs::write(&parent, b"not-a-directory").unwrap();
    assert!(persist(&parent.join(SETTINGS_FILE), &valid()).is_err());
}

/// A state loaded from an empty settings directory and saved once with `settings`.
fn saved_state(
    fixture: &Fixture,
    overrides: HashMap<String, String>,
    settings: AppSettings,
) -> AppSettingsState {
    let state = AppSettingsState::resolve(Some(fixture.path()), overrides, None);
    save_idle(&state, settings).unwrap();
    state
}
#[test]
fn a_save_changes_the_values_the_running_app_reads_at_once() {
    let fixture = Fixture::new();
    let mut settings = valid();
    settings.terminal_path = r"D:\Saved\terminal64.exe".into();
    settings.config_path = r"Z:\saved.ini".into();
    settings.max_frame_bytes = 2 * 1024 * 1024;
    settings.address = "127.0.0.1:9911".into();

    let state = saved_state(&fixture, HashMap::new(), settings.clone());

    for (name, expected) in [
        ("MT5_BRIDGE_TOKEN", "fixture-secret"),
        ("MT5_BRIDGE_ADDR", "127.0.0.1:9911"),
        ("MT5_BRIDGE_MAX_FRAME_BYTES", "2097152"),
        ("MT5_TERMINAL_EXE", r"D:\Saved\terminal64.exe"),
        ("MT5_BACKEND_INI", r"Z:\saved.ini"),
    ] {
        assert_eq!(state.runtime_variable(name).as_deref(), Some(expected));
    }
    let backend = state.backend_config();
    assert_eq!(backend.terminal_exe_windows, r"D:\Saved\terminal64.exe");
    assert_eq!(backend.config_ini_windows.as_deref(), Some(r"Z:\saved.ini"));
    assert!(state.bridge_endpoint() == settings.bridge_endpoint());
}
#[test]
fn environment_overrides_keep_winning_over_saved_values_at_runtime() {
    let fixture = Fixture::new();
    let overrides = HashMap::from([(
        "MT5_BRIDGE_TOKEN".to_string(),
        "external-secret".to_string(),
    )]);
    let mut settings = valid();
    settings.address = "127.0.0.1:9912".into();

    let state = saved_state(&fixture, overrides, settings);

    assert_eq!(
        state.runtime_variable("MT5_BRIDGE_TOKEN").as_deref(),
        Some("external-secret")
    );
    assert_eq!(
        state.runtime_variable("MT5_BRIDGE_ADDR").as_deref(),
        Some("127.0.0.1:9912")
    );
}
#[test]
fn a_runtime_configuration_error_keeps_trading_and_auto_start_off_after_a_save() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::new(),
        Some("Invalid runtime .env file".into()),
    );
    let mut settings = valid();
    settings.trading_enabled = true;
    settings.auto_start_mt5 = true;
    settings.terminal_path = r"D:\Saved\terminal64.exe".into();
    settings.wine_prefix = "/home/demo/.mt5".into();

    save_idle(&state, settings).unwrap();

    assert_eq!(
        state
            .runtime_variable("MT5_BRIDGE_TRADING_ENABLED")
            .as_deref(),
        Some("false")
    );
    assert_eq!(
        state.runtime_variable("MT5_BACKEND_ENABLED").as_deref(),
        Some("false")
    );
    assert!(!state.backend_config().enabled);
}
#[test]
fn names_that_are_not_settings_read_the_process_environment() {
    let fixture = Fixture::new();
    let state = saved_state(&fixture, HashMap::new(), valid());

    assert_eq!(state.runtime_variable("PATH"), None);
    assert_eq!(state.variable_or_process_env("PATH"), env::var("PATH").ok());
    assert_eq!(
        state.variable_or_process_env("MT5_BRIDGE_TOKEN").as_deref(),
        Some("fixture-secret"),
        "a setting never falls back to the process environment"
    );
}
#[test]
fn a_save_reports_a_changed_bridge_endpoint_and_applies_the_effective_values() {
    let fixture = Fixture::new();
    let state = saved_state(&fixture, HashMap::new(), valid());
    let mut next = valid();
    next.token = "rotated-secret".into();
    next.trading_enabled = true;

    let (saved, applied) = save_applying(&state, next.clone(), &queue_with(0, None));

    saved.unwrap();
    let applied = applied.expect("a save applies its change");
    assert!(applied.effective == next);
    assert!(applied.endpoint_change.unwrap() == next.bridge_endpoint());
}
#[test]
fn an_unchanged_bridge_endpoint_is_not_reported() {
    let fixture = Fixture::new();
    let state = saved_state(&fixture, HashMap::new(), valid());
    let mut next = valid();
    next.trading_enabled = true;
    next.terminal_path = r"D:\Saved\terminal64.exe".into();

    let (saved, applied) = save_applying(&state, next, &queue_with(0, None));

    saved.unwrap();
    assert!(applied.unwrap().endpoint_change.is_none());
}
#[test]
fn a_bridge_endpoint_change_is_refused_while_an_order_is_pending_and_writes_nothing() {
    let fixture = Fixture::new();
    let state = saved_state(&fixture, HashMap::new(), valid());
    let changes: [fn(&mut AppSettings); 3] = [
        |settings| settings.token = "rotated-secret".into(),
        |settings| settings.address = "127.0.0.1:9913".into(),
        |settings| settings.max_frame_bytes = 2 * 1024 * 1024,
    ];
    for busy in [queue_with(1, None), queue_with(0, Some("cmd-in-flight"))] {
        for change in changes {
            let mut next = valid();
            change(&mut next);

            let (saved, applied) = save_applying(&state, next, &busy);

            assert_eq!(saved.err().as_deref(), Some(BRIDGE_CHANGE_REFUSED));
            assert!(applied.is_none());
            assert!(read_file(&fixture.path()).unwrap() == Some(valid()));
            assert!(state.view().unwrap().mt5_bridge_settings == valid());
        }
    }
}
#[test]
fn settings_that_leave_the_bridge_endpoint_alone_are_saved_while_an_order_is_pending() {
    let fixture = Fixture::new();
    let state = saved_state(&fixture, HashMap::new(), valid());
    let mut next = valid();
    next.trading_enabled = true;
    next.terminal_path = r"D:\Saved\terminal64.exe".into();

    let (saved, applied) =
        save_applying(&state, next.clone(), &queue_with(3, Some("cmd-in-flight")));

    saved.unwrap();
    assert!(applied.unwrap().effective == next);
    assert!(read_file(&fixture.path()).unwrap() == Some(next));
}
#[test]
fn an_overridden_bridge_field_never_counts_as_a_change() {
    let fixture = Fixture::new();
    let overrides = HashMap::from([(
        "MT5_BRIDGE_TOKEN".to_string(),
        "external-secret".to_string(),
    )]);
    let state = saved_state(&fixture, overrides, valid());
    let mut next = valid();
    next.token = "typed-but-overridden".into();

    let (saved, applied) = save_applying(&state, next, &queue_with(1, None));

    saved.unwrap();
    assert!(applied.unwrap().endpoint_change.is_none());
}
#[test]
fn a_refusal_for_an_invalid_save_names_the_invalid_value_even_with_an_order_pending() {
    let fixture = Fixture::new();
    let state = saved_state(&fixture, HashMap::new(), valid());
    let mut next = valid();
    next.address = "0.0.0.0:8765".into();

    let saved = state.save(next, &queue_with(1, None), |_| {});

    assert_ne!(saved.err().as_deref(), Some(BRIDGE_CHANGE_REFUSED));
}

/// Windows path of the terminal discovery reports on every platform.
const DETECTED_TERMINAL: &str = r"C:\Program Files\MetaTrader 5\terminal64.exe";
/// Prefix and binary of the Wine installation the detection tests use.
const DETECTED_PREFIX: &str = "/home/demo/.mt5";
const DETECTED_WINE: &str = "/usr/bin/wine";

/// A Wine-host installation, as discovery reports one on macOS or Linux.
fn detected_wine_installation() -> Mt5Installation {
    Mt5Installation {
        host: HostPlatform::Wine,
        wine_prefix: Some(PathBuf::from(DETECTED_PREFIX)),
        wine_binary: Some(PathBuf::from(DETECTED_WINE)),
        terminal_exe_windows: DETECTED_TERMINAL.to_string(),
        source: InstallationSource::Discovered,
    }
}

/// A native Windows installation, where no Wine setting applies.
fn detected_windows_installation() -> Mt5Installation {
    Mt5Installation {
        host: HostPlatform::Windows,
        wine_prefix: None,
        wine_binary: None,
        terminal_exe_windows: DETECTED_TERMINAL.to_string(),
        source: InstallationSource::Discovered,
    }
}

/// The same Wine installation, as the setup guide's file picker reports it.
fn chosen_wine_installation() -> Mt5Installation {
    Mt5Installation {
        source: InstallationSource::Chosen,
        ..detected_wine_installation()
    }
}

#[test]
fn detection_fills_every_unset_installation_path() {
    let settings = valid();

    let (filled, fields) = fill_detected_paths(&settings, &detected_wine_installation(), &[]);

    assert_eq!(filled.terminal_path, DETECTED_TERMINAL);
    assert_eq!(filled.wine_prefix, DETECTED_PREFIX);
    assert_eq!(filled.wine_binary, DETECTED_WINE);
    assert_eq!(fields, vec!["terminalPath", "winePrefix", "wineBinary"]);
}
#[test]
fn detection_keeps_every_value_the_user_set() {
    let mut settings = valid();
    settings.terminal_path = r"D:\MetaTrader 5\terminal64.exe".into();
    settings.wine_prefix = "/home/demo/custom".into();
    settings.wine_binary = "/home/demo/bin/wine".into();

    let (filled, fields) = fill_detected_paths(&settings, &detected_wine_installation(), &[]);

    // AppSettings has no Debug (it holds the token), so assert_eq! cannot compare it.
    assert!(filled == settings);
    assert!(fields.is_empty());
}
#[test]
fn detection_keeps_a_field_an_environment_override_supplies() {
    let settings = valid();

    let (filled, fields) = fill_detected_paths(
        &settings,
        &detected_wine_installation(),
        &["terminalPath".to_string()],
    );

    assert_eq!(filled.terminal_path, "");
    assert_eq!(fields, vec!["winePrefix", "wineBinary"]);
}
#[test]
fn the_shared_default_wine_binary_is_replaced_by_the_detected_one() {
    let settings = valid();
    assert_eq!(settings.wine_binary, DEFAULT_WINE_BINARY);

    let (filled, fields) = fill_detected_paths(&settings, &detected_wine_installation(), &[]);

    assert_eq!(filled.wine_binary, DETECTED_WINE);
    assert!(fields.contains(&"wineBinary"));
}
#[test]
fn a_windows_installation_fills_only_the_terminal_path() {
    let settings = valid();

    let (filled, fields) = fill_detected_paths(&settings, &detected_windows_installation(), &[]);

    assert_eq!(filled.terminal_path, DETECTED_TERMINAL);
    assert_eq!(filled.wine_prefix, "");
    assert_eq!(filled.wine_binary, DEFAULT_WINE_BINARY);
    assert_eq!(fields, vec!["terminalPath"]);
}
#[test]
fn detection_never_changes_the_auto_start_flag() {
    let mut settings = valid();
    settings.terminal_path = r"D:\MetaTrader 5\terminal64.exe".into();
    settings.wine_prefix = "/home/demo/custom".into();
    settings.auto_start_mt5 = true;

    let (filled, _) = fill_detected_paths(&settings, &detected_wine_installation(), &[]);
    assert!(filled.auto_start_mt5);

    let (default_filled, _) = fill_detected_paths(&valid(), &detected_wine_installation(), &[]);
    assert!(!default_filled.auto_start_mt5);
}
#[test]
fn a_first_launch_shows_detected_paths_without_storing_them() {
    let fixture = Fixture::new();
    let path = fixture.path();

    let state = AppSettingsState::resolve_with_installation(
        Some(path.clone()),
        HashMap::new(),
        None,
        Some(detected_wine_installation()),
    );

    let view = state.view().unwrap();
    assert_eq!(view.mt5_bridge_settings.terminal_path, DETECTED_TERMINAL);
    assert_eq!(view.mt5_bridge_settings.wine_prefix, DETECTED_PREFIX);
    assert!(!view.mt5_bridge_settings.auto_start_mt5);
    assert_eq!(
        view.detected_fields,
        vec!["terminalPath", "winePrefix", "wineBinary"]
    );
    // The first launch stores its generated token at once, but the detected paths
    // stay in the form until the user saves them.
    let stored = read_file(&path).unwrap().unwrap();
    assert_eq!(stored.token.len(), 64);
    assert_eq!(stored.terminal_path, "");
}
#[test]
fn an_existing_settings_file_receives_the_detected_paths() {
    let fixture = Fixture::new();
    persist(&fixture.path(), &valid()).unwrap();

    let state = AppSettingsState::resolve_with_installation(
        Some(fixture.path()),
        HashMap::new(),
        None,
        Some(detected_wine_installation()),
    );

    let stored = read_file(&fixture.path()).unwrap().unwrap();
    assert_eq!(stored.terminal_path, DETECTED_TERMINAL);
    assert_eq!(stored.wine_prefix, DETECTED_PREFIX);
    assert!(!stored.auto_start_mt5);
    assert!(state.view().unwrap().configured);
}
#[test]
fn detected_paths_are_never_written_over_an_override() {
    let fixture = Fixture::new();
    persist(&fixture.path(), &valid()).unwrap();
    let override_terminal = r"D:\Custom\terminal64.exe";

    let state = AppSettingsState::resolve_with_installation(
        Some(fixture.path()),
        HashMap::from([(
            "MT5_TERMINAL_EXE".to_string(),
            override_terminal.to_string(),
        )]),
        None,
        Some(detected_wine_installation()),
    );

    assert_eq!(
        read_file(&fixture.path()).unwrap().unwrap().terminal_path,
        "",
        "the override stays out of the settings file"
    );
    let view = state.view().unwrap();
    assert_eq!(view.mt5_bridge_settings.terminal_path, override_terminal);
    assert!(!view.detected_fields.contains(&"terminalPath"));
}
#[test]
fn an_install_fills_the_unset_paths_and_keeps_the_rest() {
    let fixture = Fixture::new();
    let mut stored = valid();
    stored.wine_prefix = "/home/demo/custom".into();
    persist(&fixture.path(), &stored).unwrap();
    let state = AppSettingsState::resolve(Some(fixture.path()), HashMap::new(), None);

    state.fill_from_installation(&detected_wine_installation());

    let after = read_file(&fixture.path()).unwrap().unwrap();
    assert_eq!(after.terminal_path, DETECTED_TERMINAL);
    assert_eq!(after.wine_prefix, "/home/demo/custom");
    assert_eq!(after.wine_binary, DETECTED_WINE);
    assert!(!after.auto_start_mt5);
    assert_eq!(
        state.view().unwrap().detected_fields,
        vec!["terminalPath", "wineBinary"]
    );
    assert_eq!(
        state.runtime_variable("MT5_WINE_BINARY").as_deref(),
        Some(DETECTED_WINE),
        "the filled path applies to the running app"
    );
}
#[test]
fn an_install_keeps_the_generated_first_launch_token() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(Some(fixture.path()), HashMap::new(), None);
    let token = read_file(&fixture.path()).unwrap().unwrap().token;

    state.fill_from_installation(&detected_wine_installation());

    let after = read_file(&fixture.path()).unwrap().unwrap();
    assert_eq!(after.token, token);
    assert_eq!(after.terminal_path, DETECTED_TERMINAL);
}
#[test]
fn a_chosen_installation_replaces_the_saved_paths_and_applies_at_once() {
    let fixture = Fixture::new();
    let mut stored = valid();
    stored.terminal_path = r"D:\Elsewhere\terminal64.exe".into();
    stored.wine_prefix = "/home/demo/custom".into();
    stored.wine_binary = "/home/demo/bin/wine".into();
    persist(&fixture.path(), &stored).unwrap();
    let state = AppSettingsState::resolve(Some(fixture.path()), HashMap::new(), None);

    state.store_chosen_installation(&chosen_wine_installation());

    let after = read_file(&fixture.path()).unwrap().unwrap();
    assert_eq!(after.terminal_path, DETECTED_TERMINAL);
    assert_eq!(after.wine_prefix, DETECTED_PREFIX);
    assert_eq!(after.wine_binary, DETECTED_WINE);
    assert!(!after.auto_start_mt5);
    let view = state.view().unwrap();
    assert_eq!(
        view.detected_fields,
        vec!["terminalPath", "winePrefix", "wineBinary"]
    );
    assert_eq!(
        state.runtime_variable("MT5_TERMINAL_EXE").as_deref(),
        Some(DETECTED_TERMINAL),
        "the picked terminal applies to the running app"
    );
    assert_eq!(
        state.backend_config().terminal_exe_windows,
        DETECTED_TERMINAL
    );
}
#[test]
fn a_chosen_installation_keeps_a_field_an_override_supplies() {
    let fixture = Fixture::new();
    persist(&fixture.path(), &valid()).unwrap();
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::from([(
            "MT5_TERMINAL_EXE".to_string(),
            r"D:\Override\terminal64.exe".to_string(),
        )]),
        None,
    );

    state.store_chosen_installation(&chosen_wine_installation());

    let after = read_file(&fixture.path()).unwrap().unwrap();
    assert_eq!(
        after.terminal_path, "",
        "the override stays out of the file"
    );
    assert_eq!(after.wine_prefix, DETECTED_PREFIX);
    assert_eq!(
        state.view().unwrap().detected_fields,
        vec!["winePrefix", "wineBinary"]
    );
}
