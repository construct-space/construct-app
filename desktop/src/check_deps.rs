//! Dependency check + install for onboarding (bun, construct CLI).

use crate::config::get_user_shell_path;

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct DepStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct DepsReport {
    pub bun: DepStatus,
    pub construct: DepStatus,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Resolve a command path via `which`, falling back to known install locations.
/// Returns absolute path if found, since PATH in this process may not include
/// freshly-installed locations (e.g. ~/.bun/bin right after `bun install`).
fn resolve(cmd: &str) -> Option<String> {
    // 1. which
    if let Ok(out) = Command::new("which")
        .arg(cmd)
        .env("PATH", get_user_shell_path())
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }

    // 2. known install paths
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = home() {
        candidates.push(h.join(".bun/bin").join(cmd));
        candidates.push(h.join(".local/bin").join(cmd));
        candidates.push(h.join(".npm-global/bin").join(cmd));
    }
    candidates.push(PathBuf::from("/usr/local/bin").join(cmd));
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(cmd));

    for p in candidates {
        if p.is_file() {
            return p.to_str().map(String::from);
        }
    }
    None
}

fn version_of(path: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(path)
        .args(args)
        .env("PATH", get_user_shell_path())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn status_for(cmd: &str) -> DepStatus {
    match resolve(cmd) {
        Some(path) => DepStatus {
            installed: true,
            version: version_of(&path, &["--version"]),
            path: Some(path),
        },
        None => DepStatus {
            installed: false,
            version: None,
            path: None,
        },
    }
}

#[tauri::command]
pub fn check_deps() -> DepsReport {
    DepsReport {
        bun: status_for("bun"),
        construct: status_for("construct"),
    }
}

#[tauri::command]
pub async fn install_bun() -> Result<String, String> {
    let output = Command::new("bash")
        .arg("-lc")
        .arg("curl -fsSL https://bun.sh/install | bash")
        .env("PATH", get_user_shell_path())
        .output()
        .map_err(|e| format!("spawn failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn install_construct() -> Result<String, String> {
    let bun_path = resolve("bun").ok_or("bun required before installing construct")?;
    let output = Command::new(&bun_path)
        .args(["install", "-g", "@construct-space/cli"])
        .env("PATH", get_user_shell_path())
        .output()
        .map_err(|e| format!("spawn failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
