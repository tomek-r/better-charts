//! The Tauri commands the setup guide calls: list the MT5 installations this machine
//! has, install the bundled MQL5 files into one of their data folders and compile
//! them, and restart MT5 with the bridge advisor attached.
//!
//! Every command starts from the same fresh scan through `discover` and `locate`, so
//! the terminal and `MQL5` paths the guide just showed are the only paths a command
//! accepts: a path from a stale list, from another machine, or from a different
//! installation is refused before anything is written. The install, the compile, and
//! the restart run on a blocking thread, because MetaEditor takes seconds and closing
//! a terminal means waiting for it.
//!
//! Security: the install command never starts the MT5 terminal, and none of them ever
//! touches AutoTrading. The writes are the two `.mq5` files, MetaEditor's own `.ex5`
//! and `.log` output beside them, and — after a successful install — the settings
//! paths the user has not set yet. The restart adds the two startup files `restart`
//! documents, which it deletes again as soon as the terminal has read them.

use std::env;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use super::compile::{compile_installed, CompileResult, ProcessRunner};
use super::discover::{discover_this_machine, InstallationSource, Mt5Installation};
use super::install::{install_bundled_sources, BundledSources, InstallOutcome, InstalledFile};
use super::locate::{locate_data_folders, DataFolder, Layout, Mql5File};
use super::restart::{
    new_session_live, poll_count, remove_startup_files, remove_startup_files_in,
    restart_with_expert, RestartPolicy, RestartRequest, StartupFiles, SystemTerminal,
};
use crate::app_settings::AppSettingsState;
use crate::bridge::state::{BridgeConnectionState, BridgeState, DEFAULT_ADDR};
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
/// The scan is repeated per command on purpose: a terminal installed since the window
/// opened is then offered, and an installation that has disappeared is refused
/// instead of written into.
fn installations_on_this_machine() -> Vec<LocatedInstallation> {
    discover_this_machine()
        .into_iter()
        .map(|installation| {
            let data_folders = locate_data_folders(&installation);
            LocatedInstallation {
                installation,
                data_folders,
            }
        })
        .collect()
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
/// setup guide can offer the choice of where to install.
#[tauri::command]
pub(crate) fn list_mt5_installations() -> Vec<Mt5InstallationView> {
    installation_views(&installations_on_this_machine())
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
    let target = matched_target(&installations_on_this_machine(), &terminal_path, &mql5_path)?;
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
    for located in installations_on_this_machine() {
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
#[tauri::command]
pub(crate) async fn restart_mt5_with_ea(
    app: AppHandle,
    terminal_path: String,
    mql5_path: String,
) -> Result<RestartReport, String> {
    let target = matched_target(&installations_on_this_machine(), &terminal_path, &mql5_path)?;
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
    spawn_startup_cleanup(app.state::<BridgeState>().inner().clone(), files, replaced);
    Ok(RestartReport { restarted: true })
}
