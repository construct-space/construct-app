//! Shared configuration: constants, statics, data directory, utility functions.

use serde::{Deserialize, Serialize};
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
#[allow(dead_code)]
pub const DESKTOP_BRIDGE_PORT_DEFAULT: u16 = 60101;

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

/// Data directory for Construct — uses productName, NOT Tauri identifier.
/// Mirrors Go operator's appdir.go logic:
///   macOS:   ~/Library/Application Support/Construct/
///   Windows: %APPDATA%\Construct\
///   Linux:   $XDG_DATA_HOME/construct/ (or ~/.local/share/construct/)
pub fn construct_data_dir() -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = std::env::var("CONSTRUCT_DATA_DIR") {
        if !dir.is_empty() {
            let p = std::path::PathBuf::from(&dir);
            std::fs::create_dir_all(&p).map_err(|e| format!("Failed to create data dir: {}", e))?;
            return Ok(p);
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot resolve home directory")?;

    let dir = if cfg!(target_os = "macos") {
        let new_dir = std::path::PathBuf::from(&home)
            .join("Library")
            .join("Application Support")
            .join("Construct");

        // One-time migration from old identifier-based dir
        let old_dir = std::path::PathBuf::from(&home)
            .join("Library")
            .join("Application Support")
            .join("space.construct.personal");
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
        std::path::PathBuf::from(app_data).join("Construct")
    } else {
        let data_home =
            std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{}/.local/share", home));
        std::path::PathBuf::from(data_home).join("construct")
    };

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    Ok(dir)
}

pub fn app_display_name() -> &'static str {
    "Construct"
}

