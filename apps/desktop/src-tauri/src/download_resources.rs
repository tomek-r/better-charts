//! Download the bundled MQL5 source files to a folder the user picks (setup guide).
//!
//! The dialog plugin (`tauri-plugin-dialog`) only returns a chosen path, so this
//! command performs the actual write: it copies one of the two bundled `.mq5`
//! resources to the destination. Only allow-listed resources are copied, so the
//! command can never be pointed at an arbitrary path.

use std::fs;
use std::path::Path;
use tauri::{path::BaseDirectory, AppHandle, Manager};

/// The only resources the setup guide can save.
const SAVED_RESOURCES: &[&str] = &[
    "mql5/Experts/BetterChartsBridge.mq5",
    "mql5/Indicators/BetterChartsTickHistoryReader.mq5",
];

/// Copy a bundled resource to `destination`. Fails closed unless `resource` is
/// in `SAVED_RESOURCES`.
#[tauri::command]
pub fn save_bundled_resource(
    app: AppHandle,
    resource: String,
    destination: String,
) -> Result<(), String> {
    let source = app
        .path()
        .resolve(&resource, BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    copy_saved_resource(&resource, &source, &destination)
}

fn copy_saved_resource(resource: &str, source: &Path, destination: &str) -> Result<(), String> {
    if !SAVED_RESOURCES.contains(&resource) {
        return Err(format!("unknown resource: {resource}"));
    }
    fs::copy(source, destination).map_err(|error| format!("failed to save {resource}: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("better-charts-setup-guide-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_resources_outside_the_allowlist() {
        for resource in ["mql5/../secrets.mq5", "evil.mq5", "/etc/passwd"] {
            let result = copy_saved_resource(resource, Path::new("/nowhere"), "/tmp/out");
            assert!(result.is_err(), "{resource} should be rejected");
        }
    }

    #[test]
    fn copies_an_allowlisted_resource_to_the_destination() {
        let dir = temp_dir();
        let source = dir.join("BetterChartsBridge.mq5");
        fs::write(&source, "// expert advisor\n").unwrap();
        let destination = dir.join("out").join("BetterChartsBridge.mq5");
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        assert!(copy_saved_resource(
            "mql5/Experts/BetterChartsBridge.mq5",
            &source,
            destination.to_str().unwrap()
        )
        .is_ok());
        assert_eq!(
            fs::read_to_string(&destination).unwrap(),
            "// expert advisor\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
