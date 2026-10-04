//! Private desktop configuration. Saved edits take effect on the next launch.

use crate::{
    bridge::{connection::validate_bind_address, handshake::configured_transfer_limits},
    execution_journal::app_data_dir,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

const SETTINGS_FILE: &str = "settings.json";
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;

// Deliberately no Debug: this model contains an authentication secret.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppSettings {
    pub token: String,
    pub address: String,
    pub max_frame_bytes: u32,
    pub trading_enabled: bool,
    pub auto_start_mt5: bool,
    pub terminal_path: String,
    pub wine_prefix: String,
    pub wine_binary: String,
    pub config_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            token: String::new(),
            address: "127.0.0.1:8765".into(),
            max_frame_bytes: trading_core::protocol::default_frame_bytes(),
            trading_enabled: false,
            auto_start_mt5: false,
            terminal_path: String::new(),
            wine_prefix: String::new(),
            wine_binary: "wine".into(),
            config_path: String::new(),
        }
    }
}

impl AppSettings {
    fn validate(&self) -> Result<(), String> {
        if self.token.trim().is_empty()
            || self.token.len() > 512
            || self.token.chars().any(char::is_control)
        {
            return Err("Token must contain 1–512 bytes and no control characters".into());
        }
        let address = validate_bind_address(&self.address).map_err(str::to_owned)?;
        if address.port() == 0 {
            return Err("Bridge port must be between 1 and 65535".into());
        }
        configured_transfer_limits(Some(&self.max_frame_bytes.to_string()))
            .map_err(str::to_owned)?;
        for path in [
            &self.terminal_path,
            &self.wine_prefix,
            &self.wine_binary,
            &self.config_path,
        ] {
            if path.len() > 4096 || path.chars().any(char::is_control) {
                return Err("Installation paths must be at most 4096 bytes and contain no control characters".into());
            }
        }
        if self.auto_start_mt5
            && (self.terminal_path.trim().is_empty()
                || (!cfg!(windows)
                    && (self.wine_prefix.trim().is_empty() || self.wine_binary.trim().is_empty())))
        {
            return Err("Auto-start requires an MT5 executable and, on macOS/Linux, a Wine prefix and executable".into());
        }
        Ok(())
    }

    fn variables(&self) -> Vec<(&'static str, String)> {
        vec![
            ("MT5_BRIDGE_TOKEN", self.token.clone()),
            ("MT5_BRIDGE_ADDR", self.address.clone()),
            (
                "MT5_BRIDGE_MAX_FRAME_BYTES",
                self.max_frame_bytes.to_string(),
            ),
            (
                "MT5_BRIDGE_TRADING_ENABLED",
                self.trading_enabled.to_string(),
            ),
            ("MT5_BACKEND_ENABLED", self.auto_start_mt5.to_string()),
            ("MT5_TERMINAL_EXE", self.terminal_path.clone()),
            ("MT5_WINE_PREFIX", self.wine_prefix.clone()),
            ("MT5_WINE_BINARY", self.wine_binary.clone()),
            ("MT5_BACKEND_INI", self.config_path.clone()),
        ]
    }