/// Returns the base data directory (root, not profile-scoped).
#[tauri::command]
pub fn get_construct_data_dir() -> Result<String, String> {
    construct_data_dir().map(|p| p.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProfileEntry {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProfileRegistry {
    version: u32,
    active_profile: String,
    profiles: Vec<ProfileEntry>,
}

// Only used by the macOS Dock menu (platform::dock_menu_for_application
// and handle_dock_menu_action). Gate the cfg so non-mac builds don't
// trip dead_code on the struct + its loader.
#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
pub(crate) struct ProfileMenuEntry {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

fn registry_path(base: &std::path::Path) -> std::path::PathBuf {
    base.join("profiles.json")
}

fn generate_profile_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| format!("Failed to generate profile ID: {}", e))?;

    // UUID v4 shape so desktop-created IDs match operator-created IDs.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    ))
}

fn ensure_profile_dirs(profile_dir: &std::path::Path) -> Result<(), String> {
    for sub in [
        "",
        "bin",
        "providers",
        "sessions",
        "chat-sessions",
        "memory",
        "state",
        "coder",
        "insights",
        "spaces",
        "skills",
        "logs",
    ] {
        std::fs::create_dir_all(profile_dir.join(sub)).map_err(|e| {
            format!(
                "Failed to create profile dir {}: {}",
                profile_dir.display(),
                e
            )
        })?;
    }
    Ok(())
}

fn move_path(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }

    if !dst.exists() {
        std::fs::rename(src, dst).map_err(|e| {
            format!(
                "Failed to move {} → {}: {}",
                src.display(),
                dst.display(),
                e
            )
        })?;
        return Ok(());
    }

    let src_meta =
        std::fs::metadata(src).map_err(|e| format!("Failed to stat {}: {}", src.display(), e))?;
    let dst_meta =
        std::fs::metadata(dst).map_err(|e| format!("Failed to stat {}: {}", dst.display(), e))?;

    if src_meta.is_dir() && dst_meta.is_dir() {
        for entry in std::fs::read_dir(src)
            .map_err(|e| format!("Failed to read {}: {}", src.display(), e))?
        {
            let entry = entry
                .map_err(|e| format!("Failed to read dir entry in {}: {}", src.display(), e))?;
            let child_src = entry.path();
            let child_dst = dst.join(entry.file_name());
            move_path(&child_src, &child_dst)?;
        }
        std::fs::remove_dir_all(src)
            .map_err(|e| format!("Failed to remove migrated dir {}: {}", src.display(), e))?;
    }

    Ok(())
}

fn write_registry(base: &std::path::Path, registry: &ProfileRegistry) -> Result<(), String> {
    let data = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize profiles.json: {}", e))?;
    std::fs::write(registry_path(base), data)
        .map_err(|e| format!("Failed to write profiles.json: {}", e))
}

fn fresh_registry(profile_id: &str) -> ProfileRegistry {
    ProfileRegistry {
        version: 1,
        active_profile: profile_id.to_string(),
        profiles: vec![ProfileEntry {
            id: profile_id.to_string(),
            name: "Default".to_string(),
            email: None,
            avatar: None,
            created_at: None,
        }],
    }
}

/// Names that older builds wrote to the base data dir but that belong
/// inside a profile. Kept in sync with `brain/paths/paths.go`.
const LEGACY_ROOT_NAMES: &[&str] = &[
    "auth.json",
    "credentials.json",
    "providers",
    "providers.json",
    "sessions",
    "chat-sessions",
    "memory",
    "state",
    "coder",
    "insights",
    "teams",
    "spaces",
    "skills",
    "hooks.json",
    "mcp.json",
    "permission_mode",
    "context.db",
    "session-memories",
    "construct-settings.json",
    "bin",
    "logs",
    "brain",
    "telemetry.db",
    "telemetry.db-shm",
    "telemetry.db-wal",
];

fn any_legacy_root_files(base: &std::path::Path) -> bool {
    LEGACY_ROOT_NAMES
        .iter()
        .any(|name| base.join(name).exists())
}

fn migrate_legacy_root_into(
    base: &std::path::Path,
    profile_dir: &std::path::Path,
) -> Result<(), String> {
    for name in LEGACY_ROOT_NAMES {
        move_path(&base.join(name), &profile_dir.join(name))?;
    }
    Ok(())
}

fn ensure_profile_registry(base: &std::path::Path) -> Result<ProfileRegistry, String> {
    let registry_path = registry_path(base);
    let profiles_root = base.join("profiles");

    std::fs::create_dir_all(&profiles_root)
        .map_err(|e| format!("Failed to create profiles dir: {}", e))?;

    let parsed = if registry_path.exists() {
        let data = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read profiles.json: {}", e))?;
        Some(
            serde_json::from_str::<ProfileRegistry>(&data)
                .map_err(|e| format!("Failed to parse profiles.json: {}", e))?,
        )
    } else {
        None
    };

    // Treat an empty profile list (from older builds or a corrupted
    // registry) the same as a missing file — we want exactly one
    // invariant: a valid active profile exists.
    if let Some(mut registry) = parsed.filter(|r| !r.profiles.is_empty()) {
        // Repair invalid active_profile against the existing profiles.
        let mut changed = false;
        if registry.active_profile.trim().is_empty()
            || !registry
                .profiles
                .iter()
                .any(|profile| profile.id == registry.active_profile)
        {
            registry.active_profile = registry.profiles[0].id.clone();
            changed = true;
        }

        let active_profile_dir = profiles_root.join(&registry.active_profile);
        ensure_profile_dirs(&active_profile_dir)?;

        // Always migrate any leftover root-level legacy files into the
        // active profile. Older builds may have written `brain/`,
        // `sessions/`, `auth.json`, etc. straight to the base dir; this
        // runs on every boot until the root is clean.
        if any_legacy_root_files(base) {
            migrate_legacy_root_into(base, &active_profile_dir)?;
        }

        if changed {
            write_registry(base, &registry)?;
        }

        return Ok(registry);
    }

    // No usable registry. If legacy files exist at root, wrap them into a
    // new profile; otherwise create an empty Default profile. Either way
    // the profile ID will be swapped to the accounts UUID on first login.
    let profile_id = generate_profile_id()?;
    let profile_dir = profiles_root.join(&profile_id);
    ensure_profile_dirs(&profile_dir)?;
    migrate_legacy_root_into(base, &profile_dir)?;
    let registry = fresh_registry(&profile_id);
    write_registry(base, &registry)?;
    Ok(registry)
}

/// Returns the active profile's data directory. Always returns a valid
/// path — `ensure_profile_registry` auto-creates a Default profile on
/// fresh install, so callers never need to handle an empty string.
#[tauri::command]
pub fn get_profile_data_dir() -> Result<String, String> {
    let base = construct_data_dir()?;
    let registry = ensure_profile_registry(&base)?;

    let profile_dir = base.join("profiles").join(&registry.active_profile);
    ensure_profile_dirs(&profile_dir)?;
    Ok(profile_dir.to_string_lossy().to_string())
}

/// List all profiles from profiles.json.
#[tauri::command]
pub fn list_profiles() -> Result<serde_json::Value, String> {
    let base = construct_data_dir()?;
    let registry = ensure_profile_registry(&base)?;
    serde_json::to_value(registry).map_err(|e| format!("Failed to encode profiles.json: {}", e))
}

#[cfg(target_os = "macos")]
pub(crate) fn profile_menu_entries() -> Result<(String, Vec<ProfileMenuEntry>), String> {
    let base = construct_data_dir()?;
    let registry = ensure_profile_registry(&base)?;

    let profiles = registry
        .profiles
        .into_iter()
        .map(|profile| ProfileMenuEntry {
            id: profile.id,
            name: profile.name,
            email: profile.email,
        })
        .collect();

    Ok((registry.active_profile, profiles))
}

fn validate_profile_id(profile_id: &str) -> Result<(), String> {
    if profile_id.is_empty()
        || profile_id.contains("..")
        || profile_id.contains('/')
        || profile_id.contains('\\')
        || profile_id
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ':'))
    {
        return Err("Invalid profile id".to_string());
    }
    Ok(())
}

