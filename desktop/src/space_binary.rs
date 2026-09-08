//! Run first-party tools shipped inside an installed space.
//!
//! Spaces ship optional native tool CLIs under
//! `tools/<os>-<arch>/<name>` in their `.space` bundle. Optional third-party
//! helpers live under `lib/<os>-<arch>/`. This module resolves the
//! platform-specific tool, sandboxes the resolved path to the space's own
//! installed directory, prepends the selected `lib/` + `tools/` dirs to PATH,
//! and runs it on behalf of space code via a Tauri command.
//!
//! Why this exists instead of Tauri's built-in `Command.sidecar`:
//!   - Sidecars are bundled with the app at build time. Spaces are dynamic
//!     plugins installed post-install, so they can't register sidecars.
//!   - The shell plugin's allowlist is per-command-name. Letting any space
//!     allowlist any tool by name would defeat sandboxing.
//!
//! Security model:
//!   - Caller passes (space_id, tool_name). Caller never controls the
//!     absolute path.
//!   - Resolved path =
//!     <profileDir>/spaces/<space_id>.space/tools/<os>-<arch>/<name>
//!   - Path is canonicalized, then verified to still be inside the space dir
//!     (defends against `..` traversal in space-supplied components even
//!     though we never accept components from the caller today).
//!   - Hardlink guard (Unix): refuse to exec if `nlink > 1`. Hardlinks are
//!     legitimate in almost no scenario for a published space tool, and
//!     refusing them closes the "hardlink the space's own bin path to
//!     /bin/sh during a malicious install step" trick — `canonicalize()`
//!     would still report the local path, but the inode is shared.
//!   - Binary must be a regular file. On Unix, exec bit is set if missing
//!     (tar extraction can drop it depending on extractor).
//!   - Environment is scrubbed before exec — only PATH (system dirs),
//!     HOME (set to the space dir), LANG/LC_ALL (UTF-8), and TMPDIR are
//!     forwarded. Binaries don't see Construct's own env (auth tokens,
//!     XPC sockets, app data paths). This is path control, not a syscall
//!     sandbox — a malicious tool can still read user files. Treat any
//!     tool you allow into a space as fully trusted.
//!   - Hard caps on output size and wall-clock runtime: 10 MiB combined
//!     stdout+stderr (each), 30 s default / 5 min max. A runaway tool
//!     gets SIGKILL'd; further output is silently discarded.
//!
//! TODO: real syscall sandbox (sandbox-exec on macOS, bwrap+seccomp on
//! Linux, AppContainer on Windows) + first-run user consent + manifest
//! capability declarations. Plan: `docs/plans/2026-05-04-space-binary-sandbox.md`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Hard ceiling per stream (stdout, stderr) in bytes. Anything beyond is
/// dropped on the floor — the renderer gets the prefix plus a marker. The
/// child keeps running until it exits or hits the timeout; we don't kill on
/// overflow alone because some long-running tools legitimately produce a lot.
const MAX_OUTPUT_BYTES: usize = 10 * 1024 * 1024;

/// Default timeout when the caller doesn't override. Most tools should
/// finish in seconds; this stops a hung child from holding a renderer
/// promise open forever.
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// Hard cap. Caller can request less but never more — even legitimate long
/// jobs should stream progress over stdout, not block on a single command.
const MAX_TIMEOUT_MS: u64 = 300_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceToolOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    /// True when the run exceeded `timeout_ms` and was killed. `code` will
    /// be -1 in this case.
    pub timed_out: bool,
    /// True when stdout was truncated at MAX_OUTPUT_BYTES.
    pub stdout_truncated: bool,
    /// True when stderr was truncated at MAX_OUTPUT_BYTES.
    pub stderr_truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceToolOpts {
    /// Optional stdin payload. UTF-8 only — raw binary stdin is not supported here.
    #[serde(default)]
    pub stdin: Option<String>,
    /// Optional working directory, must be inside the space dir if set.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Wall-clock cap on the child process, in milliseconds. Defaults to
    /// `DEFAULT_TIMEOUT_MS`; clamped to `MAX_TIMEOUT_MS`.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn os_arch_dir() -> &'static str {
    // Matches the directory layout produced by the space build
    // (`tools/<os>-<arch>` and `lib/<os>-<arch>`).
    // Keep this list in sync with the Go cross-compile matrix in spaces.
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("linux", "x86_64") => "linux-x64",
        ("windows", "x86_64") => "windows-x64",
        ("windows", "aarch64") => "windows-arm64",
        // Unknown — caller will get a clear error at resolve time.
        _ => "unknown",
    }
}

