use super::*;
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
#[test]
fn first_launch_defaults_are_read_only_and_never_start_mt5() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(Some(fixture.path()), HashMap::new(), None);
    let view = state.view().unwrap();
    assert!(view.first_launch);
    assert!(!view.configured);
    assert!(!state.startup_trading_enabled());
    assert!(!view.mt5_bridge_settings.auto_start_mt5);
    assert!(view.configuration_error.is_none());
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
fn saving_is_private_replaces_existing_and_only_changes_next_launch() {
    let fixture = Fixture::new();
    let path = fixture.path();
    let state = AppSettingsState::resolve(Some(path.clone()), HashMap::new(), None);
    let mut settings = valid();
    settings.trading_enabled = true;
    let view = state.save(settings.clone()).unwrap();
    assert!(view.restart_required);
    assert!(!view.first_launch);
    assert!(!state.startup_trading_enabled());
    let reopened = AppSettingsState::resolve(Some(path.clone()), HashMap::new(), None);
    assert!(reopened.startup_trading_enabled());
    assert!(!reopened.view().unwrap().restart_required);
    settings.token = "replacement-secret".into();
    state.save(settings.clone()).unwrap();
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
    assert!(state.startup_trading_enabled());
    let view = state.save(valid()).unwrap();
    assert!(!view.restart_required);
    assert!(view.overridden_keys.contains(&"token".into()));
    env.insert("MT5_BRIDGE_TOKEN".into(), String::new());
    let state = AppSettingsState::resolve(Some(fixture.path()), env, None);
    assert_eq!(state.view().unwrap().mt5_bridge_settings.token, "");
    // Empty explicit token preserves runtime authentication policy; it cannot
    // authorize trading through a newly unconfigured first-launch setup.
    assert!(!state.startup_trading_enabled());
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
    assert!(state.save(valid()).unwrap().configuration_error.is_none());
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::from([("MT5_BRIDGE_TRADING_ENABLED".into(), "unexpected".into())]),
        None,
    );
    assert!(!state.startup_trading_enabled());
    assert!(state.view().unwrap().configuration_error.is_some());
    assert!(state.save(valid()).unwrap().configuration_error.is_some());
}
#[test]
fn malformed_dotenv_remains_visible_after_saving_and_disables_startup() {
    let fixture = Fixture::new();
    let state = AppSettingsState::resolve(
        Some(fixture.path()),
        HashMap::new(),
        Some("Invalid runtime .env file".into()),
    );
    assert!(!state.startup_trading_enabled());
    assert!(state.save(valid()).unwrap().configuration_error.is_some());
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
    assert!(state.save(valid()).is_err());
    assert!(state.view().unwrap().first_launch);
    let fixture = Fixture::new();
    let parent = fixture.0.join("file-parent");
    fs::write(&parent, b"not-a-directory").unwrap();
    assert!(persist(&parent.join(SETTINGS_FILE), &valid()).is_err());
}
