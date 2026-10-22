//! The Tauri commands the setup guide calls: list the MT5 installations this machine
//! has, tell the guide's native file picker which folder to start in, take the one the
//! user picks in a non-default folder into that list, install the bundled MQL5 files
//! into one of their data folders and compile them, and restart MT5 with the bridge
//! advisor attached.
//!
//! Every command starts from the same fresh scan through `discover` and `locate`,
//! plus the installation the user picked this session through `chosen`, so the
//! terminal and `MQL5` paths the guide just showed are the only paths a command
//! accepts: a path from a stale list, from another machine, or from a different
//! installation is refused before anything is written. The install, the compile, and
//! the restart run on a blocking thread, because MetaEditor takes seconds and closing
//! a terminal means waiting for it.
//!
//! Security: the install command never starts the MT5 terminal, and none of them ever
//! touches AutoTrading. The writes are the two `.mq5` files, MetaEditor's own `.ex5`
//! and `.log` output beside them, and the settings paths — the ones the user has not
//! set yet after a successful install, and the installation paths of an installation
//! the user picked. The restart adds the two startup files `restart`
//! documents, which it deletes again as soon as the terminal has read them.

use std::env;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use super::chosen::{installation_from_executable, ChosenInstallation};
use super::compile::{compile_installed, CompileResult, ProcessRunner};
use super::discover::{
    discover_this_machine, home_folder, program_files_folder, HostOs, HostProbe, InstallProbe,
    InstallationSource, Mt5Installation, LINUX_PREFIX_FOLDERS, MACOS_PREFIX_FOLDER,
};
use super::install::{install_bundled_sources, BundledSources, InstallOutcome, InstalledFile};
use super::locate::{
    current_host_os, existing_copy, install_dir, locate_data_folders, DataFolder, Layout, Mql5File,
};
use super::restart::{
    new_session_live, poll_count, remove_startup_files, remove_startup_files_in,
    restart_with_expert, RestartPolicy, RestartRequest, StartupFiles, SystemTerminal,
};
use crate::app_settings::AppSettingsState;
use crate::bridge::accept::expect_restarted_terminal;
use crate::bridge::state::{tauri_events, BridgeConnectionState, BridgeState, DEFAULT_ADDR};
use crate::download_resources::{EXPERT_ADVISOR_RESOURCE, INDICATOR_RESOURCE};
use crate::execution_adapter::{ExecutionAdapterState, ExecutionQueueView};

/// Reported when a located data folder has no parent to compile in. A located folder
/// always has one, so this only guards the impossible case instead of panicking.
const UNRESOLVABLE_DATA_FOLDER: &str =
    "The MT5 data folder cannot be resolved; reload the list of installations and try again.";

/// One MT5 installation the setup guide offers, as `list_mt5_installations` reports
/// it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mt5InstallationView {
    /// Windows path of `terminal64.exe`, in the form the install command accepts
    /// back.
    pub terminal_path: String,
    /// Name of the install folder, e.g. `MetaTrader 5`.
    pub label: String,
    /// Whether the `MT5_*` environment variables configured this installation.
    pub configured: bool,
    /// Every `MQL5` folder the installation uses; empty when it has none.
    pub data_folders: Vec<DataFolderView>,
}

/// One `MQL5` folder of an installation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataFolderView {
    /// Host path of the folder, which the install command accepts back verbatim.
    pub mql5_path: String,
    pub layout: ReportedLayout,
    /// Whether a copy of the bridge advisor's source already exists anywhere below
    /// this folder: an older copy counts too, so a first launch does not force the
    /// guide's install step.
    pub expert_advisor_installed: bool,
}

/// Where MT5 keeps a data folder, as the form asks the user to choose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReportedLayout {
    Portable,
    Standard,
}

impl From<Layout> for ReportedLayout {
    fn from(layout: Layout) -> Self {
        match layout {
            Layout::Portable => Self::Portable,
            Layout::Standard => Self::Standard,
        }
    }
}

/// What installing and compiling the two bundled files produced.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mt5InstallReport {
    /// One entry per installed file, indicator first as the install step writes it.
    pub files: Vec<FileReport>,
}

/// What a restart did. The terminal is starting again with the bridge advisor
/// attached; the session itself shows up in the bridge status, which is the one place
/// that reports it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestartReport {
    pub restarted: bool,
}