fn binary_extension() -> &'static str {
    if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    }
}

/// Returns the directory holding a space's native tool trees (`tools/`, `lib/`).
/// Installed `.space` ZIPs have only those trees materialized to a small cache
/// (the renderer reads the rest from the ZIP in memory); dev-linked unpacked
/// spaces pass through unchanged.
fn expected_space_dir(space_id: &str) -> Result<PathBuf, String> {
    let space_dir = crate::space_bundle::materialize_tool_dirs(space_id)?;
    if !space_dir.is_dir() {
        return Err(format!(
            "space '{}' did not resolve to a directory at {}",
            space_id,
            space_dir.display()
        ));
    }
    Ok(space_dir)
}

/// Returns the on-disk path the tool *should* live at.
fn expected_tool_path(space_id: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() {
        return Err("tool name required".into());
    }
    // Reject anything that could escape the tools dir before we touch the FS.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid tool name: {}", name));
    }

    let space_dir = expected_space_dir(space_id)?;
    let filename = format!("{}{}", name, binary_extension());
    Ok(space_dir.join("tools").join(os_arch_dir()).join(filename))
}

/// Canonicalize `path` and verify it's still inside `inside`. Both must exist.
fn ensure_path_inside(path: &Path, inside: &Path) -> Result<PathBuf, String> {
    let real_path = path
        .canonicalize()
        .map_err(|e| format!("canonicalize failed: {}: {}", path.display(), e))?;
    let real_inside = inside
        .canonicalize()
        .map_err(|e| format!("canonicalize failed: {}: {}", inside.display(), e))?;
    if !real_path.starts_with(&real_inside) {
        return Err(format!(
            "path {} escapes space dir {}",
            real_path.display(),
            real_inside.display()
        ));
    }
    Ok(real_path)
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let meta =
        std::fs::metadata(path).map_err(|e| format!("stat failed: {}: {}", path.display(), e))?;
    let mut perms = meta.permissions();
    let mode = perms.mode();
    // If any execute bit is set, leave it alone. Otherwise add user+group+other
    // exec to match what `chmod +x` would do.
    if mode & 0o111 == 0 {
        perms.set_mode(mode | 0o111);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("chmod +x failed: {}: {}", path.display(), e))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Refuse to exec a hardlinked tool on Unix. A nlink > 1 means the inode
/// has another path somewhere on the filesystem — this is *never* what a
/// freshly-extracted space tarball produces, so its presence implies either
/// repository corruption or an attempted ToC-ToU attack between extraction
/// and exec. Cheap belt-and-suspenders on top of the canonicalize/starts_with
/// check; that one already catches symlinks but not hardlinks.
#[cfg(unix)]
fn ensure_no_hardlink(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let meta =
        std::fs::metadata(path).map_err(|e| format!("stat failed: {}: {}", path.display(), e))?;
    if meta.nlink() > 1 {
        return Err(format!(
            "tool {} has nlink={} (hardlinked); refusing to execute",
            path.display(),
            meta.nlink()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_no_hardlink(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Build the env the child should see: only stable, non-secret variables.
/// Anything not on this list — auth tokens, app data paths, XPC sockets,
/// VS Code integration vars, etc. — is dropped before exec. The space dir
/// is set as `HOME` so tools that look there for config/cache write
/// inside their own sandboxed dir instead of the user's real home.
fn build_child_env(space_id: &str, space_dir: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::with_capacity(14);
    let tool_dir = space_dir.join("tools").join(os_arch_dir());
    let lib_dir = space_dir.join("lib").join(os_arch_dir());
    let lib_root = space_dir.join("lib");

    // PATH: put the space-selected lib + tools dirs first so a tool can call
    // `exec.Command("ffmpeg", ...)` and resolve its bundled helper. Then
    // append the host PATH for system tools like `git`. We considered
    // hard-coding /usr/bin:/bin but that breaks Homebrew + nix users.
    let mut path_parts = vec![lib_dir.clone(), tool_dir.clone()];
    if let Some(existing) = std::env::var_os("PATH") {
        path_parts.extend(std::env::split_paths(&existing));
    }
    if let Ok(path) = std::env::join_paths(path_parts) {
        env.push(("PATH".into(), path.to_string_lossy().into_owned()));
    }

    env.push(("HOME".into(), space_dir.to_string_lossy().into_owned()));
    env.push(("SPACE_DIR".into(), space_dir.to_string_lossy().into_owned()));
    env.push((
        "SPACE_TOOLS".into(),
        tool_dir.to_string_lossy().into_owned(),
    ));
    env.push(("SPACE_LIB".into(), lib_dir.to_string_lossy().into_owned()));
    env.push((
        "SPACE_LIB_ROOT".into(),
        lib_root.to_string_lossy().into_owned(),
    ));
    env.push(("CONSTRUCT_SPACE_ID".into(), space_id.to_string()));
    env.push(("CONSTRUCT_PLATFORM".into(), os_arch_dir().to_string()));

    // Locale — many CLI tools key behaviour on these (e.g. `sort` ordering,
    // ffmpeg progress parsing). UTF-8 is the only sane default.
    env.push(("LANG".into(), "en_US.UTF-8".into()));
    env.push(("LC_ALL".into(), "en_US.UTF-8".into()));

    if let Ok(tmp) = std::env::var("TMPDIR") {
        env.push(("TMPDIR".into(), tmp));
    }

    // Windows: SystemRoot is required for nearly every Windows executable to
    // start (DLL search paths, etc.). USERPROFILE/APPDATA intentionally
    // omitted — HOME above is the sandboxed equivalent.
    #[cfg(windows)]
    {
        if let Ok(v) = std::env::var("SystemRoot") {
            env.push(("SystemRoot".into(), v));
        }
        if let Ok(v) = std::env::var("ComSpec") {
            env.push(("ComSpec".into(), v));
        }
    }

    env
}

/// Read up to `cap` bytes from `r`, then drain the rest into the void so the
/// child's pipe doesn't block on full buffer. Returns (collected, truncated).
async fn read_capped<R: tokio::io::AsyncRead + Unpin>(mut r: R, cap: usize) -> (Vec<u8>, bool) {
    use tokio::io::AsyncReadExt;
    let mut out = Vec::with_capacity(cap.min(64 * 1024));
    let mut buf = vec![0u8; 16 * 1024];
    let mut truncated = false;
    loop {
        match r.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if !truncated {
                    let remaining = cap.saturating_sub(out.len());
                    if remaining >= n {
                        out.extend_from_slice(&buf[..n]);
                    } else {
                        out.extend_from_slice(&buf[..remaining]);
                        truncated = true;
                    }
                }
                // If truncated, keep reading + discarding so the pipe stays
                // drained and the child can keep running until exit/timeout.
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

/// Run a space-shipped tool and return its captured output.
///
/// Errors (each surfaced verbatim to the renderer):
///   - "no active profile" — user not logged in
///   - "space '<id>' is not installed at <path>"
///   - "tool not found for this platform: <expected path>"
///   - "path X escapes space dir Y" — should be impossible from valid inputs
///   - "tool ... has nlink=N (hardlinked); refusing to execute"
///   - "spawn failed: <io error>"
///
/// Non-error timeouts and oversized output are reflected on the returned
/// `SpaceToolOutput` (`timedOut`, `stdoutTruncated`, `stderrTruncated`)
/// rather than thrown — the renderer often wants the partial output even
/// when a run was killed.
#[tauri::command]
pub async fn space_tool_invoke(
    space_id: String,
    name: String,
    args: Vec<String>,
    opts: Option<SpaceToolOpts>,
) -> Result<SpaceToolOutput, String> {
    let expected = expected_tool_path(&space_id, &name)?;
    if !expected.is_file() {
        return Err(format!(
            "tool not found for this platform: {}",
            expected.display()
        ));
    }

    let space_dir = expected_space_dir(&space_id)?;
    let real_tool = ensure_path_inside(&expected, &space_dir)?;

    ensure_executable(&real_tool)?;
    ensure_no_hardlink(&real_tool)?;

    let opts = opts.unwrap_or(SpaceToolOpts {
        stdin: None,
        cwd: None,
        timeout_ms: None,
    });
    let timeout_ms = opts
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .min(MAX_TIMEOUT_MS);

    let mut cmd = Command::new(&real_tool);
    cmd.args(&args);

    if let Some(cwd) = &opts.cwd {
        let cwd_path = PathBuf::from(cwd);
        let real_cwd = ensure_path_inside(&cwd_path, &space_dir)
            .map_err(|e| format!("cwd rejected: {}", e))?;
        cmd.current_dir(real_cwd);
    } else {
        // Default cwd to the space dir so binaries can reference their own
        // bundled resources via relative paths.
        cmd.current_dir(&space_dir);
    }

    // Scrub the env: clear everything inherited from Construct, then set
    // only the safe-list. See build_child_env for the rationale.
    cmd.env_clear();
    for (k, v) in build_child_env(&space_id, &space_dir) {
        cmd.env(k, v);
    }

    if opts.stdin.is_some() {
        cmd.stdin(std::process::Stdio::piped());
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // kill_on_drop: if this future is cancelled (renderer drops the promise,
    // app shutting down) we don't leave an orphan child running.
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut stdin = child.stdin.take();

    // Drive stdout/stderr readers concurrently — neither must block waiting
    // for the other or we deadlock when the child fills both pipes.
    let stdout_task = tokio::spawn(async move {
        match stdout {
            Some(s) => read_capped(s, MAX_OUTPUT_BYTES).await,
            None => (Vec::new(), false),
        }
    });
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(s) => read_capped(s, MAX_OUTPUT_BYTES).await,
            None => (Vec::new(), false),
        }
    });

    if let (Some(payload), Some(stdin_handle)) = (opts.stdin.as_ref(), stdin.as_mut()) {
        let _ = stdin_handle.write_all(payload.as_bytes()).await;
    }
    drop(stdin); // close child's stdin so readers don't wait on a write end

    let timed_out;
    let exit_code: i32;
    match timeout(Duration::from_millis(timeout_ms), child.wait()).await {
        Ok(Ok(status)) => {
            timed_out = false;
            exit_code = status.code().unwrap_or(-1);
        }
        Ok(Err(e)) => return Err(format!("wait failed: {}", e)),
        Err(_) => {
            // Timeout. Send SIGKILL (or TerminateProcess on Windows). Then
            // reap so we don't zombie the child.
            let _ = child.kill().await;
            let _ = child.wait().await;
            timed_out = true;
            exit_code = -1;
        }
    }

    let (stdout_bytes, stdout_truncated) = stdout_task.await.unwrap_or((Vec::new(), false));
    let (stderr_bytes, stderr_truncated) = stderr_task.await.unwrap_or((Vec::new(), false));

    Ok(SpaceToolOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        code: exit_code,
        timed_out,
        stdout_truncated,
        stderr_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    // expected_tool_path's traversal guards run before any FS access so
    // we can hit them without a real profile dir.
    #[test]
    fn expected_tool_path_rejects_dotdot_in_name() {
        let err = expected_tool_path("space-x", "../bash").unwrap_err();
        assert!(err.contains("invalid tool name"), "got: {err}");
    }

    #[test]
    fn expected_tool_path_rejects_slash_in_name() {
        let err = expected_tool_path("space-x", "subdir/bin").unwrap_err();
        assert!(err.contains("invalid tool name"), "got: {err}");
    }

    #[test]
    fn expected_tool_path_rejects_dotdot_in_space_id() {
        let err = expected_tool_path("../etc", "ok").unwrap_err();
        assert!(err.contains("invalid space_id"), "got: {err}");
    }

    #[test]
    fn expected_tool_path_rejects_empty_inputs() {
        assert!(expected_tool_path("", "x").is_err());
        assert!(expected_tool_path("x", "").is_err());
    }

    // build_child_env must not leak Construct-specific or secret-bearing
    // env vars. We assert the keyset is exactly what build_child_env
    // promises (modulo platform-specific entries).
    #[test]
    fn build_child_env_only_contains_safelist() {
        let dir = std::env::temp_dir();
        let env = build_child_env("space-x", &dir);
        let keys: std::collections::HashSet<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        // PATH may not be present in test runners that scrub env, so we only
        // assert the affirmative-required items below; PATH is conditional.
        assert!(keys.contains("HOME"), "HOME missing");
        assert!(keys.contains("SPACE_DIR"), "SPACE_DIR missing");
        assert!(keys.contains("SPACE_TOOLS"), "SPACE_TOOLS missing");
        assert!(keys.contains("SPACE_LIB"), "SPACE_LIB missing");
        assert!(
            keys.contains("CONSTRUCT_PLATFORM"),
            "CONSTRUCT_PLATFORM missing"
        );
        assert!(keys.contains("LANG"), "LANG missing");
        assert!(keys.contains("LC_ALL"), "LC_ALL missing");

        let allowed = [
            "PATH",
            "HOME",
            "SPACE_DIR",
            "SPACE_TOOLS",
            "SPACE_LIB",
            "SPACE_LIB_ROOT",
            "CONSTRUCT_SPACE_ID",
            "CONSTRUCT_PLATFORM",
            "LANG",
            "LC_ALL",
            "TMPDIR",
            "SystemRoot",
            "ComSpec",
        ];
        for (k, _) in &env {
            assert!(
                allowed.contains(&k.as_str()),
                "env var {k} leaked into space child"
            );
        }
    }

    #[test]
    fn build_child_env_sets_home_to_space_dir() {
        let dir = std::env::temp_dir().join("space-tool-test-home");
        let env = build_child_env("space-x", &dir);
        let home = env
            .iter()
            .find(|(k, _)| k == "HOME")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert_eq!(home, dir.to_string_lossy());
    }

    #[test]
    fn build_child_env_selects_platform_tool_and_lib_dirs() {
        let dir = std::env::temp_dir().join("mail.space");
        let env = build_child_env("mail", &dir);
        let get = |key: &str| {
            env.iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone())
                .unwrap()
        };
        assert_eq!(get("SPACE_DIR"), dir.to_string_lossy());
        assert_eq!(
            get("SPACE_TOOLS"),
            dir.join("tools").join(os_arch_dir()).to_string_lossy()
        );
        assert_eq!(
            get("SPACE_LIB"),
            dir.join("lib").join(os_arch_dir()).to_string_lossy()
        );
        assert_eq!(get("CONSTRUCT_SPACE_ID"), "mail");
        assert_eq!(get("CONSTRUCT_PLATFORM"), os_arch_dir());
    }

    // read_capped truncates at cap and continues draining.
    #[tokio::test]
    async fn read_capped_truncates_at_cap() {
        let (mut writer, reader) = tokio::io::duplex(64);
        let cap = 10usize;
        let task = tokio::spawn(read_capped(reader, cap));
        // Write more than cap, then close.
        writer.write_all(b"abcdefghijklmnopqrst").await.unwrap();
        drop(writer);
        let (out, truncated) = task.await.unwrap();
        assert!(truncated, "expected truncated=true");
        assert_eq!(out, b"abcdefghij", "expected first cap bytes only");
    }

    #[tokio::test]
    async fn read_capped_returns_full_when_under_cap() {
        let (mut writer, reader) = tokio::io::duplex(64);
        let cap = 100usize;
        let task = tokio::spawn(read_capped(reader, cap));
        writer.write_all(b"hello").await.unwrap();
        drop(writer);
        let (out, truncated) = task.await.unwrap();
        assert!(!truncated, "expected truncated=false");
        assert_eq!(out, b"hello");
    }
}

/// Cheap pre-flight: does this space ship a tool by this name for the
/// current OS+arch? Returns the resolved path on success so the renderer can
/// surface "found at: ..." in Settings.
#[tauri::command]
pub fn space_tool_resolve(space_id: String, name: String) -> Result<String, String> {
    let expected = expected_tool_path(&space_id, &name)?;
    if !expected.is_file() {
        return Err(format!(
            "tool not found for this platform: {}",
            expected.display()
        ));
    }
    Ok(expected.to_string_lossy().into_owned())
}