/// Switch the active profile. Updates profiles.json and returns the new profile dir.
#[tauri::command]
pub fn switch_profile(profile_id: String) -> Result<String, String> {
    validate_profile_id(&profile_id)?;
    let base = construct_data_dir()?;
    let profile_dir = base.join("profiles").join(&profile_id);

    if !profile_dir.exists() {
        return Err(format!("Profile '{}' does not exist", profile_id));
    }

    // Update profiles.json
    let registry_path = base.join("profiles.json");
    if let Ok(data) = std::fs::read_to_string(&registry_path) {
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&data) {
            json["active_profile"] = serde_json::Value::String(profile_id.clone());
            let _ = std::fs::write(
                &registry_path,
                serde_json::to_string_pretty(&json).unwrap_or_default(),
            );
        }
    }

    eprintln!(
        "[Profile] Switched to: {} → {}",
        profile_id,
        profile_dir.display()
    );
    Ok(profile_dir.to_string_lossy().to_string())
}

/// Update a profile entry in profiles.json.
#[tauri::command]
pub fn update_profile(
    profile_id: String,
    name: Option<String>,
    email: Option<String>,
    avatar: Option<String>,
) -> Result<(), String> {
    validate_profile_id(&profile_id)?;
    let base = construct_data_dir()?;
    let mut registry = ensure_profile_registry(&base)?;

    let profile = registry
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' does not exist", profile_id))?;

    if let Some(name) = name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            profile.name = trimmed.to_string();
        }
    }

    if let Some(email) = email {
        let trimmed = email.trim();
        profile.email = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    if let Some(avatar) = avatar {
        let trimmed = avatar.trim();
        profile.avatar = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    write_registry(&base, &registry)
}

/// Create a new profile with a specific ID (accounts UUID). Returns the profile dir.
#[tauri::command]
pub fn create_profile(
    profile_id: String,
    name: String,
    email: Option<String>,
    avatar: Option<String>,
) -> Result<String, String> {
    validate_profile_id(&profile_id)?;
    let base = construct_data_dir()?;
    let mut registry = ensure_profile_registry(&base)?;

    // If profile already exists, just switch to it
    if registry.profiles.iter().any(|p| p.id == profile_id) {
        let profile_dir = base.join("profiles").join(&profile_id);
        ensure_profile_dirs(&profile_dir)?;
        registry.active_profile = profile_id.clone();
        write_registry(&base, &registry)?;
        return Ok(profile_dir.to_string_lossy().to_string());
    }

    let profile_dir = base.join("profiles").join(&profile_id);
    ensure_profile_dirs(&profile_dir)?;

    registry.profiles.push(ProfileEntry {
        id: profile_id.clone(),
        name,
        email,
        avatar,
        created_at: Some(chrono_now()),
    });
    registry.active_profile = profile_id;
    write_registry(&base, &registry)?;

    Ok(profile_dir.to_string_lossy().to_string())
}

/// Rename a profile's ID (e.g., migrate random UUID → accounts UUID).
/// Moves the directory and updates the registry.
#[tauri::command]
pub fn rename_profile(old_id: String, new_id: String) -> Result<String, String> {
    validate_profile_id(&old_id)?;
    validate_profile_id(&new_id)?;
    let base = construct_data_dir()?;
    let mut registry = ensure_profile_registry(&base)?;

    // Don't rename if new_id already exists as a different profile
    if registry
        .profiles
        .iter()
        .any(|p| p.id == new_id && p.id != old_id)
    {
        return Err(format!("Profile '{}' already exists", new_id));
    }

    let old_dir = base.join("profiles").join(&old_id);
    let new_dir = base.join("profiles").join(&new_id);

    if old_dir.exists() && !new_dir.exists() {
        std::fs::rename(&old_dir, &new_dir)
            .map_err(|e| format!("Failed to rename profile dir: {}", e))?;
    } else if !old_dir.exists() {
        // Old dir doesn't exist, just create the new one
        ensure_profile_dirs(&new_dir)?;
    }

    // Update registry entry
    if let Some(profile) = registry.profiles.iter_mut().find(|p| p.id == old_id) {
        profile.id = new_id.clone();
    }

    if registry.active_profile == old_id {
        registry.active_profile = new_id.clone();
    }

    write_registry(&base, &registry)?;
    Ok(new_dir.to_string_lossy().to_string())
}

fn chrono_now() -> String {
    // Simple ISO timestamp without external dependency
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Return unix timestamp as string (good enough for ordering)
    format!("{}", secs)
}

pub fn operator_port() -> u16 {
    OPERATOR_PORT_DEFAULT
}

pub fn bridge_port() -> u16 {
    DESKTOP_BRIDGE_PORT_DEFAULT
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

// --- Bridge param helpers (used by bridge, automation) ---

pub fn optional_param_str<'a>(params: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|value| value.as_str())
}

pub fn optional_param_bool(params: &serde_json::Value, key: &str) -> Option<bool> {
    params.get(key).and_then(|value| value.as_bool())
}

pub fn require_param_f64(params: &serde_json::Value, key: &str) -> Result<f64, (String, String)> {
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
pub fn get_data_dir() -> Result<String, String> {
    // Auth and other profile-owned frontend state should always resolve to the active profile dir.
    get_profile_data_dir()
}
