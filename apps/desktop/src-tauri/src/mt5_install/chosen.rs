//! The MT5 installation the user picked in the setup guide, for this session.
//!
//! Discovery reports the default locations only, so an MT5 installed in a folder of
//! its own stays invisible to the setup guide. `terminal64.exe` picked there becomes
//! an [`Mt5Installation`] like a discovered one: on Windows the chosen file is the
//! Windows path itself, elsewhere the prefix is the folder holding the deepest
//! `drive_c` and the terminal is addressed as `C:\...` inside it, exactly as
//! [`super::locate`] maps the discovered installations.
//!
//! The choice is validated before it is kept: the file has to be named
//! `terminal64.exe` and to exist, a host without Wine support refuses a path that is
//! not inside a prefix, and a Wine host without a `wine` binary refuses the
//! installation, because nothing could start that terminal afterwards.
//!
//! Privacy: only the picked path and its file name are looked at, plus existence
//! checks for the Wine binary. No file content is read and nothing is started.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use thiserror::Error;

use super::discover::{
    host_platform, wine_binary_on_path, HostOs, InstallProbe, InstallationSource, Mt5Installation,
    MACOS_WINE_BINARY, TERMINAL_EXE_FILE,
};
use super::locate::{wine_path_form, HostPlatform};

/// Why the picked file is not an MT5 installation the app can use. Every message is
/// shown to the user as it stands, so it says what to do instead of what went wrong.
#[derive(Debug, Error)]
pub(crate) enum ChooseError {
    #[error("Choose the terminal64.exe file of your MetaTrader 5 installation.")]
    NotTerminal,
    #[error("That terminal64.exe is not inside a Wine prefix (a folder with drive_c).")]
    OutsideWinePrefix,
    #[error("Wine was not found, so this MetaTrader 5 cannot be started from Better Charts.")]
    WineMissing,
}

/// The installation the user picked in the setup guide this session, so the list of
/// installations, the install, and the restart all offer it without a restart of
/// Better Charts. Cleared when the app closes; the settings keep it for the next one.
#[derive(Default)]
pub(crate) struct ChosenInstallation(Mutex<Option<Mt5Installation>>);

impl ChosenInstallation {
    /// The installation the user picked this session, if they have picked one.
    pub(crate) fn get(&self) -> Option<Mt5Installation> {
        self.0.lock().ok().and_then(|chosen| chosen.clone())
    }

    /// Keeps `installation` for the rest of this session, replacing an earlier pick.
    pub(crate) fn set(&self, installation: Mt5Installation) {
        if let Ok(mut chosen) = self.0.lock() {
            *chosen = Some(installation);
        }
    }
}

/// The installation `executable` names, as it applies to `host_os`.
///
/// `probe` supplies the existence checks, so every operating-system branch is
/// unit-tested without touching this machine's disk.
pub(crate) fn installation_from_executable(
    executable: &Path,
    host_os: HostOs,
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Result<Mt5Installation, ChooseError> {
    if !is_terminal_exe(executable) || !probe.is_file(executable) {
        return Err(ChooseError::NotTerminal);
    }
    match host_platform(host_os) {
        HostPlatform::Windows => Ok(Mt5Installation {
            host: HostPlatform::Windows,
            wine_prefix: None,
            wine_binary: None,
            terminal_exe_windows: executable.to_string_lossy().into_owned(),
            source: InstallationSource::Chosen,
        }),
        HostPlatform::Wine => wine_installation(executable, host_os, env, probe),
    }
}

/// Whether `path` names MT5's terminal executable. Compared ASCII case-insensitively
/// because Windows filenames are, and a user may well pick `TERMINAL64.EXE`.
fn is_terminal_exe(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(TERMINAL_EXE_FILE))
}

