//! Test doubles the MT5 install tests share: a fixed filesystem and an environment
//! lookup, so every operating-system branch runs on any host without touching this
//! machine's disk or process environment.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use super::discover::InstallProbe;

fn owned_paths<P: AsRef<Path>>(paths: impl IntoIterator<Item = P>) -> BTreeSet<PathBuf> {
    paths
        .into_iter()
        .map(|path| path.as_ref().to_path_buf())
        .collect()
}

/// A filesystem that holds exactly the files and folders it was built with, and
/// lists exactly the folder names it was told about, so the Windows, macOS, and
/// Linux branches are tested on any host.
#[derive(Default)]
pub(super) struct FakeProbe {
    files: BTreeSet<PathBuf>,
    folders: BTreeSet<PathBuf>,
    listings: BTreeMap<PathBuf, Vec<String>>,
}

impl FakeProbe {
    /// Probe where exactly `files` exist as regular files.
    pub(super) fn with_files<P: AsRef<Path>>(files: impl IntoIterator<Item = P>) -> Self {
        Self {
            files: owned_paths(files),
            ..Self::default()
        }
    }

    /// Probe where exactly `folders` exist as folders.
    pub(super) fn with_folders<P: AsRef<Path>>(folders: impl IntoIterator<Item = P>) -> Self {
        Self {
            folders: owned_paths(folders),
            ..Self::default()
        }
    }

    /// Adds `folder`, listing `names` in the name order the real probe produces.
    pub(super) fn listing(mut self, folder: &str, names: &[&str]) -> Self {
        let names = names.iter().map(|name| (*name).to_string()).collect();
        self.listings.insert(PathBuf::from(folder), names);
        self
    }
}

impl InstallProbe for FakeProbe {
    fn is_file(&self, path: &Path) -> bool {
        self.files.contains(path)
    }

    fn is_dir(&self, path: &Path) -> bool {
        self.folders.contains(path)
    }

    fn folder_names(&self, folder: &Path) -> Vec<String> {
        self.listings.get(folder).cloned().unwrap_or_default()
    }
}

/// Environment lookup over `variables`; every other variable reads as unset.
pub(super) fn env_map(variables: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
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
