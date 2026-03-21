//! Construct DEV instance: spawn, navigate, screenshot, window finding.

use crate::config::{
    is_dev_instance, optional_param_bool, optional_param_str, LAST_CONSTRUCT_DEV_PID,
};

use std::time::Duration;

fn remember_construct_dev_pid(pid: u32) {
    if let Ok(mut slot) = LAST_CONSTRUCT_DEV_PID.lock() {
        *slot = Some(pid);
    }
}

fn is_process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn get_alive_dev_pid() -> Option<u32> {
    if let Ok(slot) = LAST_CONSTRUCT_DEV_PID.lock() {
        if let Some(pid) = *slot {
            if is_process_alive(pid) {
                return Some(pid);
            }
        }
    }
    None
}

pub fn spawn_construct_dev(route: Option<&str>) -> Result<u32, String> {
    if let Some(existing_pid) = get_alive_dev_pid() {
        eprintln!(
            "[dev] DEV instance already running (pid={}), reusing",
            existing_pid
        );
        return Ok(existing_pid);
    }

    let exe =
        std::env::current_exe().map_err(|e| format!("Failed to get current executable: {}", e))?;

    let mut command = std::process::Command::new(exe);
    command.arg("--dev").env("CONSTRUCT_DEV_MODE", "true");
    if let Some(route) = route {
        if !route.trim().is_empty() {
            command.env("CONSTRUCT_START_ROUTE", route);
        }
    }

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to launch Construct DEV: {}", e))?;

    let pid = child.id();
    eprintln!("[dev] Spawned new DEV instance (pid={})", pid);
    remember_construct_dev_pid(pid);
    Ok(pid)
}

#[tauri::command]
pub fn open_construct_dev() -> Result<(), String> {
    if is_dev_instance() {
        remember_construct_dev_pid(std::process::id());
        return Ok(());
    }
    spawn_construct_dev(None).map(|_| ())
}

#[tauri::command]
pub fn open_construct_dev_route(route: String) -> Result<(), String> {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        return Err("Route is required".to_string());
    }
    if !trimmed.starts_with('/') {
        return Err("Route must start with '/'".to_string());
    }

    if is_dev_instance() {
        remember_construct_dev_pid(std::process::id());
        return Ok(());
    }

    spawn_construct_dev(Some(trimmed)).map(|_| ())
}

#[tauri::command]
pub fn get_launch_route() -> Option<String> {
    std::env::var("CONSTRUCT_START_ROUTE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

// ==================== macOS window finding & screenshots ====================

#[cfg(target_os = "macos")]
#[derive(Clone, Debug)]
pub struct DevWindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(target_os = "macos")]
impl DevWindowBounds {
    pub fn as_json(&self) -> serde_json::Value {
        serde_json::json!({
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        })
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug)]
pub struct DevWindowInfo {
    pub pid: u32,
    pub window_id: i32,
    pub title: Option<String>,
    pub bounds: DevWindowBounds,
}

#[cfg(target_os = "macos")]
fn activate_construct_dev_process(pid: u32) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32) {
        let _ = app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
    }
}

#[cfg(target_os = "macos")]
fn number_from_cf_type(value: &core_foundation::base::CFType) -> Option<f64> {
    use core_foundation::number::CFNumber;

    value
        .downcast::<CFNumber>()
        .and_then(|value| value.to_f64().or_else(|| value.to_i64().map(|v| v as f64)))
}

#[cfg(target_os = "macos")]
fn parse_window_bounds(
    bounds_dict: &core_foundation::dictionary::CFDictionary,
) -> Option<DevWindowBounds> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    let bounds_dict = unsafe {
        CFDictionary::<CFString, CFType>::wrap_under_get_rule(bounds_dict.as_concrete_TypeRef())
    };

    let x_key = CFString::from_static_string("X");
    let y_key = CFString::from_static_string("Y");
    let width_key = CFString::from_static_string("Width");
    let height_key = CFString::from_static_string("Height");

    Some(DevWindowBounds {
        x: bounds_dict
            .find(&x_key)
            .and_then(|value| number_from_cf_type(&value))?,
        y: bounds_dict
            .find(&y_key)
            .and_then(|value| number_from_cf_type(&value))?,
        width: bounds_dict
            .find(&width_key)
            .and_then(|value| number_from_cf_type(&value))?,
        height: bounds_dict
            .find(&height_key)
            .and_then(|value| number_from_cf_type(&value))?,
    })
}

