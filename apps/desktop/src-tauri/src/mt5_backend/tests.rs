use super::*;

fn config_with(get: impl Fn(&str) -> Option<String>) -> Mt5BackendConfig {
    Mt5BackendConfig::from_env_with(get)
}

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

#[test]
fn terminal_args_include_config_only_when_ini_is_set() {
    let mut config = config_with(env_map(&[(
        "MT5_TERMINAL_EXE",
        "C:\\Program Files\\MetaTrader 5\\terminal64.exe",
    )]));
    assert_eq!(terminal_args(&config), Vec::<String>::new());
    config.config_ini_windows = Some("Z:\\repo\\scripts\\bridge.local.ini".to_string());
    assert_eq!(
        terminal_args(&config),
        vec!["/config:Z:\\repo\\scripts\\bridge.local.ini".to_string(),]
    );
}

#[cfg(not(windows))]
#[test]
fn terminal_env_maps_wineprefix_from_config() {
    let config = config_with(env_map(&[
        ("HOME", "/synthetic/home"),
        ("MT5_WINE_PREFIX", "/custom/prefix"),
    ]));
    assert_eq!(
        terminal_env(&config),
        vec![("WINEPREFIX".to_string(), "/custom/prefix".to_string())]
    );
}

#[test]
fn unconfigured_install_never_infers_paths_from_home() {
    let config = config_with(env_map(&[("HOME", "/synthetic/home")]));
    assert!(config.wine_prefix.as_os_str().is_empty());
    assert!(config.terminal_exe_windows.is_empty());
    assert_eq!(config.config_ini_windows, None);
    assert!(!is_configured(&config));
    assert_eq!(
        auto_start_plan(false, ProcessCheck::NotRunning, config.enabled, false),
        AutoStartPlan::Unconfigured
    );
}

#[test]
fn from_env_with_applies_overrides_and_enabled_flag() {
    let config = config_with(env_map(&[
        ("HOME", "/synthetic/home"),
        ("MT5_WINE_PREFIX", "/p"),
        ("MT5_WINE_BINARY", "/w"),
        ("MT5_TERMINAL_EXE", "D:\\term.exe"),
        ("MT5_BACKEND_INI", "Z:\\bridge.ini"),
        ("MT5_BACKEND_ENABLED", "1"),
    ]));
    assert_eq!(config.wine_prefix, PathBuf::from("/p"));
    assert_eq!(config.wine_binary, PathBuf::from("/w"));
    assert_eq!(config.terminal_exe_windows, "D:\\term.exe");
    assert_eq!(config.config_ini_windows.as_deref(), Some("Z:\\bridge.ini"));
    assert!(config.enabled);

    // The documented opt-out tokens disable auto-start; everything else
    // (including unknown values) keeps the default-on behavior.
    for opt_out in ["0", "false", "FALSE", "no", "off"] {
        assert!(
            !config_with(env_map(&[("MT5_BACKEND_ENABLED", opt_out)])).enabled,
            "{opt_out} must opt out"
        );
    }
    for keep_on in ["1", "true", "yes", ""] {
        assert!(
            config_with(env_map(&[("MT5_BACKEND_ENABLED", keep_on)])).enabled,
            "{keep_on:?} must keep auto-start on"
        );
    }
    let empty_ini = config_with(env_map(&[("MT5_BACKEND_INI", "")]));
    assert_eq!(empty_ini.config_ini_windows, None);
}