/// A picked terminal on a Wine host: the prefix above its deepest `drive_c`, the
/// Windows path MT5 knows the executable by, and the Wine binary that can start it.
fn wine_installation(
    executable: &Path,
    host_os: HostOs,
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Result<Mt5Installation, ChooseError> {
    let (wine_prefix, terminal_exe_windows) =
        wine_path_form(executable).ok_or(ChooseError::OutsideWinePrefix)?;
    let wine_binary = wine_binary_for(host_os, env, probe).ok_or(ChooseError::WineMissing)?;
    Ok(Mt5Installation {
        host: HostPlatform::Wine,
        wine_prefix: Some(wine_prefix),
        wine_binary: Some(wine_binary),
        terminal_exe_windows,
        source: InstallationSource::Chosen,
    })
}

/// The Wine binary that starts a terminal picked on `host_os`: on macOS the one the
/// official application bundles when it is installed, which is the build MetaQuotes
/// supports, otherwise a `wine` from `PATH`.
fn wine_binary_for(
    host_os: HostOs,
    env: &dyn Fn(&str) -> Option<String>,
    probe: &impl InstallProbe,
) -> Option<PathBuf> {
    let bundle_binary = Path::new(MACOS_WINE_BINARY);
    if host_os == HostOs::MacOs && probe.is_file(bundle_binary) {
        return Some(bundle_binary.to_path_buf());
    }
    wine_binary_on_path(env, probe)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::super::discover::PATH_VARIABLE;
    use super::*;

    /// Folder the fake `PATH` holds, and the `wine` inside it.
    const TEST_PATH_FOLDER: &str = "/usr/local/bin";
    const WINE_ON_TEST_PATH: &str = "/usr/local/bin/wine";

    /// A picked terminal inside a prefix of its own, the case this module exists for.
    const PICKED_TERMINAL: &str = "/Users/x/prefix/drive_c/Brokers/Acme MT5/terminal64.exe";
    const PICKED_PREFIX: &str = "/Users/x/prefix";
    const PICKED_TERMINAL_WINDOWS: &str = r"C:\Brokers\Acme MT5\terminal64.exe";

    /// A picked terminal on a Windows host, upper case so the accepted spelling is
    /// part of the test. Written with forward slashes because the file name is what
    /// the check reads, and these tests run on every operating system.
    const WINDOWS_PICKED_TERMINAL: &str = "/opt/Acme MT5/TERMINAL64.EXE";

    /// A filesystem that holds exactly the given files.
    struct FakeProbe(HashSet<PathBuf>);

    impl FakeProbe {
        fn holding(files: &[&str]) -> Self {
            Self(files.iter().map(PathBuf::from).collect())
        }
    }

    impl InstallProbe for FakeProbe {
        fn is_file(&self, path: &Path) -> bool {
            self.0.contains(path)
        }

        fn is_dir(&self, _path: &Path) -> bool {
            false
        }

        fn folder_names(&self, _folder: &Path) -> Vec<String> {
            Vec::new()
        }
    }

    /// An environment whose `PATH` holds [`TEST_PATH_FOLDER`].
    fn env_with_path(name: &str) -> Option<String> {
        (name == PATH_VARIABLE).then_some(TEST_PATH_FOLDER.to_string())
    }

    /// An environment without `PATH`, which therefore finds no `wine`.
    fn env_without_path(_name: &str) -> Option<String> {
        None
    }

    #[test]
    fn a_picked_windows_terminal_is_the_path_as_given() {
        let probe = FakeProbe::holding(&[WINDOWS_PICKED_TERMINAL]);

        let installation = installation_from_executable(
            Path::new(WINDOWS_PICKED_TERMINAL),
            HostOs::Windows,
            &env_without_path,
            &probe,
        )
        .expect("a terminal64.exe that exists is accepted");

        assert_eq!(installation.host, HostPlatform::Windows);
        assert_eq!(installation.terminal_exe_windows, WINDOWS_PICKED_TERMINAL);
        assert_eq!(installation.wine_prefix, None);
        assert_eq!(installation.wine_binary, None);
        assert_eq!(installation.source, InstallationSource::Chosen);
    }

    #[test]
    fn a_file_that_is_not_terminal64_exe_is_refused() {
        let executable = "/Users/x/prefix/drive_c/Brokers/Acme MT5/terminal.exe";
        let probe = FakeProbe::holding(&[executable]);

        let chosen = installation_from_executable(
            Path::new(executable),
            HostOs::Windows,
            &env_without_path,
            &probe,
        );

        assert!(matches!(chosen, Err(ChooseError::NotTerminal)));
    }

    #[test]
    fn a_terminal_that_does_not_exist_is_refused() {
        let probe = FakeProbe::holding(&[]);

        let chosen = installation_from_executable(
            Path::new(PICKED_TERMINAL),
            HostOs::Windows,
            &env_without_path,
            &probe,
        );

        assert!(matches!(chosen, Err(ChooseError::NotTerminal)));
    }

    #[test]
    fn a_picked_terminal_inside_a_wine_prefix_maps_to_its_prefix() {
        let probe = FakeProbe::holding(&[PICKED_TERMINAL, MACOS_WINE_BINARY]);

        let installation = installation_from_executable(
            Path::new(PICKED_TERMINAL),
            HostOs::MacOs,
            &env_without_path,
            &probe,
        )
        .expect("a terminal below drive_c is accepted");

        assert_eq!(installation.host, HostPlatform::Wine);
        assert_eq!(installation.wine_prefix, Some(PathBuf::from(PICKED_PREFIX)));
        assert_eq!(installation.terminal_exe_windows, PICKED_TERMINAL_WINDOWS);
        assert_eq!(
            installation.wine_binary,
            Some(PathBuf::from(MACOS_WINE_BINARY))
        );
        assert_eq!(installation.source, InstallationSource::Chosen);
    }

    #[test]
    fn a_picked_terminal_outside_a_wine_prefix_is_refused() {
        let executable = "/Users/x/Brokers/Acme MT5/terminal64.exe";
        let probe = FakeProbe::holding(&[executable, MACOS_WINE_BINARY]);

        let chosen = installation_from_executable(
            Path::new(executable),
            HostOs::MacOs,
            &env_with_path,
            &probe,
        );

        assert!(matches!(chosen, Err(ChooseError::OutsideWinePrefix)));
    }

    #[test]
    fn macos_falls_back_to_the_wine_on_path() {
        let probe = FakeProbe::holding(&[PICKED_TERMINAL, WINE_ON_TEST_PATH]);

        let installation = installation_from_executable(
            Path::new(PICKED_TERMINAL),
            HostOs::MacOs,
            &env_with_path,
            &probe,
        )
        .expect("a terminal below drive_c is accepted");

        assert_eq!(
            installation.wine_binary,
            Some(PathBuf::from(WINE_ON_TEST_PATH))
        );
    }

    #[test]
    fn linux_without_wine_on_path_reports_the_missing_wine() {
        let probe = FakeProbe::holding(&[PICKED_TERMINAL]);

        let chosen = installation_from_executable(
            Path::new(PICKED_TERMINAL),
            HostOs::Linux,
            &env_without_path,
            &probe,
        );

        assert!(matches!(chosen, Err(ChooseError::WineMissing)));
    }
}
