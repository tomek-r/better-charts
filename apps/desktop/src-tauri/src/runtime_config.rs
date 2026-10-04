//! Load private runtime settings before starting the bridge or backend threads.

use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

use crate::execution_journal::app_data_dir;

#[derive(Debug, thiserror::Error)]
pub(crate) enum ConfigError {
    // dotenv parser errors can contain secret values; never include their text.
    #[error("cannot read runtime .env file")]
    Read,
    #[error("invalid runtime .env file")]
    Invalid,
}

fn find_file(candidates: &[PathBuf]) -> Result<Option<PathBuf>, ConfigError> {
    for path in candidates {
        match fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => return Ok(Some(path.clone())),
            Ok(_) => return Err(ConfigError::Read),
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return Err(ConfigError::Read),
        }
    }
    Ok(None)
}

fn read_settings(path: &Path) -> Result<Vec<(String, String)>, ConfigError> {
    let entries = dotenvy::from_path_iter(path).map_err(|_| ConfigError::Read)?;
    let mut seen = HashSet::new();
    let mut settings = Vec::new();
    // Validate the entire file before applying anything, including auto-start.
    for entry in entries {
        let (key, value) = entry.map_err(|_| ConfigError::Invalid)?;
        if key.contains('\0') || value.contains('\0') {
            return Err(ConfigError::Invalid);
        }
        if key.starts_with("MT5_") && seen.insert(key.clone()) {
            settings.push((key, value));
        }
    }
    Ok(settings)
}

fn apply_settings(
    settings: Vec<(String, String)>,
    existing: impl Fn(&str) -> Option<OsString>,
    mut set: impl FnMut(&str, &str),
) {
    for (key, value) in settings {
        if existing(&key).is_none() {
            set(&key, &value);
        }
    }
}

pub(crate) fn load() -> Result<(), ConfigError> {
    let mut candidates = Vec::new();
    if let Some(directory) = app_data_dir() {
        candidates.push(directory.join(".env"));
    }
    if let Ok(executable) = env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join(".env"));
        }
    }
    if let Ok(directory) = env::current_dir() {
        candidates.push(directory.join(".env"));
    }
    if let Some(path) = find_file(&candidates)? {
        let settings = read_settings(&path)?;
        // Called at the beginning of run(), before any application threads.
        apply_settings(
            settings,
            |key| env::var_os(key),
            |key, value| {
                env::set_var(key, value);
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                env::temp_dir().join(format!("better-charts-env-{}-{unique}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, contents: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, contents).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn first_existing_file_wins_without_merging_other_tokens() {
        let fixture = Fixture::new();
        let user = fixture.write("user.env", "MT5_BRIDGE_TOKEN=user-token\n");
        let executable = fixture.write("executable.env", "MT5_BRIDGE_TOKEN=other-token\n");
        assert_eq!(
            find_file(&[user.clone(), executable.clone()]).unwrap(),
            Some(user)
        );
        assert_eq!(
            find_file(&[fixture.0.join("missing"), executable.clone()]).unwrap(),
            Some(executable)
        );
        assert!(find_file(&[fixture.0.join("missing")]).unwrap().is_none());
        assert!(find_file(std::slice::from_ref(&fixture.0)).is_err());
    }

    #[test]
    fn quoted_tokens_comments_crlf_and_duplicate_keys() {
        let fixture = Fixture::new();
        let path = fixture.write(".env", "# private settings\r\nexport MT5_BRIDGE_TOKEN='token with # spaces'\r\nMT5_BACKEND_ENABLED=0 # manual startup\r\nMT5_BRIDGE_TOKEN=ignored\r\nHOME=/ignored\r\n");
        assert_eq!(
            read_settings(&path).unwrap(),
            vec![
                ("MT5_BRIDGE_TOKEN".into(), "token with # spaces".into()),
                ("MT5_BACKEND_ENABLED".into(), "0".into()),
            ]
        );
    }

    #[test]
    fn environment_including_empty_values_takes_precedence() {
        let settings = vec![
            ("MT5_BRIDGE_TOKEN".into(), "file-token".into()),
            ("MT5_BRIDGE_ADDR".into(), "127.0.0.1:8765".into()),
            ("MT5_BACKEND_ENABLED".into(), "0".into()),
        ];
        let mut applied = HashMap::new();
        apply_settings(
            settings,
            |key| match key {
                "MT5_BRIDGE_TOKEN" => Some(OsString::from("shell-token")),
                "MT5_BRIDGE_ADDR" => Some(OsString::new()),
                _ => None,
            },
            |key, value| {
                applied.insert(key.to_owned(), value.to_owned());
            },
        );
        assert_eq!(
            applied,
            HashMap::from([("MT5_BACKEND_ENABLED".into(), "0".into())])
        );
    }

    #[test]
    fn nul_in_a_secret_is_rejected_before_setting_environment() {
        let fixture = Fixture::new();
        let path = fixture.write(".env", "MT5_BRIDGE_TOKEN=private\0value\n");
        assert!(matches!(read_settings(&path), Err(ConfigError::Invalid)));
    }

    #[test]
    fn malformed_file_is_rejected_without_exposing_secrets_or_partial_settings() {
        let fixture = Fixture::new();
        let path = fixture.write(
            ".env",
            "MT5_BACKEND_ENABLED=1\nMT5_BRIDGE_TOKEN='private-unclosed-token\n",
        );
        let error = read_settings(&path).unwrap_err();
        assert_eq!(error.to_string(), "invalid runtime .env file");
        assert!(!format!("{error:?}").contains("private-unclosed-token"));
    }
}