fn fresh_temp_dir(tag: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("mt5-backend-{tag}-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn empty_install_overrides_remain_unconfigured() {
    let config = config_with(env_map(&[
        ("MT5_WINE_PREFIX", " "),
        ("MT5_TERMINAL_EXE", " "),
        ("MT5_BACKEND_INI", " "),
    ]));
    assert!(!is_configured(&config));
    assert_eq!(config.config_ini_windows, None);
}

#[test]
fn auto_start_plan_prefers_session_then_inspection_then_gates() {
    use AutoStartPlan::*;
    use ProcessCheck::*;
    // (a) an active bridge session means the terminal behind it runs…
    assert_eq!(auto_start_plan(true, Running, true, true), SessionActive);
    assert_eq!(auto_start_plan(true, Unknown, false, false), SessionActive);
    // …then the process inspection: running → skip; FAILED inspection is
    // `Unknown` and never reaches a spawn…
    assert_eq!(auto_start_plan(false, Running, true, true), AlreadyRunning);
    assert_eq!(auto_start_plan(false, Unknown, true, true), InspectUnknown);
    assert_eq!(
        auto_start_plan(false, Unknown, false, false),
        InspectUnknown
    );
    // …then the opt-out flag, then the on-disk configuration…
    assert_eq!(auto_start_plan(false, NotRunning, false, true), Disabled);
    assert_eq!(
        auto_start_plan(false, NotRunning, true, false),
        Unconfigured
    );
    // …and only a fully gated plan actually starts a terminal.
    assert_eq!(auto_start_plan(false, NotRunning, true, true), Start);
}

#[test]
fn process_exit_codes_preserve_unknown_state() {
    assert_eq!(process_check_from_exit_code(Some(0)), ProcessCheck::Running);
    assert_eq!(
        process_check_from_exit_code(Some(1)),
        ProcessCheck::NotRunning
    );
    for code in [None, Some(2), Some(-1)] {
        assert_eq!(process_check_from_exit_code(code), ProcessCheck::Unknown);
    }
}

#[test]
fn inspection_fakes_cover_states_and_error_fallback() {
    assert_eq!(
        inspect_terminal_with(|| Ok(ProcessCheck::Running)),
        ProcessCheck::Running
    );
    assert_eq!(
        inspect_terminal_with(|| Ok(ProcessCheck::NotRunning)),
        ProcessCheck::NotRunning
    );
    // An inspection ERROR degrades to Unknown — never to NotRunning — so
    // a failed pgrep can never bias the caller toward spawning.
    assert_eq!(
        inspect_terminal_with(|| Err(std::io::Error::other("pgrep missing"))),
        ProcessCheck::Unknown
    );
}

#[test]
fn spawn_lock_is_exclusive_removed_on_drop_and_steals_stale_locks() {
    let dir = fresh_temp_dir("spawn-lock");

    let first = SpawnLock::acquire(&dir).unwrap();
    let second = SpawnLock::acquire(&dir).unwrap_err();
    assert!(
        second.contains("spawn already in progress"),
        "a held lock must refuse the second racer: {second}"
    );
    drop(first);
    assert!(
        !dir.join(SPAWN_LOCK_FILE).exists(),
        "drop removes the lock on every exit path"
    );
    let third = SpawnLock::acquire(&dir).unwrap();
    drop(third);

    // A lock abandoned by a crashed process is stolen once it is stale.
    let path = dir.join(SPAWN_LOCK_FILE);
    std::fs::write(&path, b"").unwrap();
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_modified(
        std::time::SystemTime::now() - std::time::Duration::from_secs(SPAWN_LOCK_STALE_SECS + 60),
    )
    .unwrap();
    drop(file);
    let stolen = SpawnLock::acquire(&dir).unwrap();
    drop(stolen);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[cfg(not(windows))]
#[test]
fn start_terminal_refuses_spawn_while_lock_held_without_spawning() {
    // Valid-looking install, but a fresh lock held by a racer: the spawn
    // section must refuse before ever reaching Command::spawn.
    let prefix = fresh_temp_dir("lock-held");
    std::fs::write(prefix.join(SPAWN_LOCK_FILE), b"").unwrap();
    let config = Mt5BackendConfig {
        wine_prefix: prefix.clone(),
        wine_binary: std::env::current_exe().unwrap(),
        terminal_exe_windows: std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        config_ini_windows: None,
        enabled: true,
    };
    let error = start_terminal_with(&config, || ProcessCheck::NotRunning).unwrap_err();
    assert!(
        error.contains("spawn already in progress"),
        "unexpected error: {error}"
    );
    std::fs::remove_dir_all(&prefix).unwrap();
}

#[test]
fn start_terminal_refuses_spawn_when_inspection_fails() {
    let config = config_with(env_map(&[("HOME", "/synthetic/home")]));
    let error = start_terminal_with(&config, || ProcessCheck::Unknown).unwrap_err();
    assert!(
        error.contains("cannot inspect processes"),
        "unexpected error: {error}"
    );
}

#[cfg(not(windows))]
#[test]
fn start_terminal_refuses_missing_wine_binary() {
    let config = config_with(env_map(&[(
        "MT5_WINE_BINARY",
        "/nonexistent/wine-binary-under-test",
    )]));
    let error = start_terminal_with(&config, || ProcessCheck::NotRunning).unwrap_err();
    assert!(error.contains("wine binary"), "unexpected error: {error}");
}

#[cfg(not(windows))]
#[test]
fn start_terminal_refuses_missing_wine_prefix() {
    let wine_binary = std::env::current_exe().expect("current test binary exists");
    let config = Mt5BackendConfig {
        wine_prefix: PathBuf::from("/nonexistent/wine-prefix-under-test"),
        wine_binary,
        terminal_exe_windows: "C:\\term.exe".to_string(),
        config_ini_windows: None,
        enabled: false,
    };
    let error = start_terminal_with(&config, || ProcessCheck::NotRunning).unwrap_err();
    assert!(error.contains("wine prefix"), "unexpected error: {error}");
}

#[cfg(not(windows))]
#[test]
fn bare_wine_name_resolves_from_injected_path_for_configuration() {
    let directory = fresh_temp_dir("wine-path");
    let executable = directory.join("wine");
    std::fs::write(&executable, b"synthetic executable placeholder").unwrap();
    let prefix = fresh_temp_dir("wine-prefix");
    let config = Mt5BackendConfig {
        wine_prefix: prefix.clone(),
        wine_binary: PathBuf::from("wine"),
        terminal_exe_windows: std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        config_ini_windows: None,
        enabled: true,
    };
    let search_path = env::join_paths([&directory]).unwrap();

    assert_eq!(
        resolve_wine_binary_with_path(&config.wine_binary, Some(&search_path)),
        Some(executable)
    );
    assert!(is_configured_with_path(&config, Some(&search_path)));

    // A path with a separator is explicit: it keeps CWD-relative lookup
    // and is never reinterpreted as a PATH name.
    assert_eq!(
        resolve_wine_binary_with_path(Path::new("./wine"), Some(&search_path)),
        None
    );
    std::fs::remove_dir_all(directory).unwrap();
    std::fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn start_terminal_refuses_double_start_when_already_running() {
    let config = config_with(env_map(&[("HOME", "/synthetic/home")]));
    let error = start_terminal_with(&config, || ProcessCheck::Running).unwrap_err();
    assert!(
        error.contains("already running"),
        "unexpected error: {error}"
    );
}

#[cfg(windows)]
#[test]
fn native_install_needs_an_absolute_existing_executable_and_no_wine() {
    let executable = std::env::current_exe().unwrap();
    let config = config_with(env_map(&[(
        "MT5_TERMINAL_EXE",
        executable.to_str().unwrap(),
    )]));
    assert!(is_configured(&config));
    assert!(terminal_env(&config).is_empty());
    assert!(!is_configured(&config_with(env_map(&[(
        "MT5_TERMINAL_EXE",
        "terminal64.exe"
    )]))));
}

#[test]
fn status_serializes_to_camel_case_shape() {
    let config = config_with(env_map(&[
        ("HOME", "/synthetic/home"),
        ("MT5_BACKEND_ENABLED", "yes"),
    ]));
    let status = status_with(&config, true);
    assert_eq!(
        status,
        Mt5BackendStatus {
            running: true,
            configured: false,
            auto_start_enabled: true,
        }
    );
    let json = serde_json::to_value(status).unwrap();
    assert_eq!(
        json.as_object().map(|object| {
            let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
            keys.sort();
            keys
        }),
        Some(vec!["autoStartEnabled", "configured", "running"])
    );
    assert_eq!(json["running"].as_bool(), Some(true));
    assert_eq!(json["configured"].as_bool(), Some(false));
    assert_eq!(json["autoStartEnabled"].as_bool(), Some(true));
}
