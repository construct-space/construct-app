//! Shared configuration: constants, statics, data directory, utility functions.

use std::collections::HashMap;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// Message ID counters
pub static MESSAGE_ID: AtomicU64 = AtomicU64::new(0);
pub static LSP_MESSAGE_ID: AtomicU64 = AtomicU64::new(1);
pub static SHUTDOWN_CLEANUP_RAN: AtomicBool = AtomicBool::new(false);

pub const OPERATOR_HOST: &str = "127.0.0.1";
pub const OPERATOR_PORT_DEFAULT: u16 = 60100;
pub const OPERATOR_PORT_DEV: u16 = 60200;
#[allow(dead_code)]
pub const DESKTOP_BRIDGE_PORT_DEFAULT: u16 = 60101;
#[allow(dead_code)]
pub const DESKTOP_BRIDGE_PORT_DEV: u16 = 60201;

/// Serializes operator spawn attempts. No polling — callers await the lock.
pub static SPAWN_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Global bridge token — set once at startup, read by operator spawn.
pub static BRIDGE_TOKEN: std::sync::LazyLock<String> =
    std::sync::LazyLock::new(generate_bridge_token);

/// Pending bridge responses — keyed by request ID, frontend sends responses back here.
pub static BRIDGE_PENDING: std::sync::LazyLock<
    Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
> = std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

pub static LAST_CONSTRUCT_DEV_PID: std::sync::LazyLock<Mutex<Option<u32>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

pub fn is_dev_instance() -> bool {
    option_env!("VITE_CONSTRUCT_DEV_MODE") == Some("true")
        || std::env::var("CONSTRUCT_DEV_MODE").as_deref() == Ok("true")
        || std::env::args().any(|a| a == "--dev")
}

/// Data directory for Construct — uses productName, NOT Tauri identifier.
/// Mirrors Go operator's appdir.go logic:
///   macOS:   ~/Library/Application Support/Construct/
///   Windows: %APPDATA%\Construct\
///   Linux:   $XDG_DATA_HOME/construct/ (or ~/.local/share/construct/)
pub fn construct_data_dir() -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = std::env::var("CONSTRUCT_DATA_DIR") {
        if !dir.is_empty() {
            let p = std::path::PathBuf::from(&dir);
            std::fs::create_dir_all(&p)
                .map_err(|e| format!("Failed to create data dir: {}", e))?;
            return Ok(p);
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot resolve home directory")?;

    let dir = if cfg!(target_os = "macos") {
        let name = if is_dev_instance() {
            "Construct Dev"
        } else {
            "Construct"
        };
        let new_dir = std::path::PathBuf::from(&home)
            .join("Library")
            .join("Application Support")
            .join(name);

        // One-time migration from old identifier-based dir
        let old_name = if is_dev_instance() {
            "space.construct.personal.dev"
        } else {
            "space.construct.personal"
        };
        let old_dir = std::path::PathBuf::from(&home)
            .join("Library")
            .join("Application Support")
            .join(old_name);
        if old_dir.exists() && !new_dir.exists() {
            eprintln!(
                "[construct] Migrating data: {} → {}",
                old_dir.display(),
                new_dir.display()
            );
            let _ = std::fs::rename(&old_dir, &new_dir);
        }

        new_dir
    } else if cfg!(target_os = "windows") {
        let app_data =
            std::env::var("APPDATA").unwrap_or_else(|_| format!("{}/AppData/Roaming", home));
        let name = if is_dev_instance() {
            "Construct Dev"
        } else {
            "Construct"
        };
        std::path::PathBuf::from(app_data).join(name)
    } else {
        let data_home =
            std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{}/.local/share", home));
        let name = if is_dev_instance() {
            "construct-dev"
        } else {
            "construct"
        };
        std::path::PathBuf::from(data_home).join(name)
    };

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    Ok(dir)
}

pub fn app_display_name() -> &'static str {
    if is_dev_instance() {
        "Construct DEV"
    } else {
        "Construct"
    }
}

#[tauri::command]
pub fn get_construct_data_dir() -> Result<String, String> {
    construct_data_dir().map(|p| p.to_string_lossy().to_string())
}

pub fn operator_port() -> u16 {
    if is_dev_instance() {
        OPERATOR_PORT_DEV
    } else {
        OPERATOR_PORT_DEFAULT
    }
}

pub fn bridge_port() -> u16 {
    if is_dev_instance() {
        DESKTOP_BRIDGE_PORT_DEV
    } else {
        DESKTOP_BRIDGE_PORT_DEFAULT
    }
}

pub fn operator_address() -> String {
    format!("{}:{}", OPERATOR_HOST, operator_port())
}

pub fn bridge_address() -> String {
    format!("{}:{}", OPERATOR_HOST, bridge_port())
}

fn generate_bridge_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("getrandom failed");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn new_client_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("construct-{}-{}", std::process::id(), ts)
}

/// Resolve the user's shell PATH by running a login shell.
/// macOS GUI apps don't inherit .zshrc/.bashrc PATH, so we need to fetch it.
pub fn get_user_shell_path() -> String {
    use std::sync::OnceLock;
    static CACHED_PATH: OnceLock<String> = OnceLock::new();

    CACHED_PATH
        .get_or_init(|| {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            if let Ok(output) = Command::new(&shell)
                .args(["-i", "-c", "echo $PATH"])
                .env("TERM", "dumb")
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(path) = stdout.lines().rev().find(|l| !l.trim().is_empty()) {
                    let path = path.trim().to_string();
                    if !path.is_empty() && path.contains('/') {
                        eprintln!(
                            "[Shell] Resolved user PATH from interactive shell ({} entries)",
                            path.matches(':').count() + 1
                        );
                        return path;
                    }
                }
            }
            eprintln!("[Shell] Using fallback process PATH");
            std::env::var("PATH").unwrap_or_default()
        })
        .clone()
}

pub fn normalize_api_base(api_base: &str) -> String {
    let trimmed = api_base.trim();
    if trimmed.ends_with('/') {
        trimmed.trim_end_matches('/').to_string()
    } else {
        trimmed.to_string()
    }
}

// --- Bridge param helpers (used by bridge, dev_instance, automation) ---

pub fn optional_param_str<'a>(params: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|value| value.as_str())
}

pub fn optional_param_bool(params: &serde_json::Value, key: &str) -> Option<bool> {
    params.get(key).and_then(|value| value.as_bool())
}

pub fn require_param_f64(
    params: &serde_json::Value,
    key: &str,
) -> Result<f64, (String, String)> {
    params
        .get(key)
        .and_then(|value| value.as_f64())
        .ok_or_else(|| {
            (
                "invalid_params".to_string(),
                format!("Missing required numeric param: {}", key),
            )
        })
}

#[tauri::command]
pub fn get_is_dev_instance() -> bool {
    is_dev_instance()
}

#[tauri::command]
pub fn get_data_dir() -> Result<String, String> {
    construct_data_dir().map(|p| p.to_string_lossy().to_string())
}