/// What happened to one bundled file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileReport {
    pub file: ReportedFile,
    /// Host path of the installed copy.
    pub path: String,
    pub outcome: ReportedOutcome,
    /// `None` when the file was not compiled: a broken indicator ends the run, so
    /// the expert advisor that loads it is never compiled.
    pub compiled: Option<CompiledView>,
}

/// The bundled file, named by the role it plays in MT5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReportedFile {
    ExpertAdvisor,
    Indicator,
}

impl From<Mql5File> for ReportedFile {
    fn from(file: Mql5File) -> Self {
        match file {
            Mql5File::ExpertAdvisor => Self::ExpertAdvisor,
            Mql5File::Indicator => Self::Indicator,
        }
    }
}

/// What the install step did to one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReportedOutcome {
    Installed,
    Updated,
    Unchanged,
}

impl From<InstallOutcome> for ReportedOutcome {
    fn from(outcome: InstallOutcome) -> Self {
        match outcome {
            InstallOutcome::Installed => Self::Installed,
            InstallOutcome::Updated => Self::Updated,
            InstallOutcome::Unchanged => Self::Unchanged,
        }
    }
}

/// MetaEditor's result for one file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompiledView {
    pub errors: u32,
    pub warnings: u32,
    /// The log's error and warning lines, already capped by the compiler.
    pub messages: Vec<String>,
}

/// Host path as the guide shows it, and therefore also the exact string the install
/// command compares against: the two commands agree because they share this form.
fn host_path_text(path: &Path) -> String {
    path.display().to_string()
}

/// Label of an installation: the name of its install folder, taken from the Windows
/// path (`C:\Program Files\MetaTrader 5\terminal64.exe` becomes `MetaTrader 5`),
/// which is the name MT5's own windows show.
fn installation_label(terminal_exe_windows: &str) -> String {
    let trimmed = terminal_exe_windows.trim().trim_end_matches(['\\', '/']);
    let install_folder = trimmed
        .rsplit_once(['\\', '/'])
        .map_or("", |(folder, _terminal_exe)| folder);
    let label = install_folder
        .rsplit_once(['\\', '/'])
        .map_or(install_folder, |(_parent, name)| name);
    if label.is_empty() {
        return trimmed.to_string();
    }
    label.to_string()
}

fn data_folder_view(folder: &DataFolder) -> DataFolderView {
    DataFolderView {
        mql5_path: host_path_text(&folder.mql5),
        layout: folder.layout.into(),
        expert_advisor_installed: existing_copy(&folder.mql5, Mql5File::ExpertAdvisor).is_some(),
    }
}

/// One list entry per installation, in discovery order. An installation without a
/// data folder is listed with an empty list, so the guide can say that MT5 has not
/// created one yet instead of hiding the installation.
pub(super) fn installation_views(
    installations: &[LocatedInstallation],
) -> Vec<Mt5InstallationView> {
    installations
        .iter()
        .map(|located| Mt5InstallationView {
            terminal_path: located.installation.terminal_exe_windows.clone(),
            label: installation_label(&located.installation.terminal_exe_windows),
            configured: located.installation.source == InstallationSource::Configured,
            data_folders: located.data_folders.iter().map(data_folder_view).collect(),
        })
        .collect()
}

fn compiled_view(result: &CompileResult) -> CompiledView {
    CompiledView {
        errors: result.errors,
        warnings: result.warnings,
        messages: result.messages.clone(),
    }
}

/// The report the guide shows: every installed file with the compile result that
/// belongs to it. A file the compile loop never reached has no result, so its
/// `compiled` stays `None` instead of guessing.
pub(super) fn install_report(
    installed: &[InstalledFile],
    compiles: &[CompileResult],
) -> Mt5InstallReport {
    Mt5InstallReport {
        files: installed
            .iter()
            .map(|installed_file| FileReport {
                file: installed_file.file.into(),
                path: host_path_text(&installed_file.path),
                outcome: installed_file.outcome.into(),
                compiled: compiles
                    .iter()
                    .find(|result| result.file == installed_file.file)
                    .map(compiled_view),
            })
            .collect(),
    }
}

/// One installation together with the data folders located under it, which is what
/// both commands work from.
#[derive(Debug)]
pub(super) struct LocatedInstallation {
    pub(super) installation: Mt5Installation,
    pub(super) data_folders: Vec<DataFolder>,
}