    fn with_overrides(mut self, overrides: &HashMap<String, String>) -> (Self, Vec<String>) {
        let mut keys = Vec::new();
        for (env_key, field) in [
            ("MT5_BRIDGE_TOKEN", "token"),
            ("MT5_BRIDGE_ADDR", "address"),
            ("MT5_BRIDGE_MAX_FRAME_BYTES", "maxFrameBytes"),
            ("MT5_BRIDGE_TRADING_ENABLED", "tradingEnabled"),
            ("MT5_BACKEND_ENABLED", "autoStartMt5"),
            ("MT5_TERMINAL_EXE", "terminalPath"),
            ("MT5_WINE_PREFIX", "winePrefix"),
            ("MT5_WINE_BINARY", "wineBinary"),
            ("MT5_BACKEND_INI", "configPath"),
        ] {
            if let Some(value) = overrides.get(env_key) {
                keys.push(field.to_owned());
                match env_key {
                    "MT5_BRIDGE_TOKEN" => self.token = value.clone(),
                    "MT5_BRIDGE_ADDR" => self.address = value.clone(),
                    "MT5_BRIDGE_MAX_FRAME_BYTES" => {
                        self.max_frame_bytes = value.parse().unwrap_or(0)
                    }
                    "MT5_BRIDGE_TRADING_ENABLED" => self.trading_enabled = enabled(value),
                    "MT5_BACKEND_ENABLED" => self.auto_start_mt5 = enabled(value),
                    "MT5_TERMINAL_EXE" => self.terminal_path = value.clone(),
                    "MT5_WINE_PREFIX" => self.wine_prefix = value.clone(),
                    "MT5_WINE_BINARY" => self.wine_binary = value.clone(),
                    "MT5_BACKEND_INI" => self.config_path = value.clone(),
                    _ => unreachable!(),
                }
            }
        }
        (self, keys)
    }
}

fn enabled(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettingsView {
    pub mt5_bridge_settings: AppSettings,
    pub configured: bool,
    pub first_launch: bool,
    pub restart_required: bool,
    pub platform: &'static str,
    pub overridden_keys: Vec<String>,
    pub configuration_error: Option<String>,
}

struct StoredSettings {
    view: AppSettingsView,
}
pub(crate) struct AppSettingsState {
    path: Option<PathBuf>,
    inner: Mutex<StoredSettings>,
    startup_trading_enabled: bool,
    startup_settings: AppSettings,
    overrides: HashMap<String, String>,
    runtime_error: Option<String>,
}

fn read_file(path: &Path) -> Result<Option<AppSettings>, String> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read saved settings".into()),
    };
    if file
        .metadata()
        .map_err(|_| "Cannot read saved settings")?
        .len()
        > MAX_SETTINGS_BYTES
    {
        return Err("Saved settings file is too large".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read saved settings")?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("Saved settings file is too large".into());
    }
    let settings: AppSettings =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid saved settings")?;
    settings.validate().map_err(|_| "Invalid saved settings")?;
    Ok(Some(settings))
}

fn persist(path: &Path, settings: &AppSettings) -> Result<(), String> {
    settings.validate()?;
    let parent = path.parent().ok_or("Settings directory is unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create settings directory")?;
    let temporary = parent.join(format!(
        ".settings-{}-{}-{}.tmp",
        std::process::id(),
        FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Cannot save settings")?
            .as_nanos()
    ));
    let mut created = false;
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Cannot create private settings file")?;
        created = true;
        serde_json::to_writer_pretty(&mut file, settings).map_err(|_| "Cannot encode settings")?;
        file.write_all(b"\n").map_err(|_| "Cannot write settings")?;
        file.sync_all().map_err(|_| "Cannot flush settings")?;
        drop(file);
        // Same-directory rename replaces files on Windows and Unix; never delete
        // the previous settings before the replacement has been fully written.
        fs::rename(&temporary, path).map_err(|_| "Cannot replace saved settings")?;
        Ok(())
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(temporary);
    }
    result
}

impl AppSettingsState {
    pub(crate) fn load(runtime_error: Option<String>) -> Self {
        let path = app_data_dir().map(|directory| directory.join(SETTINGS_FILE));
        let overrides: HashMap<_, _> = AppSettings::default()
            .variables()
            .into_iter()
            .filter_map(|(key, _)| env::var(key).ok().map(|value| (key.to_owned(), value)))
            .collect();
        let state = Self::resolve(path, overrides, runtime_error);
        let settings = state
            .inner
            .lock()
            .expect("settings mutex poisoned")
            .view
            .mt5_bridge_settings
            .clone();
        // This happens before application threads start; save never mutates env.
        for (key, value) in settings.variables() {
            if env::var_os(key).is_none() {
                env::set_var(key, value);
            }
        }
        // A corrupt persisted configuration must never enable execution or spawn.
        if state
            .inner
            .lock()
            .expect("settings mutex poisoned")
            .view
            .configuration_error
            .is_some()
        {
            env::set_var("MT5_BACKEND_ENABLED", "false");
        }
        state
    }

