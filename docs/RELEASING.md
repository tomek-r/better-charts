# Release checklist

## Source publication

- Review tracked files and Git history for credentials, account data, captures,
  logs, journals and local installation paths. `.gitignore` cannot remove
  previously committed data; rotate any exposed credentials.
- Keep the project license and bundled third-party notices. Planned Pine
  support has not changed the current MIT license.
- Run the [validation commands](../README.md#development).

## Desktop packages

Build on each target operating system:

```bash
pnpm install --frozen-lockfile
pnpm tauri build
```

Packages are under `target/release/bundle/`. Verify that they contain the
project license, Lightweight Charts license/NOTICE, and both MQL5 source files,
with no private settings or credentials.

The `Validate` CI workflow checks Rust, frontend tooling, Python diagnostics
and native compilation on macOS, Windows and Linux. Browser E2E runs on Linux.
Build success does not establish MT5 runtime support.

Before distributing installers, verify on each supported OS:

1. Install and launch from a clean user account without a checkout.
2. Confirm the unconfigured app starts no MT5 process.
3. Configure a token and manually connect MT5: check history, quotes, search,
   portfolio and volume profiles.
4. Check explicitly configured auto-start and already-running terminal detection.
5. On a demo account, check OrderCheck, submission, modify, close/cancel,
   reconnect without retries and journal recovery.
6. Verify writable user-data paths and journal locking. Compile both MQL5
   sources in MetaEditor with 0 errors and 0 warnings.

Native Windows/Linux runtime, current chart changes and packaged runtime
verification remain pending. Real-account testing has not been validated.

## Versioned releases

Update `apps/desktop/package.json` and the matching version in
`apps/desktop/src-tauri/Cargo.toml`; Tauri and the UI read the package version.
Update `Cargo.lock` through Cargo and run the version guard with workspace tests.

After merging the version update and checking CI, push the matching tag:

```bash
git tag -a v0.0.1 -m "Release v0.0.1"
git push origin v0.0.1
```

Use the updated version for subsequent releases. The `Release` workflow rejects
tags that differ from the package and Cargo versions, runs the existing validation
workflow, and builds Windows x64 NSIS/MSI, a universal macOS DMG for Intel and
Apple Silicon, and Linux x64 AppImage/DEB packages. After all jobs pass, it creates
a draft prerelease with the installers and `SHA256SUMS.txt`.

No signing secrets are required. Windows/Linux packages are unsigned; macOS uses
certificate-free ad-hoc signing for Apple Silicon compatibility and is not
notarized. These builds have no verified publisher identity and may show OS
security prompts. See [Tauri's macOS guidance](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing).

Review the draft, complete the package checks above, then publish it from GitHub
Releases. A rerun can replace assets on an existing draft; published releases are
never overwritten by the workflow. Do not move a released tag to another commit.