/// The installation and data folder a request names, resolved back to the paths the
/// installer and the compiler act on.
#[derive(Debug)]
pub(super) struct InstallTarget {
    pub(super) installation: Mt5Installation,
    pub(super) data_folder: DataFolder,
}

/// Matches the requested paths against what this machine reports right now.
///
/// Both compare exact strings, the same ones the list returned: a terminal that is
/// gone, a path from another machine, and a data folder of a different installation
/// all fail closed, so an install can only ever write into a folder the guide showed
/// for the installation the guide showed.
pub(super) fn matched_target(
    installations: &[LocatedInstallation],
    terminal_path: &str,
    mql5_path: &str,
) -> Result<InstallTarget, String> {
    let located = installations
        .iter()
        .find(|candidate| candidate.installation.terminal_exe_windows == terminal_path)
        .ok_or_else(|| {
            format!(
                "MT5 is not installed at {terminal_path} any more; reload the list of \
                 installations and try again."
            )
        })?;
    let data_folder = located
        .data_folders
        .iter()
        .find(|folder| host_path_text(&folder.mql5) == mql5_path)
        .ok_or_else(|| {
            format!(
                "{mql5_path} is not a data folder of this MT5 installation; reload the list \
                 of installations and try again."
            )
        })?;
    Ok(InstallTarget {
        installation: located.installation.clone(),
        data_folder: data_folder.clone(),
    })
}

/// Every installation on this machine, each with the data folders located under it.
///
/// `chosen` is the installation the user picked in the setup guide this session: it
/// comes first, and the discovered entry it names is dropped, so the guide offers one
/// row per terminal. The scan is repeated per command on purpose: a terminal installed
/// since the window opened is then offered, and an installation that has disappeared
/// is refused instead of written into.
fn installations_on_this_machine(chosen: Option<Mt5Installation>) -> Vec<LocatedInstallation> {
    let discovered: Vec<Mt5Installation> = discover_this_machine()
        .into_iter()
        .filter(|installation| !stands_for(installation, chosen.as_ref()))
        .collect();
    chosen
        .into_iter()
        .chain(discovered)
        .map(located_installation)
        .collect()
}

/// One installation with the data folders located under it.
fn located_installation(installation: Mt5Installation) -> LocatedInstallation {
    let data_folders = locate_data_folders(&installation);
    LocatedInstallation {
        installation,
        data_folders,
    }
}

/// Whether `installation` names the same terminal as `chosen`, which the picked
/// installation then replaces. Paths are compared case-insensitively, because the same
/// Windows folder can be spelled in either case.
fn stands_for(installation: &Mt5Installation, chosen: Option<&Mt5Installation>) -> bool {
    chosen.is_some_and(|chosen| {
        installation
            .terminal_exe_windows
            .eq_ignore_ascii_case(&chosen.terminal_exe_windows)
            && installation.wine_prefix == chosen.wine_prefix
    })
}

/// Host path of a bundled resource, resolved the same way `save_bundled_resource`
/// resolves it.
fn resolve_bundled_resource(app: &AppHandle, resource: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|error| {
            format!("The bundled MQL5 file {resource} is missing from the app: {error}.")
        })
}

/// The two files the app ships, as the installer reads them.
fn bundled_sources(app: &AppHandle) -> Result<BundledSources, String> {
    Ok(BundledSources {
        expert_advisor: resolve_bundled_resource(app, EXPERT_ADVISOR_RESOURCE)?,
        indicator: resolve_bundled_resource(app, INDICATOR_RESOURCE)?,
    })
}

/// Installs both files into the target's data folder and compiles them.
///
/// The compiler runs with the `MQL5` folder's parent as its working folder, because
/// MetaEditor takes the source path relative to it. Runs on a blocking thread.
fn install_and_compile(
    target: &InstallTarget,
    sources: &BundledSources,
    queue: &ExecutionQueueView,
) -> Result<Mt5InstallReport, String> {
    let installed = install_bundled_sources(sources, &target.data_folder.mql5, queue)
        .map_err(|error| error.to_string())?;
    let data_folder = target
        .data_folder
        .mql5
        .parent()
        .ok_or_else(|| UNRESOLVABLE_DATA_FOLDER.to_string())?;
    let compiles = compile_installed(
        &target.installation,
        data_folder,
        &installed,
        &ProcessRunner::default(),
    )
    .map_err(|error| error.to_string())?;
    Ok(install_report(&installed, &compiles))
}

