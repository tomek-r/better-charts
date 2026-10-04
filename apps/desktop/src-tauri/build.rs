fn main() {
    // `tauri.conf.json` reads the app version from `package.json`, but cargo does
    // not track that file on its own: without this, a version bump would leave a
    // stale version embedded in the binary until something else forced a rebuild.
    println!("cargo:rerun-if-changed=../../package.json");
    tauri_build::build();
}