#[cfg(target_os = "macos")]
pub fn find_construct_dev_window_for_pids(pids: &[u32]) -> Result<Option<DevWindowInfo>, String> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowIsOnscreen, kCGWindowLayer,
        kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowName,
        kCGWindowNumber, kCGWindowOwnerPID,
    };

    let Some(window_info) = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    ) else {
        return Ok(None);
    };

    let owner_pid_key = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerPID) };
    let window_number_key = unsafe { CFString::wrap_under_get_rule(kCGWindowNumber) };
    let layer_key = unsafe { CFString::wrap_under_get_rule(kCGWindowLayer) };
    let onscreen_key = unsafe { CFString::wrap_under_get_rule(kCGWindowIsOnscreen) };
    let name_key = unsafe { CFString::wrap_under_get_rule(kCGWindowName) };
    let bounds_key = unsafe { CFString::wrap_under_get_rule(kCGWindowBounds) };

    for entry in window_info.get_all_values() {
        let dict = unsafe { CFDictionary::<CFString, CFType>::wrap_under_get_rule(entry as _) };

        let owner_pid = dict
            .find(&owner_pid_key)
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|value| value.to_i64())
            .map(|value| value as u32);
        let Some(owner_pid) = owner_pid else {
            continue;
        };
        if !pids.contains(&owner_pid) {
            continue;
        }

        let layer = dict
            .find(&layer_key)
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|value| value.to_i64())
            .unwrap_or(0);
        if layer != 0 {
            continue;
        }

        let is_onscreen = dict
            .find(&onscreen_key)
            .and_then(|value| value.downcast::<CFBoolean>())
            .map(bool::from)
            .unwrap_or(true);
        if !is_onscreen {
            continue;
        }

        let window_id = dict
            .find(&window_number_key)
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|value| value.to_i64())
            .map(|value| value as i32);
        let Some(window_id) = window_id else {
            continue;
        };

        let title = dict
            .find(&name_key)
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty());

        let bounds = dict
            .find(&bounds_key)
            .and_then(|value| value.downcast::<CFDictionary>())
            .and_then(|value| parse_window_bounds(&value))
            .unwrap_or(DevWindowBounds {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            });

        return Ok(Some(DevWindowInfo {
            pid: owner_pid,
            window_id,
            title,
            bounds,
        }));
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
async fn wait_for_construct_dev_window(
    pid: u32,
    timeout: Duration,
) -> Result<DevWindowInfo, (String, String)> {
    let start = std::time::Instant::now();
    loop {
        match find_construct_dev_window_for_pids(&[pid]) {
            Ok(Some(info)) => return Ok(info),
            Ok(None) => {}
            Err(error) => return Err(("internal".to_string(), error)),
        }

        if start.elapsed() >= timeout {
            break;
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    Err((
        "not_found".to_string(),
        "Construct DEV window was not detected. Try opening Construct DEV again and keep its main window visible."
            .to_string(),
    ))
}

#[cfg(target_os = "macos")]
pub async fn resolve_construct_dev_window(
    route: Option<&str>,
    _fresh: bool,
    timeout: Duration,
) -> Result<DevWindowInfo, (String, String)> {
    let already_running = get_alive_dev_pid();
    let was_fresh_spawn;

    let pid = if let Some(existing_pid) = already_running {
        was_fresh_spawn = false;
        existing_pid
    } else {
        was_fresh_spawn = true;
        spawn_construct_dev(route).map_err(|e| ("launch_failed".to_string(), e))?
    };

    activate_construct_dev_process(pid);

    if was_fresh_spawn {
        tokio::time::sleep(Duration::from_millis(2000)).await;
    } else {
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    wait_for_construct_dev_window(pid, timeout).await
}

#[cfg(target_os = "macos")]
pub async fn navigate_construct_dev(
    params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    let path = optional_param_str(params, "path").ok_or_else(|| {
        (
            "invalid_params".to_string(),
            "Missing required string param: path".to_string(),
        )
    })?;
    let info = resolve_construct_dev_window(Some(path), true, Duration::from_secs(15)).await?;
    Ok(serde_json::json!({
        "status": "ok",
        "path": path,
        "pid": info.pid,
        "window_id": info.window_id,
        "title": info.title,
        "bounds": info.bounds.as_json(),
    }))
}

#[cfg(not(target_os = "macos"))]
pub async fn navigate_construct_dev(
    _params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    Err((
        "not_implemented".to_string(),
        "Construct DEV navigation is currently supported only on macOS".to_string(),
    ))
}

#[cfg(target_os = "macos")]
pub async fn screenshot_construct_dev(
    params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    let route = optional_param_str(params, "route");
    let fresh = optional_param_bool(params, "fresh").unwrap_or(true);
    let info = resolve_construct_dev_window(route, fresh, Duration::from_secs(15)).await?;
    let (path, width, height) =
        crate::browser_bridge::capture_window_screenshot_macos(info.window_id, "construct-dev")
            .await?;
    Ok(serde_json::json!({
        "path": path,
        "width": width,
        "height": height,
        "pid": info.pid,
        "window_id": info.window_id,
        "title": info.title,
        "bounds": info.bounds.as_json(),
        "route": route,
    }))
}

#[cfg(not(target_os = "macos"))]
pub async fn screenshot_construct_dev(
    _params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    Err((
        "not_implemented".to_string(),
        "Construct DEV screenshots are currently supported only on macOS".to_string(),
    ))
}

#[cfg(target_os = "macos")]
pub async fn screenshot_construct_self(
    app: &tauri::AppHandle,
) -> Result<serde_json::Value, (String, String)> {
    use tauri::Manager;

    let window = app.get_webview_window("main").ok_or_else(|| {
        (
            "internal".to_string(),
            "Main window not found".to_string(),
        )
    })?;

    let pid = std::process::id();
    let info = find_construct_dev_window_for_pids(&[pid])
        .map_err(|e| ("internal".to_string(), e))?
        .ok_or_else(|| {
            (
                "not_found".to_string(),
                "Could not find own window for screenshot".to_string(),
            )
        })?;

    drop(window);

    let (path, width, height) =
        crate::browser_bridge::capture_window_screenshot_macos(info.window_id, "construct").await?;
    Ok(serde_json::json!({
        "path": path,
        "width": width,
        "height": height,
        "pid": pid,
        "window_id": info.window_id,
        "title": info.title,
        "bounds": info.bounds.as_json(),
    }))
}

#[cfg(not(target_os = "macos"))]
pub async fn screenshot_construct_self(
    _app: &tauri::AppHandle,
) -> Result<serde_json::Value, (String, String)> {
    Err((
        "not_implemented".to_string(),
        "Construct self-screenshot is currently supported only on macOS".to_string(),
    ))
}