/// Every MT5 installation on this machine, with the `MQL5` folders it uses, so the
/// setup guide can offer the choice of where to install. The installation the user
/// picked this session is listed first.
#[tauri::command]
pub(crate) fn list_mt5_installations(
    chosen: tauri::State<'_, ChosenInstallation>,
) -> Vec<Mt5InstallationView> {
    installation_views(&installations_on_this_machine(chosen.get()))
}

/// Parts of a Wine prefix that hold the folder MT5 installs into by default.
const WINE_PROGRAM_FILES_FOLDER: [&str; 2] = ["drive_c", "Program Files"];

/// `drive_c/Program Files` of a Wine prefix.
fn wine_program_files(wine_prefix: &Path) -> PathBuf {
    WINE_PROGRAM_FILES_FOLDER
        .iter()
        .fold(wine_prefix.to_path_buf(), |folder, part| folder.join(part))
}

/// The first of `prefix_folders` below `$HOME` whose `Program Files` exists.
fn existing_wine_program_files(
    env: &dyn Fn(&str) -> Option<String>,
    prefix_folders: &[&str],
    probe: &impl InstallProbe,
) -> Option<PathBuf> {
    let home = home_folder(env)?;
    prefix_folders
        .iter()
        .map(|prefix_folder| wine_program_files(&home.join(prefix_folder)))
        .find(|program_files| probe.is_dir(program_files))
}

/// Folder a picker opens in when nothing was detected: where MT5 installs by
/// default on this host.
fn default_program_folder(
    env: &dyn Fn(&str) -> Option<String>,
    host_os: HostOs,
    probe: &impl InstallProbe,
) -> Option<PathBuf> {
    match host_os {
        HostOs::Windows => Some(PathBuf::from(program_files_folder(env))),
        HostOs::MacOs => existing_wine_program_files(env, &[MACOS_PREFIX_FOLDER], probe),
        HostOs::Linux => existing_wine_program_files(env, &LINUX_PREFIX_FOLDERS, probe),
    }
}

/// Folder the native file picker for `terminal64.exe` opens in: the install folder
/// of the first installation this machine lists, else the default program folder.
/// `None` when no default program folder exists either.
fn picker_start_folder(
    env: &dyn Fn(&str) -> Option<String>,
    host_os: HostOs,
    probe: &impl InstallProbe,
    first_installation: Option<&Mt5Installation>,
) -> Option<String> {
    let install_folder = first_installation.and_then(install_dir);
    let start_folder = match install_folder {
        Some(folder) => Some(folder),
        None => default_program_folder(env, host_os, probe),
    };
    start_folder.map(|folder| folder.to_string_lossy().into_owned())
}

/// Folder the setup guide's native file picker for `terminal64.exe` starts in, so
/// pointing at an MT5 installed anywhere else takes one click instead of a walk
/// through the disk.
#[tauri::command]
pub(crate) fn mt5_picker_start_folder(
    chosen: tauri::State<'_, ChosenInstallation>,
) -> Option<String> {
    let env: &dyn Fn(&str) -> Option<String> = &|name: &str| env::var(name).ok();
    let installations = installations_on_this_machine(chosen.get());
    picker_start_folder(
        env,
        current_host_os(),
        &HostProbe,
        installations.first().map(|located| &located.installation),
    )
}

/// Adopts the `terminal64.exe` the user picked in the setup guide and reports the
/// installations of this machine with it included.
///
/// A default install folder is found by [`super::discover`], but an MT5 installed
/// anywhere else is invisible to it, so the guide lets the user point at its
/// `terminal64.exe` instead of asking for a path to type. The pick applies at once —
/// the list, the install, and the restart all use it without restarting Better
/// Charts — and its paths are saved for the next launch.
///
/// The pick is validated before it is kept, so a file that is not MT5's terminal, a
/// path outside a Wine prefix, and a machine without Wine are refused with a message
/// the guide can show.
#[tauri::command]
pub(crate) fn choose_mt5_installation(
    app: AppHandle,
    path: String,
) -> Result<Vec<Mt5InstallationView>, String> {
    let env: &dyn Fn(&str) -> Option<String> = &|name: &str| env::var(name).ok();
    let installation =
        installation_from_executable(Path::new(&path), current_host_os(), env, &HostProbe)
            .map_err(|error| error.to_string())?;
    app.state::<ChosenInstallation>().set(installation.clone());
    app.state::<AppSettingsState>()
        .store_chosen_installation(&installation);
    Ok(installation_views(&installations_on_this_machine(Some(
        installation,
    ))))
}

