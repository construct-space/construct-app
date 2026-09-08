//! Screenshot capture for any Tauri-managed webview window (space
//! runner, space builder, main window, etc.). Parallel to
//! `browser_bridge`'s `browser.screenshot` but scoped to operator/IDE
//! windows rather than browser tabs.
//!
//! Platform support matches the browser path: macOS works via
//! `capture_window_screenshot_macos`, other platforms return
//! not_implemented.

use serde_json::{json, Value};
use tauri::Manager;

/// Dispatch a `space.screenshot` or `space.list_windows` bridge method.
pub async fn dispatch(
    app: &tauri::AppHandle,
    method: &str,
    params: &Value,
) -> Result<Value, (String, String)> {
    match method {
        "space.list_windows" => cmd_list_windows(app).await,
        "space.screenshot" => cmd_screenshot(app, params).await,
        _ => Err((
            "not_found".to_string(),
            format!("Unknown space-capture method: {}", method),
        )),
    }
}

/// Enumerate every webview window the app owns. Used by agents to
/// discover which labels they can screenshot without hard-coding
/// "main" / "space-runner" / "runner-<spaceId>" themselves.
async fn cmd_list_windows(app: &tauri::AppHandle) -> Result<Value, (String, String)> {
    let mut windows: Vec<Value> = Vec::new();
    for (label, window) in app.webview_windows() {
        let title = window.title().unwrap_or_default();
        let visible = window.is_visible().unwrap_or(false);
        windows.push(json!({
            "label": label,
            "title": title,
            "visible": visible,
        }));
    }
    Ok(json!({ "windows": windows }))
}

/// Capture a named window to a PNG on disk. `window_label` must match
/// one of the entries from `space.list_windows`.
async fn cmd_screenshot(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let window_label = params
        .get("window_label")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            (
                "invalid_params".to_string(),
                "window_label is required".to_string(),
            )
        })?
        .to_string();

    let window = app.get_webview_window(&window_label).ok_or_else(|| {
        (
            "not_found".to_string(),
            format!("No webview window with label {:?}", window_label),
        )
    })?;

    #[cfg(target_os = "macos")]
    {
        use std::time::Duration;

        // Bring the window forward before screencapture — occluded
        // windows come back as whatever's on top of them otherwise.
        let _ = window.show();
        let _ = window.set_focus();
        tokio::time::sleep(Duration::from_millis(150)).await;

        let ns_window_ptr = window.ns_window().map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to access native window: {}", e),
            )
        })? as *mut std::ffi::c_void;

        let window_id = unsafe {
            use objc2_app_kit::NSWindow;
            let ns_window = &*(ns_window_ptr as *const NSWindow);
            ns_window.windowNumber()
        };
        if window_id <= 0 {
            return Err(("internal".to_string(), "Invalid window ID".to_string()));
        }
        let window_id: i32 = window_id.try_into().map_err(|_| {
            (
                "internal".to_string(),
                format!("Window ID out of range: {}", window_id),
            )
        })?;

        let dir = crate::config::construct_data_dir()
            .map(|p| p.join("screenshots"))
            .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
        let file_prefix = format!("construct-space-{}", window_label);
        let (path, width, height) = match crate::browser_bridge::capture_window_screenshot_macos(
            window_id,
            &file_prefix,
            &dir,
        )
        .await
        {
            Ok(capture) => capture,
            Err(err)
                if crate::browser_bridge::should_try_webview_snapshot_after_capture_error(
                    &err.1,
                ) =>
            {
                crate::browser_bridge::capture_webview_window_screenshot_macos(
                    &window,
                    &file_prefix,
                    &dir,
                )
                .await?
            }
            Err(err) => return Err(err),
        };
        // Intentionally NOT returning a data_uri — the file is on disk
        // and the frontend's markdown renderer rewrites absolute paths
        // via Tauri's asset protocol. Including a base64 blob here
        // would make the LLM stream multi-MB of base64 back as text.
        return Ok(json!({
            "window_label": window_label,
            "path": path,
            "width": width,
            "height": height,
        }));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Err((
            "not_implemented".to_string(),
            "space.screenshot is only implemented on macOS".to_string(),
        ))
    }
}