    fn resolve(
        path: Option<PathBuf>,
        overrides: HashMap<String, String>,
        dotenv_error: Option<String>,
    ) -> Self {
        let saved = path.as_ref().map_or(Ok(None), |path| read_file(path));
        let (base, persisted, mut error) = match saved {
            Ok(Some(settings)) => (settings, true, None),
            Ok(None) => (AppSettings::default(), false, None),
            Err(error) => (AppSettings::default(), false, Some(error)),
        };
        let (mut settings, overridden_keys) = base.with_overrides(&overrides);
        let mut validation_settings = settings.clone();
        if validation_settings.token.is_empty() {
            validation_settings.token = "unset-token".into();
        }
        let invalid_bool = ["MT5_BRIDGE_TRADING_ENABLED", "MT5_BACKEND_ENABLED"]
            .iter()
            .any(|key| {
                overrides.get(*key).is_some_and(|value| {
                    !matches!(
                        value.trim().to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on" | "0" | "false" | "no" | "off"
                    )
                })
            });
        let runtime_error = dotenv_error.or_else(|| {
            (invalid_bool || validation_settings.validate().is_err())
                .then(|| "Runtime settings are invalid; check environment overrides".into())
        });
        if runtime_error.is_some() {
            error = runtime_error.clone();
        }
        if error.is_some() {
            settings.trading_enabled = false;
            settings.auto_start_mt5 = false;
        }
        let configured = error.is_none() && settings.validate().is_ok();
        let startup_trading_enabled = configured && settings.trading_enabled;
        settings.trading_enabled = startup_trading_enabled;
        Self {
            path,
            startup_trading_enabled,
            startup_settings: settings.clone(),
            overrides,
            runtime_error,
            inner: Mutex::new(StoredSettings {
                view: AppSettingsView {
                    mt5_bridge_settings: settings,
                    configured,
                    first_launch: !persisted || error.is_some(),
                    restart_required: false,
                    platform: if cfg!(windows) {
                        "windows"
                    } else if cfg!(target_os = "macos") {
                        "macos"
                    } else {
                        "linux"
                    },
                    overridden_keys,
                    configuration_error: error,
                },
            }),
        }
    }

    pub(crate) fn startup_trading_enabled(&self) -> bool {
        self.startup_trading_enabled
    }
    fn view(&self) -> Result<AppSettingsView, String> {
        self.inner
            .lock()
            .map(|inner| inner.view.clone())
            .map_err(|_| "Settings are unavailable".into())
    }
    fn save(&self, settings: AppSettings) -> Result<AppSettingsView, String> {
        let mut inner = self.inner.lock().map_err(|_| "Settings are unavailable")?;
        let path = self
            .path
            .as_ref()
            .ok_or("Settings directory is unavailable")?;
        persist(path, &settings)?;
        inner.view.mt5_bridge_settings = settings;
        inner.view.configured = true;
        inner.view.first_launch = false;
        let (effective, _) = inner
            .view
            .mt5_bridge_settings
            .clone()
            .with_overrides(&self.overrides);
        inner.view.restart_required = effective != self.startup_settings;
        inner.view.configuration_error = self.runtime_error.clone();
        Ok(inner.view.clone())
    }
}

#[tauri::command]
pub(crate) fn get_app_settings(
    state: tauri::State<'_, AppSettingsState>,
) -> Result<AppSettingsView, String> {
    state.view()
}
#[tauri::command]
pub(crate) fn save_app_settings(
    settings: AppSettings,
    state: tauri::State<'_, AppSettingsState>,
) -> Result<AppSettingsView, String> {
    state.save(settings)
}

#[cfg(test)]
mod tests;