/// Runs [`install_and_compile`] on a blocking thread, because MetaEditor takes
/// seconds.
async fn blocking_install(
    target: InstallTarget,
    sources: BundledSources,
    queue: ExecutionQueueView,
) -> Result<Mt5InstallReport, String> {
    tauri::async_runtime::spawn_blocking(move || install_and_compile(&target, &sources, &queue))
        .await
        .map_err(|error| format!("The install did not complete: {error}."))?
}

/// Installs the bundled MQL5 files into one data folder and compiles them.
///
/// `terminal_path` and `mql5_path` must be the values [`list_mt5_installations`]
/// returned for this machine right now; anything else is refused, so a stale or
/// edited request can never write into a folder the guide did not show. An order
/// queued or in flight also refuses the whole install: recompiling the attached
/// advisor would drop the bridge session under it.
///
/// A successful install also fills the settings paths the user has not set from the
/// installation that just worked, so the next launch can reach that terminal. The
/// fill is best effort and never fails the install, and the auto-start flag keeps
/// its own value, so it never starts MT5 by itself.
#[tauri::command]
pub(crate) async fn install_to_mt5(
    app: AppHandle,
    terminal_path: String,
    mql5_path: String,
) -> Result<Mt5InstallReport, String> {
    let installations = installations_on_this_machine(app.state::<ChosenInstallation>().get());
    let target = matched_target(&installations, &terminal_path, &mql5_path)?;
    let installation = target.installation.clone();
    let sources = bundled_sources(&app)?;
    // Sampled right before installing, so an order submitted while the scan ran still
    // leaves both files untouched.
    let queue = app.state::<ExecutionAdapterState>().queue_status();
    let report = blocking_install(target, sources, queue).await?;
    app.state::<AppSettingsState>()
        .fill_from_installation(&installation);
    Ok(report)
}

/// Environment variable of the bridge bind address, read the way `run_server` reads
/// it, so the startup preset names exactly the address the app listens on.
const BRIDGE_ADDRESS_VARIABLE: &str = "MT5_BRIDGE_ADDR";
/// Environment variable of the bridge token the advisor has to present.
const BRIDGE_TOKEN_VARIABLE: &str = "MT5_BRIDGE_TOKEN";

/// The bridge endpoint a restarted terminal has to reach: the address the bridge
/// listens on, and the token it expects.
fn bridge_endpoint() -> (String, String) {
    let address = env::var(BRIDGE_ADDRESS_VARIABLE).unwrap_or_else(|_| DEFAULT_ADDR.to_string());
    let token = env::var(BRIDGE_TOKEN_VARIABLE).unwrap_or_default();
    (address, token)
}

/// Connection state and session id the bridge reports right now.
fn bridge_session(bridge: &BridgeState) -> (bool, Option<String>) {
    let connected = bridge
        .status
        .lock()
        .map(|status| status.state == BridgeConnectionState::Connected)
        .unwrap_or(false);
    let session = bridge
        .current_session
        .lock()
        .ok()
        .and_then(|session| session.clone());
    (connected, session)
}

/// Deletes the two startup files once the restarted terminal has read them, because
/// the preset holds the bridge token. Best effort, and only a *new* bridge session
/// counts, so the files stay on disk until MT5 has started — even while the session
/// the restart replaced is still reported as connected.
fn spawn_startup_cleanup(bridge: BridgeState, files: StartupFiles, replaced: Option<String>) {
    let policy = RestartPolicy::default();
    tauri::async_runtime::spawn(async move {
        let polls = poll_count(policy.cleanup_poll, policy.cleanup_timeout);
        for _ in 0..polls {
            let (connected, session) = bridge_session(&bridge);
            if new_session_live(connected, session.as_deref(), replaced.as_deref()) {
                break;
            }
            tokio::time::sleep(policy.cleanup_poll).await;
        }
        remove_startup_files(&files);
    });
}

/// Runs [`restart_with_expert`] on a blocking thread: closing the terminal, waiting
/// for it to be gone, and launching it again are all blocking calls.
async fn blocking_restart(
    request: RestartRequest,
    queue: ExecutionQueueView,
) -> Result<StartupFiles, String> {
    let policy = RestartPolicy::default();
    tauri::async_runtime::spawn_blocking(move || {
        restart_with_expert(&request, &queue, &SystemTerminal, &policy)
    })
    .await
    .map_err(|error| format!("The MT5 restart did not complete: {error}."))?
    .map_err(|error| error.to_string())
}

/// Deletes the startup files an interrupted restart left behind in every installation
/// this machine has. Run once at app start: the preset holds the bridge token, so
/// nothing of it may stay on disk. Best effort, and never fails startup.
pub(crate) fn remove_leftover_startup_files() {
    for located in installations_on_this_machine(None) {
        remove_startup_files_in(&located.installation, &located.data_folders);
    }
}

/// Closes MT5 and starts it again with the bridge advisor attached, its inputs taken
/// from the app's bridge settings.
///
/// `terminal_path` and `mql5_path` must be the values [`list_mt5_installations`]
/// returned for this machine right now, exactly like [`install_to_mt5`]. The advisor
/// has to be installed and compiled in that data folder first, so a restart never
/// starts a terminal that could not connect, and a queued or in-flight order refuses
/// the restart, because closing the terminal would lose it.
///
/// A successful restart also clears a bridge refusal left by the terminal it just
/// stopped: that terminal is gone, and the new one starts with the current token and
/// the freshly installed files, so the bridge reports `connecting` again until the
/// new session answers. A refused restart changes nothing.
#[tauri::command]
pub(crate) async fn restart_mt5_with_ea(
    app: AppHandle,
    terminal_path: String,
    mql5_path: String,
) -> Result<RestartReport, String> {
    let installations = installations_on_this_machine(app.state::<ChosenInstallation>().get());
    let target = matched_target(&installations, &terminal_path, &mql5_path)?;
    // Sampled before the terminal closes, so the cleanup waits for the session that
    // replaces this one instead of the one the restart ends.
    let (_, replaced) = bridge_session(app.state::<BridgeState>().inner());
    // Sampled right before the restart, so an order submitted while the scan ran still
    // leaves the terminal untouched.
    let queue = app.state::<ExecutionAdapterState>().queue_status();
    let (address, token) = bridge_endpoint();
    let request = RestartRequest {
        installation: target.installation,
        data_folder: target.data_folder,
        address,
        token,
    };
    let files = blocking_restart(request, queue).await?;
    let bridge = app.state::<BridgeState>().inner().clone();
    // The old terminal is gone and the new one was launched with the freshly
    // installed advisor and the current token, so a refusal the stopped terminal
    // left behind is stale: wait for the restarted terminal instead. Only a
    // successful restart reaches this point, so a refused one keeps its status.
    expect_restarted_terminal(&tauri_events(&app), &bridge);
    spawn_startup_cleanup(bridge, files, replaced);
    Ok(RestartReport { restarted: true })
}

#[cfg(test)]
mod picker_tests {
    use std::collections::HashSet;

    use super::*;
    use crate::mt5_install::locate::HostPlatform;

    const WINDOWS_PROGRAM_FILES: &str = r"D:\Programs";
    const WINDOWS_DEFAULT_PROGRAM_FILES: &str = r"C:\Program Files";
    const MACOS_HOME: &str = "/Users/demo";
    const MACOS_PROGRAM_FILES: &str =
        "/Users/demo/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files";
    const LINUX_HOME: &str = "/home/demo";
    const LINUX_MT5_PROGRAM_FILES: &str = "/home/demo/.mt5/drive_c/Program Files";
    const LINUX_WINE_PROGRAM_FILES: &str = "/home/demo/.wine/drive_c/Program Files";

    /// A filesystem that holds exactly the given folders.
    struct FolderProbe(HashSet<PathBuf>);

    impl FolderProbe {
        fn holding(folders: &[&str]) -> Self {
            Self(folders.iter().map(PathBuf::from).collect())
        }
    }

    impl InstallProbe for FolderProbe {
        fn is_file(&self, _path: &Path) -> bool {
            false
        }

        fn is_dir(&self, path: &Path) -> bool {
            self.0.contains(path)
        }

        fn folder_names(&self, _folder: &Path) -> Vec<String> {
            Vec::new()
        }
    }

    /// An environment holding exactly `variables`.
    fn env_with(variables: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let variables: Vec<(String, String)> = variables
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect();
        move |name: &str| {
            variables
                .iter()
                .find(|(variable, _)| variable == name)
                .map(|(_, value)| value.clone())
        }
    }

    /// A Wine installation whose terminal sits in the default folder of `prefix`.
    fn wine_installation(prefix: &str) -> Mt5Installation {
        Mt5Installation {
            host: HostPlatform::Wine,
            wine_prefix: Some(PathBuf::from(prefix)),
            wine_binary: Some(PathBuf::from("/usr/local/bin/wine")),
            terminal_exe_windows: r"C:\Program Files\MetaTrader 5\terminal64.exe".to_string(),
            source: InstallationSource::Discovered,
        }
    }

    #[test]
    fn macos_starts_in_the_official_application_program_folder() {
        let env = env_with(&[("HOME", MACOS_HOME)]);
        let probe = FolderProbe::holding(&[MACOS_PROGRAM_FILES]);

        assert_eq!(
            default_program_folder(&env, HostOs::MacOs, &probe),
            Some(PathBuf::from(MACOS_PROGRAM_FILES))
        );
    }

    #[test]
    fn macos_without_the_application_starts_nowhere() {
        let env = env_with(&[("HOME", MACOS_HOME)]);

        assert_eq!(
            default_program_folder(&env, HostOs::MacOs, &FolderProbe::holding(&[])),
            None
        );
    }

    #[test]
    fn linux_starts_in_the_first_existing_prefix() {
        let env = env_with(&[("HOME", LINUX_HOME)]);
        let both = FolderProbe::holding(&[LINUX_MT5_PROGRAM_FILES, LINUX_WINE_PROGRAM_FILES]);

        assert_eq!(
            default_program_folder(&env, HostOs::Linux, &both),
            Some(PathBuf::from(LINUX_MT5_PROGRAM_FILES))
        );
        // The plain Wine prefix is the only one left when `~/.mt5` does not exist.
        assert_eq!(
            default_program_folder(
                &env,
                HostOs::Linux,
                &FolderProbe::holding(&[LINUX_WINE_PROGRAM_FILES])
            ),
            Some(PathBuf::from(LINUX_WINE_PROGRAM_FILES))
        );
    }

    #[test]
    fn linux_without_a_wine_prefix_starts_nowhere() {
        let env = env_with(&[("HOME", LINUX_HOME)]);

        assert_eq!(
            default_program_folder(&env, HostOs::Linux, &FolderProbe::holding(&[])),
            None
        );
    }

    #[test]
    fn windows_uses_the_program_files_variable() {
        let env = env_with(&[("ProgramFiles", WINDOWS_PROGRAM_FILES)]);

        assert_eq!(
            default_program_folder(&env, HostOs::Windows, &FolderProbe::holding(&[])),
            Some(PathBuf::from(WINDOWS_PROGRAM_FILES))
        );
    }

    #[test]
    fn windows_without_the_variable_uses_the_default_program_folder() {
        let env = env_with(&[]);

        assert_eq!(
            default_program_folder(&env, HostOs::Windows, &FolderProbe::holding(&[])),
            Some(PathBuf::from(WINDOWS_DEFAULT_PROGRAM_FILES))
        );
    }

    #[test]
    fn the_first_listed_installation_wins_over_the_default_folder() {
        let env = env_with(&[("HOME", MACOS_HOME)]);
        let probe = FolderProbe::holding(&[MACOS_PROGRAM_FILES]);
        let installation = wine_installation("/Volumes/Trading/prefix");
        let expected = Path::new("/Volumes/Trading/prefix")
            .join("drive_c")
            .join("Program Files")
            .join("MetaTrader 5");

        assert_eq!(
            picker_start_folder(&env, HostOs::MacOs, &probe, Some(&installation)),
            Some(expected.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn with_no_installation_and_no_default_folder_the_picker_starts_nowhere() {
        assert_eq!(
            picker_start_folder(
                &env_with(&[]),
                HostOs::MacOs,
                &FolderProbe::holding(&[]),
                None
            ),
            None
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_native_install_folder_of_the_listed_terminal_is_the_start_folder() {
        let installation = Mt5Installation {
            host: HostPlatform::Windows,
            wine_prefix: None,
            wine_binary: None,
            terminal_exe_windows: r"C:\MT5\terminal64.exe".to_string(),
            source: InstallationSource::Chosen,
        };

        assert_eq!(
            picker_start_folder(
                &env_with(&[]),
                HostOs::Windows,
                &FolderProbe::holding(&[]),
                Some(&installation)
            ),
            Some(r"C:\MT5".to_string())
        );
    }
}
